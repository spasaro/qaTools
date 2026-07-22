"""
Author: Rachel Garza @rachelgarza-tc
Slack: @Rachel Garza
Measure how much time Playwright retries cost in the nova-e2e workflow.

Pulls the last N pipelines on a given branch, finds the nova-e2e-www-tests and
nova-e2e-studio-tests jobs (each runs with parallelism=12 shards), downloads
the per-shard allure-report widgets from CircleCI's artifacts API, and reports:

  - aggregate retry rate (% of test executions that are retries)
  - estimated retry-attributable wallclock cost per shard
  - top retry offenders (single most recent job, walked in detail)
  - p50/p95 duration of nova-e2e-env-checkout (the checkout job that
    actually leases a Nova test env)

To install dependencies, I recommend a virtualenv + pip:
    $ python -m venv venv
    $ source venv/bin/activate
    $ pip install -r requirements.txt

Create a CircleCI Token and put in on line 78 below and run:  python measure_e2e_retries.py
To create a CircleCI Token, loging to Circle CI go to your User Settings and create a new Personal API token.
To run:
    $ python measure_e2e_retries.py

# TODO: some ideas for future enhancements:
#  - correlate retry rates with env-checkout durations (are longer leases → more retries?)
#  - add a "control group" of non-retry-related jobs to compare wallclock
#  - track historical trends by running this script periodically and saving results to a file

"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from rich.console import Console
from rich.table import Table
from rich import box as rich_box

_console = Console()

try:
    from tqdm import tqdm
except ImportError:
    class _TqdmShim:
        def __call__(self, iterable=None, total=None, desc="",
                     unit="it", disable=False, **kwargs):
            if iterable is None:
                return iter([])
            if disable:
                return iter(iterable)
            def _gen():
                for i, item in enumerate(iterable, 1):
                    n = total or "?"
                    label = f"  {desc}: " if desc else "  "
                    print(f"\r{label}{i}/{n} {unit}s", end="", flush=True)
                    yield item
                print()
            return _gen()
        @staticmethod
        def write(msg):
            print(f"\r{msg}")
    tqdm = _TqdmShim()

# ---- ! CHANGE THE "YOUR_TOKEN" VALUE ! -------
CIRCLE_TOKEN = os.environ.get("CIRCLE_TOKEN", "YOUR_TOKEN")
PROJECT_SLUG = "github/tunecore/tc-www"
BRANCH = "integration"
NUM_PIPELINES = 30
JOBS_OF_INTEREST = {"nova-e2e-www-tests", "nova-e2e-studio-tests", "nova-e2e-api-tests"}
CHECKOUT_JOB = "nova-e2e-env-checkout"
WORKFLOW_NAME = "nova-e2e"
PLAYWRIGHT_WORKERS = 3  # --workers=3 in .circleci/config.yml
DOWNLOAD_THREADS = 16   # parallelism for artifact downloads, changing to 16 to reduce 429 rate limits from circle
# -------------------------------------------

API = "https://circleci.com/api/v2"
HEADERS = {"Circle-Token": CIRCLE_TOKEN, "Accept": "application/json"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)
_retry = Retry(
    total=6,
    backoff_factor=1.0,        # waits 1s, 2s, 4s, 8s, 16s, 32s between retries
    status_forcelist=[429, 500, 502, 503, 504],
    allowed_methods=["GET"],
    respect_retry_after_header=True,
)
_adapter = HTTPAdapter(
    max_retries=_retry,
    pool_connections=DOWNLOAD_THREADS * 2,
    pool_maxsize=DOWNLOAD_THREADS * 2,
)
SESSION.mount("https://", _adapter)
SESSION.mount("http://", _adapter)


def get(path: str, **params: Any) -> dict:
    r = SESSION.get(f"{API}{path}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def paginate(path: str, **params: Any):
    """Returrns items across CircleCI's page_token-based pagination."""
    page_token = None
    while True:
        if page_token:
            params["page-token"] = page_token
        data = get(path, **params)
        for item in data.get("items", []):
            yield item
        page_token = data.get("next_page_token")
        if not page_token:
            return


def recent_pipelines() -> list[dict]:
    out = []
    for p in paginate(f"/project/{PROJECT_SLUG}/pipeline", branch=BRANCH):
        out.append(p)
        if len(out) >= NUM_PIPELINES:
            break
    return out


