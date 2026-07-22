"""
Author: Rachel Garza @rachelgarza-tc
Slack: @Rachel Garza
Open the Playwright trace for a failed test from a CircleCI e2e job.

Given a CircleCI job number (e.g. from integration_e2e_report.py), this script:
  1. Downloads all test-case artifacts from the job
  2. Filters for failed tests that have a Playwright trace attachment
  3. Presents an interactive numbered menu to pick a test
  4. Downloads the trace.zip and opens it with `playwright show-trace`

Usage:
    python open_trace.py <job_number>

Example:
    python open_trace.py 12345

Set CIRCLE_TOKEN env var to override the default token.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests

# ---- Configuration -----------------------------------------------------------
CIRCLE_TOKEN = os.environ.get(
    "CIRCLE_TOKEN",
    "YOUR_TOKEN_HERE",  # <-- REPLACE THIS WITH YOUR TOKEN (or set CIRCLE_TOKEN env var
)
PROJECT_SLUG = "github/tunecore/tc-www"
DOWNLOAD_THREADS = 24
# ------------------------------------------------------------------------------

RED = "\033[1;31m"
YELLOW = "\033[1;33m"
RESET = "\033[0m"

API = "https://circleci.com/api/v2"
HEADERS = {"Circle-Token": CIRCLE_TOKEN, "Accept": "application/json"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)
SESSION.mount(
    "https://",
    requests.adapters.HTTPAdapter(
        pool_connections=DOWNLOAD_THREADS,
        pool_maxsize=DOWNLOAD_THREADS,
        max_retries=3,
    ),
)


# ============================================================================
# CircleCI API helpers (same pattern as measure_e2e_retries.py)
# ============================================================================

def get(path: str, **params: Any) -> dict:
    r = SESSION.get(f"{API}{path}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def paginate(path: str, **params: Any):
    """Yield items across CircleCI's page_token-based pagination."""
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


def list_artifacts(job_number: int) -> list[dict]:
    return list(paginate(f"/project/{PROJECT_SLUG}/{job_number}/artifacts"))


# ============================================================================
# Download helpers
# ============================================================================

def _fetch_json(url: str) -> Any:
    r = SESSION.get(url, timeout=60)
    r.raise_for_status()
    return r.json()


def download_many_json(artifacts: list[dict]) -> list[tuple[dict, Any]]:
    """Parallel JSON download. Returns (artifact_meta, parsed_json) pairs."""
    results: list[tuple[dict, Any]] = []
    with ThreadPoolExecutor(max_workers=DOWNLOAD_THREADS) as ex:
        futures = {ex.submit(_fetch_json, a["url"]): a for a in artifacts}
        for fut in as_completed(futures):
            art = futures[fut]
            try:
                results.append((art, fut.result()))
            except Exception as e:
                print(f"  warning: couldn't download {art.get('path')}: {e}", file=sys.stderr)
    return results


def download_binary(url: str, dest: str) -> None:
    r = SESSION.get(url, timeout=120, stream=True)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)


# ============================================================================
# Trace detection
# ============================================================================

def find_trace_source(test_case: dict) -> str | None:
    """
    Return the attachment source filename (e.g. 'abc123.zip') for the
    Playwright trace in this test case, or None if not present.

    Allure-playwright stores traces as a step attachment, NOT in the top-level
    attachments array. The step looks like:
      { "name": "trace", "attachmentStep": true,
        "attachments": [{ "source": "abc123.zip",
                          "type": "application/vnd.allure.playwright-trace" }] }

    We walk testStage.steps (and beforeStages/afterStages) recursively.
    """
    def scan_steps(steps: list) -> str | None:
        for step in steps or []:
            for att in step.get("attachments") or []:
                source = att.get("source", "")
                if not source:
                    continue
                name = att.get("name", "").lower()
                mime = att.get("type", "")
                if (mime == "application/vnd.allure.playwright-trace"
                        or "trace" in name
                        or (source.endswith(".zip") and step.get("attachmentStep"))):
                    return source
            result = scan_steps(step.get("steps"))
            if result:
                return result
        return None

    for stage_key in ("testStage", "beforeStages", "afterStages"):
        stage = test_case.get(stage_key)
        if isinstance(stage, dict):
            result = scan_steps(stage.get("steps"))
        elif isinstance(stage, list):
            result = scan_steps(stage)
        else:
            continue
        if result:
            return result
    return None


# ============================================================================
# Diagnostics
# ============================================================================

def _search_suites(job: int, term: str) -> None:
    """
    Scan ALL tests in suites.json (not just failed/flaky) for term.
    Shows the raw allure status fields so we can see why a test isn't flagged.
    """
    print(f"Fetching artifact list for job {job}...", end="", flush=True)
    artifacts = list_artifacts(job)
    print(f" {len(artifacts)} artifacts\n")

    suites_arts = [a for a in artifacts if a["path"].endswith("data/suites.json")]
    if not suites_arts:
        print("No suites.json found.")
        return

    needle = term.lower()
    found = 0

    def _walk(node: dict, breadcrumb: str) -> None:
        nonlocal found
        name = node.get("name", "")
        is_file = "/" in name or name in ("suites", "tc-www")
        crumb = breadcrumb if is_file else (f"{breadcrumb} › {name}" if breadcrumb else name)

        uid = node.get("uid")
        if uid and node.get("parentUid") and needle in crumb.lower():
            found += 1
            print(f"  name:               {name}")
            print(f"  full path:          {crumb}")
            print(f"  uid:                {uid}")
            print(f"  status:             {node.get('status')}")
            print(f"  retriesCount:       {node.get('retriesCount')}")
            print(f"  retriesStatusChange:{node.get('retriesStatusChange')}")
            print(f"  flaky:              {node.get('flaky')}")
            print()

        for child in node.get("children") or []:
            _walk(child, crumb)

    print(f"Searching suites.json ({len(suites_arts)} file(s)) for '{term}'...\n")
    for art, data in download_many_json(suites_arts):
        if isinstance(data, dict):
            _walk(data, "")

    if found == 0:
        print(f"  No tests matched '{term}' in suites.json for this job.")
        print("  The test may not have run on this job, or its name is stored differently.")


def get_ci_test_results(job: int) -> list[dict]:
    """Use CircleCI's test metadata API to get what CI itself considers failed/flaky."""
    return list(paginate(f"/project/{PROJECT_SLUG}/{job}/tests"))


def resolve_flakiness_from_ci(candidates: list[dict], job: int) -> int:
    """
    Overrides each candidate's `flaky` field using CircleCI's per-attempt test
    results. A test is flaky if CI recorded at least one pass AND one failure for
    it in this job (meaning it passed on a retry). Falls back to Allure's
    retriesStatusChange for any test whose name isn't found in CI's data.
    Returns the number of candidates whose flaky field was updated.
    """
    try:
        ci_results = get_ci_test_results(job)
    except Exception:
        return 0

    passed: set[str] = set()
    failed: set[str] = set()
    for r in ci_results:
        # CI names are "Describe block › test title" — strip the describe prefix
        # so they match the bare test title stored in Allure's suites.json.
        name = r.get("name", "").rsplit(" › ", 1)[-1]
        if r.get("result") == "success":
            passed.add(name)
        elif r.get("result") in ("failure", "error"):
            failed.add(name)

    flaky_names = passed & failed        # passed at least once after failing → flaky
    hard_failed_names = failed - passed  # never passed → true failure

    updated = 0
    for t in candidates:
        name = t["name"]
        if name in flaky_names:
            t["flaky"] = True
            updated += 1
        elif name in hard_failed_names:
            t["flaky"] = False
            updated += 1

    if updated == 0 and candidates:
        print(f"\n  warning: 0/{len(candidates)} candidates matched CI test names — possible name format mismatch")
        print(f"  sample CI names:        {sorted(failed | passed)[:3]}")
        print(f"  sample candidate names: {[t['name'] for t in candidates[:3]]}")

    return updated