def workflow_jobs(pipeline_id: str) -> list[dict]:
    """Return all jobs across the nova-e2e workflow for a pipeline."""
    jobs = []
    for wf in paginate(f"/pipeline/{pipeline_id}/workflow"):
        if wf["name"] != WORKFLOW_NAME:
            continue
        if wf["status"] not in ("success", "failed"):
            continue
        for job in paginate(f"/workflow/{wf['id']}/job"):
            job["_workflow_id"] = wf["id"]
            jobs.append(job)
    return jobs


def list_artifacts(job_number: int) -> list[dict]:
    return list(paginate(f"/project/{PROJECT_SLUG}/{job_number}/artifacts"))


def _download_json(artifact: dict) -> Any:
    r = SESSION.get(artifact["url"], timeout=60)
    r.raise_for_status()
    return r.json()


def _download_many(artifacts: list[dict], desc: str,
                   show_progress: bool = True) -> list[Any]:
    """Parallel JSON download with a progress bar. Skips failures."""
    out: list[Any] = []
    with ThreadPoolExecutor(max_workers=DOWNLOAD_THREADS) as ex:
        futures = {ex.submit(_download_json, a): a for a in artifacts}
        for fut in tqdm(as_completed(futures), total=len(futures),
                        desc=desc, unit="file", disable=not show_progress):
            try:
                out.append(fut.result())
            except Exception as e:
                if show_progress:
                    tqdm.write(f"  download failed: {e}")
    return out


# ============================================================================
# Analysis: shard-level aggregation via allure widgets
# ============================================================================

def analyze_test_job(job_number: int) -> dict | None:
    """
    For a single nova-e2e-{www,studio}-tests job (parallelism=12), download
    each shard's retry-trend.json + summary.json and aggregate.

    Returns per-shard arrays so we can compute distribution stats.
    """
    try:
        artifacts = list_artifacts(job_number)
    except requests.HTTPError as ex:
        tqdm.write(f"  skip job {job_number}: {ex}")
        return None

    retry_trend = [a for a in artifacts
                   if a.get("path", "").endswith("widgets/retry-trend.json")]
    summary = [a for a in artifacts
               if a.get("path", "").endswith("widgets/summary.json")]

    if not retry_trend or not summary:
        return None

    trend_data = _download_many(retry_trend, f"job {job_number} trend", show_progress=False)
    summary_data = _download_many(summary, f"job {job_number} summary", show_progress=False)

    runs = []
    retries = []
    for entry in trend_data:
        # Format: [{"data": {"run": N, "retry": M}}]
        if isinstance(entry, list) and entry:
            d = entry[0].get("data", {})
            runs.append(int(d.get("run", 0)))
            retries.append(int(d.get("retry", 0)))

    wallclock_seconds = []   # shard wallclock from allure (start→stop)
    sum_duration_seconds = []  # serial sum of every test in the shard
    test_counts = []
    for s in summary_data:
        time = s.get("time", {})
        wallclock_seconds.append(time.get("duration", 0) / 1000.0)
        sum_duration_seconds.append(time.get("sumDuration", 0) / 1000.0)
        stat = s.get("statistic", {})
        test_counts.append(int(stat.get("total", 0)))

    return {
        "job_number": job_number,
        "runs": runs,
        "retries": retries,
        "wallclock_s": wallclock_seconds,
        "sum_duration_s": sum_duration_seconds,
        "test_counts": test_counts,
    }


# ============================================================================
# Analysis: per-test offender list (one job, deep dive)
# ============================================================================

def _flatten_suites(node: dict, spec_file: str = "", depth: int = 0) -> list[tuple[str, dict]]:
    """Recursively yield (spec_file, leaf_test) pairs from Allure's suites.json tree.

    The tree is: root → suite-name ("tc-www") → spec-file-path → tests.
    We capture names at depth 1 (the spec-file level) and carry them down.
    """
    if "children" not in node:
        return [(spec_file, node)]
    out = []
    for child in node["children"]:
        inherited = child.get("name", spec_file) if depth == 1 else spec_file
        out.extend(_flatten_suites(child, inherited, depth + 1))
    return out


def _compute_offenders_from_suites(suites_data: dict) -> list[dict]:
    """
    Extract retried tests from a single shard's suites.json.

    Uses retriesCount × final_duration to estimate wasted time — much faster
    than downloading individual test-case files since it's one file per shard.
    """
    offenders = []
    for spec_file, test in _flatten_suites(suites_data):
        retries_count = int(test.get("retriesCount", 0))
        if retries_count == 0:
            continue
        duration_s = test.get("time", {}).get("duration", 0) / 1000.0
        offenders.append({
            "name": test.get("name") or test.get("fullName", "?"),
            "spec_file": spec_file,
            "retries": retries_count,
            "final_duration_s": duration_s,
            "prev_duration_s": retries_count * duration_s,
            "estimated_waste_s": (retries_count + 1) * duration_s,
            "status": test.get("status"),
            "flaky": test.get("flaky", False),
            "status_changed": test.get("retriesStatusChange", False),
        })
    offenders.sort(key=lambda o: o["estimated_waste_s"], reverse=True)
    return offenders


def _compute_offenders(test_cases: list[dict]) -> list[dict]:
    """Convert downloaded test-case JSON objects into a ranked offender list."""
    by_history: dict[str, list[dict]] = defaultdict(list)
    for tc in test_cases:
        if not isinstance(tc, dict):
            continue
        hid = tc.get("historyId")
        if hid:
            by_history[hid].append(tc)

    offenders = []
    for attempts in by_history.values():
        attempts.sort(key=lambda t: t.get("time", {}).get("start", 0))
        final = attempts[-1]
        prev_attempts = attempts[:-1]

        if prev_attempts:
            retries_count = len(prev_attempts)
            prev_duration_s = sum(
                a.get("time", {}).get("duration", 0) / 1000.0
                for a in prev_attempts
            )
        else:
            # Only the final-attempt file was downloaded; fall back to estimate.
            retries_count = int(final.get("retriesCount", 0))
            if retries_count == 0:
                continue
            prev_duration_s = retries_count * (
                final.get("time", {}).get("duration", 0) / 1000.0
            )

        if retries_count == 0:
            continue

        final_duration_s = final.get("time", {}).get("duration", 0) / 1000.0
        offenders.append({
            "name": final.get("name") or final.get("fullName", "?"),
            "spec_file": final.get("fullName", ""),
            "retries": retries_count,
            "final_duration_s": final_duration_s,
            "prev_duration_s": prev_duration_s,
            "estimated_waste_s": prev_duration_s,
            "status": final.get("status"),
            "flaky": final.get("flaky", False),
            "status_changed": final.get("retriesStatusChange", False),
        })

    offenders.sort(key=lambda o: o["estimated_waste_s"], reverse=True)
    return offenders


def analyze_offenders(job_number: int, quiet: bool = False) -> list[dict] | None:
    """
    Downloads every data/test-cases/*.json for one job, dedupe by historyId,
    rank by estimated retry cost = retriesCount × final-attempt duration.
    """
    if not quiet:
        print(f"\nDeep-diving offenders in job {job_number}...")
    try:
        artifacts = list_artifacts(job_number)
    except requests.HTTPError as ex:
        if not quiet:
            print(f"  ERROR: {ex}")
        return None

    test_case_artifacts = [a for a in artifacts
                           if "/data/test-cases/" in a.get("path", "")
                           and a.get("path", "").endswith(".json")]
    if not test_case_artifacts:
        if not quiet:
            print("  no test-cases artifacts found")
        return None

    if not quiet:
        print(f"  {len(test_case_artifacts)} test-case files to download")
    test_cases = _download_many(test_case_artifacts, f"job {job_number}",
                                show_progress=not quiet)
    return _compute_offenders(test_cases)