# ============================================================================
# Interactive selection
# ============================================================================

def pick(items: list[str], prompt: str = "Enter number: ") -> int:
    """Display a numbered list, return the 0-based index of the user's pick."""
    for i, label in enumerate(items):
        print(f"  [{i + 1:>3}]  {label}")
    print()
    while True:
        try:
            raw = input(prompt).strip()
        except (EOFError, KeyboardInterrupt):
            print()
            sys.exit(0)
        if raw.isdigit():
            idx = int(raw) - 1
            if 0 <= idx < len(items):
                return idx
        print(f"       Please enter a number from 1 to {len(items)}.")


# ============================================================================
# Main
# ============================================================================

def debug_structure(job: int) -> None:
    """
    Diagnostic mode: show zip artifacts and a sample of test-case attachment
    structures so we can figure out where traces live.
    """
    print(f"Fetching artifact list for job {job}...", end="", flush=True)
    try:
        artifacts = list_artifacts(job)
    except requests.HTTPError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print(f" {len(artifacts)} artifacts\n")

    # Show suites.json structure (this is what the fast-path uses)
    import json
    suites_arts = [a for a in artifacts if a["path"].endswith("data/suites.json")]
    if suites_arts:
        print(f"=== suites.json (showing shard 0) ===")
        try:
            data = _fetch_json(suites_arts[0]["url"])
            # Print first ~3KB to show structure without flood
            print(json.dumps(data, indent=2)[:3000])
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    # Show all zip artifacts
    zip_artifacts = [a for a in artifacts if a["path"].endswith(".zip")]
    print(f"=== .zip artifacts ({len(zip_artifacts)}) ===")
    for a in zip_artifacts[:40]:
        print(f"  [{a.get('node_index', '?')}]  {a['path']}")
    if len(zip_artifacts) > 40:
        print(f"  ... and {len(zip_artifacts) - 40} more")
    print()

    # Sample any artifact path that contains "trace" (case-insensitive)
    trace_like = [a for a in artifacts if "trace" in a["path"].lower()]
    if trace_like:
        print(f"=== artifacts with 'trace' in path ({len(trace_like)}) ===")
        for a in trace_like[:20]:
            print(f"  [{a.get('node_index', '?')}]  {a['path']}")
        print()

    # Download test-case JSONs and inspect them
    tc_artifacts = [
        a for a in artifacts
        if "/data/test-cases/" in a.get("path", "") and a["path"].endswith(".json")
    ]
    print(f"=== test-case files: {len(tc_artifacts)} total ===")

    import json

    # Pass 1: scan for failed/retried tests and show their COMPLETE JSON
    sample_count = 0
    checked = 0
    for art in tc_artifacts:
        if sample_count >= 3:
            break
        checked += 1
        try:
            tc = _fetch_json(art["url"])
        except Exception:
            continue
        status = tc.get("status")
        retries = int(tc.get("retriesCount", 0))
        if status not in ("failed", "broken") and retries == 0:
            continue
        print(f"\n--- FULL JSON: {art['path']}  [shard {art.get('node_index', '?')}] ---")
        print(json.dumps(tc, indent=2))
        sample_count += 1

    print(f"\n(pass 1: checked {checked} test-case files, found {sample_count} failed/retried)")

    # Pass 2: look specifically for the flaky test by scanning for any test-case
    # that has non-empty attachments or steps with attachments
    print("\n=== Scanning for test cases WITH attachments (up to 500 files) ===")
    found_with_att = 0
    for art in tc_artifacts[:500]:
        try:
            tc = _fetch_json(art["url"])
        except Exception:
            continue
        attachments = tc.get("attachments") or []
        # Also check inside steps recursively
        def has_step_attachments(steps):
            for s in steps or []:
                if s.get("attachments"):
                    return True
                if has_step_attachments(s.get("steps")):
                    return True
            return False
        has_att = bool(attachments) or has_step_attachments(tc.get("steps"))
        if has_att:
            print(f"\n--- HAS ATTACHMENTS: {art['path']}  [shard {art.get('node_index', '?')}] ---")
            print(json.dumps(tc, indent=2)[:3000])
            found_with_att += 1
            if found_with_att >= 3:
                break
    if found_with_att == 0:
        print("  (none found in first 500 — attachments may not be in test-case JSON)")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Open the Playwright trace for a failed test from a CircleCI e2e job.",
    )
    parser.add_argument("job_number", type=int, help="CircleCI job number")
    parser.add_argument(
        "--all-retried",
        action="store_true",
        help="Show all retried tests (not just the ones CI flags as failures).",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print all CI-flagged test names and exit (pipe to grep to find the right --filter value).",
    )
    parser.add_argument(
        "--search",
        metavar="WORD",
        help="Search suites.json for ANY test matching WORD (any status) and show its raw allure fields. Useful for diagnosing why a test isn't being flagged.",
    )
    parser.add_argument(
        "--failed",
        action="store_true",
        help="Show only tests that failed after all retries (excludes flaky tests that eventually passed).",
    )
    parser.add_argument(
        "--filter", "-f",
        metavar="WORD",
        help="Case-insensitive substring filter on test name (e.g. --filter lyrics).",
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Dump artifact/attachment structure to diagnose trace detection issues.",
    )
    args = parser.parse_args()

    if args.debug:
        debug_structure(args.job_number)
        return

    if args.search:
        _search_suites(args.job_number, args.search)
        return

    job = args.job_number
    include_all_retried = args.all_retried

    # ---- 1. Fetch artifact list ----------------------------------------------
    print(f"Fetching artifact list for job {job}...", end="", flush=True)
    try:
        artifacts = list_artifacts(job)
    except requests.HTTPError as e:
        print(f"\nERROR: {e}", file=sys.stderr)
        sys.exit(1)
    print(f" {len(artifacts)} artifacts\n")

    # ---- 2. Index artifacts by UID and by basename --------------------------
    tc_arts_by_uid: dict[str, dict] = {
        a["path"].rsplit("/", 1)[-1][:-5]: a
        for a in artifacts
        if "/data/test-cases/" in a["path"] and a["path"].endswith(".json")
    }
    if not tc_arts_by_uid:
        print("No test-case artifacts found. Is this an e2e test job?")
        sys.exit(1)

    artifacts_by_name: dict[str, dict] = {
        a["path"].rsplit("/", 1)[-1]: a for a in artifacts
    }

    # ---- 3. Build candidate list --------------------------------------------
    suites_arts = [a for a in artifacts if a["path"].endswith("data/suites.json")]

    candidates: list[dict] = []

    if suites_arts and not include_all_retried:
        # Fast path: suites.json contains one final-result entry per test with
        # name, status, uid, and retry info — no test-case download needed yet.
        # CI considers a test "failed" if:
        #   status == "failed"       → truly failed (never passed)
        #   retriesStatusChange      → flaky (changed status across retries)
        print(f"Scanning suites.json ({len(suites_arts)} shard file(s))...", end="", flush=True)

        def _walk_suites(node: dict, shard: int, breadcrumb: str = "") -> None:
            node_name = node.get("name", "")
            # Skip the root "suites" node and file-path nodes from the breadcrumb
            # so we get: "Describe block › test name"
            uid = node.get("uid")
            if uid and node.get("parentUid"):  # leaf = test node
                status = node.get("status", "")
                status_changed = node.get("retriesStatusChange", False)
                retries = int(node.get("retriesCount", 0))
                if status in ("failed", "broken") or status_changed:
                    full_name = f"{breadcrumb} › {node_name}" if breadcrumb else node_name
                    candidates.append({
                        "name": node_name,        # short display name
                        "full_name": full_name,   # full path used for filtering
                        "uid": uid,
                        "status": status,
                        "flaky": status_changed and retries > 0,
                        "retries": retries,
                        "duration_s": node.get("time", {}).get("duration", 0) / 1000.0,
                        "shard": shard,
                    })
            else:
                # Accumulate describe-block names (skip file paths and "suites" root)
                is_file_path = "/" in node_name or node_name == "suites"
                next_crumb = breadcrumb if is_file_path else (
                    f"{breadcrumb} › {node_name}" if breadcrumb else node_name
                )
                for child in node.get("children") or []:
                    _walk_suites(child, shard, next_crumb)

        for art, suite_data in download_many_json(suites_arts):
            if isinstance(suite_data, dict):
                _walk_suites(suite_data, art.get("node_index", "?"))

        print(f" {len(candidates)} CI-flagged test(s)\n")

    else:
        # --all-retried: download all test-case files and filter here
        all_tc = list(tc_arts_by_uid.values())
        print(f"Downloading {len(all_tc)} test-case files...", end="", flush=True)
        tc_pairs = download_many_json(all_tc)
        print(f" done\n")
        for art, tc in tc_pairs:
            if not isinstance(tc, dict):
                continue
            status = tc.get("status", "")
            retries = int(tc.get("retriesCount", 0))
            status_changed = tc.get("retriesStatusChange", False)
            if retries == 0 and status not in ("failed", "broken"):
                continue
            candidates.append({
                "name": tc.get("name") or tc.get("fullName", "?"),
                "uid": tc.get("uid", ""),
                "status": status,
                "flaky": status_changed and retries > 0,
                "retries": retries,
                "duration_s": tc.get("time", {}).get("duration", 0) / 1000.0,
                "shard": art.get("node_index", "?"),
            })

    if not candidates:
        print("No CI-flagged tests found in this job.")
        sys.exit(0)

    print("Cross-referencing with CircleCI test results...", end="", flush=True)
    matched = resolve_flakiness_from_ci(candidates, job)
    print(f" matched {matched}/{len(candidates)}\n")

    candidates.sort(key=lambda t: (t["status"] != "failed", t["name"]))

    if args.failed:
        candidates = [t for t in candidates if t["status"] == "broken" or (t["status"] == "failed" and not t["flaky"])]
        if not candidates:
            print("No hard-failed tests found (all flagged tests passed on retry).")
            sys.exit(0)

    # ---- 4. Apply filter and show menu --------------------------------------
    if args.list:
        for t in candidates:
            tag = " [FLAKY]" if t["flaky"] else (" [BROKEN]" if t["status"] == "broken" else (" [FAILED]" if t["status"] == "failed" else ""))
            print(f"{t.get('full_name', t['name'])}{tag}")
        sys.exit(0)

    if args.filter:
        needle = args.filter.lower()
        candidates = [t for t in candidates if needle in t.get("full_name", t["name"]).lower()]
        if not candidates:
            print(f"No tests matched filter '{args.filter}'.")
            sys.exit(0)

    qualifier = "all retried" if include_all_retried else "CI-flagged"
    total = len(candidates)
    print(f"Found {total} {qualifier} test(s):\n")
    print(f"  {RED}red{RESET}    = failed after all retries")
    print(f"  {YELLOW}yellow{RESET} = broken (unexpected crash/error)")
    print()

    labels = []
    for t in candidates:
        tag = " [BROKEN]" if t["status"] == "broken" else (" [FAILED]" if t["status"] == "failed" else (" [FLAKY]" if t["flaky"] else ""))
        dur = f"{t['duration_s']:.1f}s"
        retried = f"  ×{t['retries']} retries" if t["retries"] else ""
        shard = f"  shard {t['shard']}"
        label = f"{t['name']}{tag}  ({dur}{retried}{shard})"
        if t["status"] == "broken":
            labels.append(f"{YELLOW}{label}{RESET}")
        elif t["status"] == "failed" and not t["flaky"]:
            labels.append(f"{RED}{label}{RESET}")
        else:
            labels.append(label)

    # ---- 5. Interactive selection --------------------------------------------
    print()
    choice = pick(labels, prompt="Enter number to open trace (Ctrl-C to quit): ")
    selected = candidates[choice]
    print()

    # ---- 6. Fetch trace for the selected test --------------------------------
    # Now download just this one test-case file to get the trace source.
    print(f"\nFetching trace info for: {selected['name']}")
    tc_art = tc_arts_by_uid.get(selected["uid"])
    if not tc_art:
        print(f"ERROR: could not find test-case artifact for uid {selected['uid']}", file=sys.stderr)
        sys.exit(1)
    tc = _fetch_json(tc_art["url"])

    trace_source = find_trace_source(tc)

    if not trace_source:
        # The trace isn't on the final result — with retries, Playwright attaches
        # the trace to each RETRY ATTEMPT, which is a separate test-case file
        # sharing the same historyId but with a different uid.
        # Scan only the test-case files from the same shard to find it.
        history_id = tc.get("historyId")
        shard = selected["shard"]
        if history_id:
            shard_tc_arts = [
                a for a in artifacts
                if "/data/test-cases/" in a["path"]
                and a["path"].endswith(".json")
                and a.get("node_index") == shard
                and a["path"].rsplit("/", 1)[-1][:-5] != selected["uid"]
            ]
            print(f"  Scanning {len(shard_tc_arts)} shard-{shard} test-case files for retry traces...")
            for art, attempt_tc in download_many_json(shard_tc_arts):
                if not isinstance(attempt_tc, dict):
                    continue
                if attempt_tc.get("historyId") != history_id:
                    continue
                trace_source = find_trace_source(attempt_tc)
                if trace_source:
                    break

    if not trace_source:
        print("No Playwright trace attachment found for this test (checked final result and all retry attempts).")
        sys.exit(1)

    trace_artifact = artifacts_by_name.get(trace_source)
    if not trace_artifact:
        print(f"Trace file '{trace_source}' not found in job artifacts.", file=sys.stderr)
        sys.exit(1)

    # ---- 7. Download trace.zip -----------------------------------------------
    print(f"Downloading trace for: {selected['name']}")
    tmp = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    tmp.close()
    trace_file = tmp.name
    download_binary(trace_artifact["url"], trace_file)
    size_kb = os.path.getsize(trace_file) / 1024
    print(f"  saved {size_kb:.0f} KB → {trace_file}\n")

    # ---- 7. Open in Playwright trace viewer ---------------------------------
    proc = None
    for cmd in (
        ["playwright", "show-trace", trace_file],
        ["npx", "playwright", "show-trace", trace_file],
    ):
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            break
        except FileNotFoundError:
            continue

    if proc is None:
        print("Could not find `playwright` or `npx` in PATH.")
        print(f"Run manually:\n  npx playwright show-trace {trace_file}")
        return

    print("Trace viewer is open in your browser.")
    print("Type 'exit' or press Ctrl+C to close.\n")

    done = threading.Event()
    exited_naturally = False

    def _watch_input() -> None:
        try:
            while not done.is_set():
                line = sys.stdin.readline()
                if not line or line.strip().lower() == "exit":
                    done.set()
        except Exception:
            done.set()

    input_thread = threading.Thread(target=_watch_input, daemon=True)
    input_thread.start()

    try:
        while not done.is_set():
            if proc.poll() is not None:
                exited_naturally = True
                done.set()
                break
            time.sleep(0.3)
    except KeyboardInterrupt:
        done.set()
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        os.unlink(trace_file)
        msg = "\nTrace viewer was closed." if exited_naturally else "\nTrace viewer closed."
        print(msg)


if __name__ == "__main__":
    main()