def aggregate_offenders_all_jobs(job_nums: list[int], suite_label: str) -> list[dict]:
    """
    Merge offenders across all jobs in job_nums.

    Speedup strategy: list all artifacts in parallel, then funnel every
    test-case file into one shared download pool so threads never idle
    at job boundaries.

    Returns a list sorted by total estimated waste, where each entry spans
    all jobs:
      name, total_retries, total_waste_s, jobs_with_retries,
      ever_flaky, ever_failed, ever_status_changed
    """
    print(f"\nBuilding aggregate offenders for {suite_label} "
          f"({len(job_nums)} jobs)...")

    # Step 1: list all artifacts in parallel (one fast API call per job).
    job_artifacts: dict[int, list[dict]] = {}
    with ThreadPoolExecutor(max_workers=min(len(job_nums), 20)) as ex:
        futures = {ex.submit(list_artifacts, n): n for n in job_nums}
        for fut in as_completed(futures):
            job_num = futures[fut]
            try:
                job_artifacts[job_num] = fut.result()
            except requests.HTTPError as e:
                tqdm.write(f"  skip job {job_num}: {e}")

    # Step 2: collect one suites.json per shard across all jobs.
    # This is ~12 files per job instead of thousands of test-case files,
    # which avoids the CDN rate limit that kills individual test-case downloads.
    tagged: list[tuple[int, dict]] = []
    for job_num, artifacts in job_artifacts.items():
        for a in artifacts:
            if a.get("path", "").endswith("/data/suites.json"):
                tagged.append((job_num, a))

    if not tagged:
        print("  no suites.json artifacts found in any job")
        return []
    print(f"  {len(tagged)} suites.json files across {len(job_artifacts)} jobs")

    # Step 3: download everything through one shared pool.
    job_test_cases: dict[int, list[dict]] = defaultdict(list)
    with ThreadPoolExecutor(max_workers=DOWNLOAD_THREADS) as ex:
        futures = {ex.submit(_download_json, a): job_num
                   for job_num, a in tagged}
        for fut in tqdm(as_completed(futures), total=len(futures),
                        desc=f"{suite_label} deep-dive", unit="file"):
            job_num = futures[fut]
            try:
                job_test_cases[job_num].append(fut.result())
            except Exception as e:
                tqdm.write(f"  download failed: {e}")

    jobs_with_data = len(job_test_cases)
    total_jobs = len(job_nums)
    if not job_test_cases:
        print("  no test-case data downloaded")
        return []
    print(f"  got test-case data from {jobs_with_data}/{total_jobs} jobs")

    # Step 4: extract offenders from each shard's suites.json, merge by job.
    per_job = []
    for suites_list in job_test_cases.values():
        offenders: list[dict] = []
        for suites_data in suites_list:
            if isinstance(suites_data, dict):
                offenders.extend(_compute_offenders_from_suites(suites_data))
        if offenders:
            per_job.append(offenders)

    by_name: dict[str, dict] = {}
    for job_offenders in per_job:
        # Track which test names we've already counted for this job so a test
        # retrying across multiple shards in the same job only increments
        # jobs_with_retries once.
        seen_this_job: set[str] = set()
        for o in job_offenders:
            name = o["name"]
            if name not in by_name:
                by_name[name] = {
                    "name": name,
                    "spec_file": o.get("spec_file", ""),
                    "total_retries": 0,
                    "total_waste_s": 0.0,
                    "total_final_s": 0.0,
                    "jobs_with_retries": 0,
                    "total_jobs": jobs_with_data,
                    "ever_flaky": False,
                    "ever_failed": False,
                    "ever_status_changed": False,
                }
            agg = by_name[name]
            agg["total_retries"] += o["retries"]
            agg["total_waste_s"] += o["estimated_waste_s"]
            agg["total_final_s"] += o["final_duration_s"]
            if name not in seen_this_job:
                agg["jobs_with_retries"] += 1
                seen_this_job.add(name)
            if o.get("flaky"):
                agg["ever_flaky"] = True
            if o.get("status") != "passed":
                agg["ever_failed"] = True
            if o.get("status_changed"):
                agg["ever_status_changed"] = True

    return sorted(by_name.values(), key=lambda o: o["total_waste_s"], reverse=True)


# ============================================================================
# Diagnostic (can mostly ignore these, was for debugging the script)
# ============================================================================

def dump_allure_retries(job_number: int) -> None:
    """Print retry-trend.json + summary.json + a sample test-case from one job."""
    print(f"Listing artifacts for job {job_number}...")
    try:
        artifacts = list_artifacts(job_number)
    except requests.HTTPError as ex:
        print(f"ERROR: {ex}", file=sys.stderr)
        sys.exit(1)
    print(f"  found {len(artifacts)} artifacts\n")

    for target in ["widgets/retry-trend.json", "widgets/summary.json"]:
        matches = [a for a in artifacts if a.get("path", "").endswith(target)]
        print("=" * 70)
        print(f"{target}  ({len(matches)} copies found)")
        print("=" * 70)
        for i, artifact in enumerate(matches[:3]):
            print(f"\n--- copy {i}: {artifact['path']} ---")
            try:
                payload = _download_json(artifact)
            except Exception as ex:
                print(f"  ERROR: {ex}")
                continue
            print(json.dumps(payload, indent=2)[:2000])
        print()

    test_cases = [a for a in artifacts if "/data/test-cases/" in a.get("path", "")]
    print("=" * 70)
    print(f"data/test-cases/*.json  ({len(test_cases)} total)")
    print("=" * 70)
    if test_cases:
        sample = test_cases[0]
        print(f"\nSampling: {sample['path']}")
        try:
            payload = _download_json(sample)
            print(json.dumps(payload, indent=2)[:2000])
        except Exception as ex:
            print(f"  ERROR: {ex}")
    print()


# ============================================================================
# Formatting
# ============================================================================

def fmt_min(seconds: float) -> str:
    return f"{seconds / 60:.1f} min"


def fmt_duration(seconds: float) -> str:
    total = int(round(seconds))
    m, s = divmod(total, 60)
    return f"{m}m {s:02d}s" if m else f"{s}s"


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = int(len(s) * pct)
    return s[min(k, len(s) - 1)]


# ============================================================================
# Main function
# ============================================================================

def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dump-allure-retries",
        type=int,
        metavar="JOB_NUMBER",
        help="Diagnostic: print retry-trend.json + summary.json + a sample "
             "test-case from one job's artifacts. Skips the full analysis.",
    )
    parser.add_argument(
        "--no-offenders",
        action="store_true",
        help="Skip the per-test offender deep-dive (saves ~1 min).",
    )
    parser.add_argument(
        "--offender-job",
        type=int,
        help="Use a specific job number for offender analysis instead of "
             "auto-picking the most recent.",
    )
    args = parser.parse_args()

    if args.dump_allure_retries is not None:
        dump_allure_retries(args.dump_allure_retries)
        return

    # ---- Phase 1: pipeline + job discovery -------------------------------
    print(f"Fetching last {NUM_PIPELINES} pipelines on {BRANCH}...")
    pipelines = recent_pipelines()
    print(f"  got {len(pipelines)} pipelines\n")

    print("Listing jobs in each pipeline...")
    test_jobs: list[dict] = []
    checkout_jobs: list[dict] = []
    for p in tqdm(pipelines, desc="pipelines", unit="pipe"):
        for job in workflow_jobs(p["id"]):
            if job["name"] == CHECKOUT_JOB:
                checkout_jobs.append(job)
            elif job["name"] in JOBS_OF_INTEREST:
                test_jobs.append(job)
    print(f"  {len(test_jobs)} test jobs, {len(checkout_jobs)} env-checkout jobs\n")

    # ---- Phase 2: env-checkout durations ---------------------------------
    checkout_durations: list[float] = []
    for job in checkout_jobs:
        started = job.get("started_at")
        stopped = job.get("stopped_at")
        if started and stopped:
            s = datetime.fromisoformat(started.replace("Z", "+00:00"))
            e = datetime.fromisoformat(stopped.replace("Z", "+00:00"))
            checkout_durations.append((e - s).total_seconds())

    # ---- Phase 3: per-job allure aggregation, bucketed by suite ----------
    print(f"Fetching allure widgets for {len(test_jobs)} test jobs...")
    # Buckets keyed by job name ("nova-e2e-www-tests" / "nova-e2e-studio-tests")
    buckets: dict[str, dict[str, list]] = {
        name: {
            "runs": [], "retries": [], "wallclock_s": [],
            "sum_duration_s": [], "test_counts": [], "job_count": 0,
        }
        for name in JOBS_OF_INTEREST
    }
    # Track which job numbers had allure data so Phase 4 skips 404 jobs.
    successful_job_nums: dict[str, list[int]] = {n: [] for n in JOBS_OF_INTEREST}
    # Subset of successful_job_nums where at least one shard had retries.
    retrying_job_nums: dict[str, list[int]] = {n: [] for n in JOBS_OF_INTEREST}

    for job in tqdm(test_jobs, desc="test jobs", unit="job"):
        result = analyze_test_job(job["job_number"])
        if not result:
            continue
        suite = job["name"]
        successful_job_nums[suite].append(job["job_number"])
        if sum(result["retries"]) > 0:
            retrying_job_nums[suite].append(job["job_number"])
        b = buckets[suite]
        b["runs"].extend(result["runs"])
        b["retries"].extend(result["retries"])
        b["wallclock_s"].extend(result["wallclock_s"])
        b["sum_duration_s"].extend(result["sum_duration_s"])
        b["test_counts"].extend(result["test_counts"])
        b["job_count"] += 1
    print()

    # ---- Phase 4a: most-recent-job offender deep-dive (one job per suite) ----
    # recent_offenders maps suite_name -> (job_number, offenders_list)
    recent_offenders: dict[str, tuple[int, list[dict]]] = {}
    # ---- Phase 4b: aggregate offender deep-dive across all successful jobs ----
    # agg_offenders maps suite_name -> (n_jobs_label, offenders_list)
    agg_offenders: dict[str, tuple[str, list[dict]]] = {}

    if not args.no_offenders:
        if args.offender_job is not None:
            # Manual single-job override — only shows the single-job view.
            single = analyze_offenders(args.offender_job)
            if single is not None:
                recent_offenders["(manual)"] = (args.offender_job, single)
        else:
            for suite_name in JOBS_OF_INTEREST:
                candidates = successful_job_nums.get(suite_name, [])
                if not candidates:
                    tqdm.write(f"  no successful jobs found for {suite_name}, skipping offender analysis")
                    continue
                # 4a: most recent job
                for job_num in candidates:
                    single = analyze_offenders(job_num)
                    if single is not None:
                        recent_offenders[suite_name] = (job_num, single)
                        break
                # 4b: aggregate across jobs that had retries (skip zero-retry jobs)
                label = suite_name.upper().replace("NOVA-E2E-", "").replace("-TESTS", "")
                retrying = retrying_job_nums.get(suite_name, [])
                if not retrying:
                    tqdm.write(f"  no jobs with retries found for {suite_name}, skipping aggregate")
                    agg_offenders[suite_name] = ("0 jobs", [])
                    continue
                agg = aggregate_offenders_all_jobs(retrying, label)
                agg_offenders[suite_name] = (f"{len(retrying)} jobs", agg)

    # ========================================================================
    # Reprot
    # ========================================================================
    def print_aggregate(label: str, runs: list[int], retries: list[int],
                        wallclock: list[float], sum_dur: list[float],
                        test_counts: list[int], job_count: int) -> None:
        print()
        print("=" * 70)
        print(f"{label}  ({len(runs)} shards across {job_count} jobs)")
        print("=" * 70)
        if not runs:
            print("(no data)")
            return
        total_runs = sum(runs)
        total_retries = sum(retries)
        rate = (total_retries / total_runs * 100) if total_runs else 0
        print(f"Total test executions:      {total_runs:,}")
        print(f"Total retries:              {total_retries:,}")
        print(f"Retry rate:                 {rate:.1f}%")
        print(f"Per-shard retry count       p50={percentile(retries, 0.5):.0f}  "
              f"p95={percentile(retries, 0.95):.0f}  "
              f"max={max(retries)}")
        print()
        avg_wc = statistics.mean(wallclock)
        avg_sum = statistics.mean(sum_dur)
        avg_tests = statistics.mean(test_counts) if test_counts else 1
        avg_per_test = avg_sum / avg_tests if avg_tests else 0
        avg_retries_per_shard = statistics.mean(retries) if retries else 0
        est_retry_wallclock = (avg_retries_per_shard * avg_per_test) / PLAYWRIGHT_WORKERS
        pct = (est_retry_wallclock / avg_wc * 100) if avg_wc else 0
        print(f"Avg shard wallclock:        {fmt_min(avg_wc)}")
        print(f"Avg serial test time (sum): {fmt_min(avg_sum)}  "
              f"(workers={PLAYWRIGHT_WORKERS} → {fmt_min(avg_sum / PLAYWRIGHT_WORKERS)} parallel)")
        print(f"Avg test duration:          {avg_per_test:.1f} sec")
        print(f"Avg retries per shard:      {avg_retries_per_shard:.1f}")
        print(f"Estimated retry wallclock:  {fmt_min(est_retry_wallclock)} per shard "
              f"({pct:.0f}% of shard wallclock)")
        print(f"  formula: {avg_retries_per_shard:.1f} retries × {avg_per_test:.1f}s ÷ "
              f"{PLAYWRIGHT_WORKERS} workers")

    # Per-suite aggregates
    for suite_name in JOBS_OF_INTEREST:
        b = buckets[suite_name]
        label = suite_name.upper().replace("NOVA-E2E-", "").replace("-TESTS", "")
        print_aggregate(
            f"{label} AGGREGATE",
            b["runs"], b["retries"], b["wallclock_s"],
            b["sum_duration_s"], b["test_counts"], b["job_count"],
        )

    # Combined aggregate
    combined_runs = sum((buckets[n]["runs"] for n in JOBS_OF_INTEREST), [])
    combined_retries = sum((buckets[n]["retries"] for n in JOBS_OF_INTEREST), [])
    combined_wallclock = sum((buckets[n]["wallclock_s"] for n in JOBS_OF_INTEREST), [])
    combined_sum = sum((buckets[n]["sum_duration_s"] for n in JOBS_OF_INTEREST), [])
    combined_counts = sum((buckets[n]["test_counts"] for n in JOBS_OF_INTEREST), [])
    combined_jobs = sum(buckets[n]["job_count"] for n in JOBS_OF_INTEREST)
    print_aggregate(
        "COMBINED AGGREGATE (www + studio)",
        combined_runs, combined_retries, combined_wallclock,
        combined_sum, combined_counts, combined_jobs,
    )

    # Per-suite: most recent job
    for suite_key, (job_number, offenders) in recent_offenders.items():
        pretty = suite_key.upper().replace("NOVA-E2E-", "").replace("-TESTS", "")
        print()
        print("=" * 70)
        print(f"TOP 20 RETRY OFFENDERS — {pretty}  (job {job_number})")
        print("=" * 70)
        if not offenders:
            print("(no retries in this job)")
            continue
        tbl = Table(box=rich_box.ROUNDED, show_header=True,
                    header_style="bold", show_edge=True)
        tbl.add_column("prev", justify="right")
        tbl.add_column("retries", justify="right")
        tbl.add_column("final", justify="right")
        tbl.add_column("flags")
        tbl.add_column("test")
        for o in offenders[:20]:
            flags = "".join([
                "F" if o["flaky"] else "",
                "C" if o["status_changed"] else "",
                "X" if o["status"] != "passed" else "",
            ])
            test_cell = o["name"]
            if o.get("spec_file"):
                test_cell += f"\n[dim]{o['spec_file']}[/dim]"
            tbl.add_row(
                fmt_duration(o["prev_duration_s"]),
                f"x{o['retries']}",
                fmt_duration(o["final_duration_s"]),
                flags,
                test_cell,
            )
        _console.print(tbl)
        print(f"  ({len(offenders)} total tests with retries in this job)")

    # Per-suite: aggregate across all jobs
    for suite_key, (header, offenders) in agg_offenders.items():
        pretty = suite_key.upper().replace("NOVA-E2E-", "").replace("-TESTS", "")
        print()
        print("=" * 70)
        print(f"TOP 20 RETRY OFFENDERS — {pretty} AGGREGATE  ({header})")
        print("=" * 70)
        if not offenders:
            print("(no retries found)")
            continue
        total_jobs = offenders[0]["total_jobs"]
        tbl = Table(box=rich_box.ROUNDED, show_header=True,
                    header_style="bold", show_edge=True)
        tbl.add_column("waste", justify="right")
        tbl.add_column("retries", justify="right")
        tbl.add_column("seen in", justify="right")
        tbl.add_column("avg pass", justify="right")
        tbl.add_column("flags")
        tbl.add_column("test")
        for o in offenders[:20]:
            flags = "".join([
                "F" if o["ever_flaky"] else "",
                "C" if o["ever_status_changed"] else "",
                "X" if o["ever_failed"] else "",
            ])
            seen = f"{o['jobs_with_retries']}/{total_jobs}"
            avg_final = o["total_final_s"] / o["jobs_with_retries"]
            test_cell = o["name"]
            if o.get("spec_file"):
                test_cell += f"\n[dim]{o['spec_file']}[/dim]"
            tbl.add_row(
                fmt_duration(o["total_waste_s"]),
                f"x{o['total_retries']}",
                seen,
                fmt_duration(avg_final),
                flags,
                test_cell,
            )
        _console.print(tbl)
        print(f"  ({len(offenders)} tests with retries across {total_jobs} jobs)")

    if recent_offenders or agg_offenders:
        print()
        print("flags: F=ever marked flaky  C=ever changed status across retries  "
              "X=ever ultimately failed")

    print()
    print("=" * 70)
    print(f"{CHECKOUT_JOB} DURATION (env lease)")
    print("=" * 70)
    if checkout_durations:
        d = sorted(checkout_durations)
        print(f"Samples:  {len(d)}")
        print(f"p50:      {fmt_min(percentile(d, 0.5))}")
        print(f"p95:      {fmt_min(percentile(d, 0.95))}")
        print(f"max:      {fmt_min(max(d))}")


if __name__ == "__main__":
    main()