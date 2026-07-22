"""
Author: Rachel Garza @rachelgarza-tc
Slack: @Rachel Garza

Report integration branch deployment health for the last day.

Pulls all pipelines on the integration branch since midnight CST (today),
fetches every workflow in each pipeline, and reports:

  - Per-workflow summary: runs, pass/fail counts, pass rate
  - Per-pipeline breakdown showing all workflow statuses
  - Failed job names for any failed workflow
  - Direct CircleCI links for failures
  - `python3 open_trace.py <job>` hints for failed nova-e2e jobs

To run:
    $ python integration_e2e_report.py

Set CIRCLE_TOKEN env var to override the default token.
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

import requests

# ---- Configuration -------------------------------------------------------
CIRCLE_TOKEN = os.environ.get(
    "CIRCLE_TOKEN",
    "YOUR_TOKEN_HERE",  # <-- REPLACE THIS WITH YOUR TOKEN (or set CIRCLE_TOKEN env var
)
PROJECT_SLUG = "github/tunecore/tc-www"
BRANCH = "integration"
# --------------------------------------------------------------------------

API = "https://circleci.com/api/v2"
HEADERS = {"Circle-Token": CIRCLE_TOKEN, "Accept": "application/json"}

SESSION = requests.Session()
SESSION.headers.update(HEADERS)
SESSION.mount(
    "https://",
    requests.adapters.HTTPAdapter(pool_connections=8, pool_maxsize=8, max_retries=3),
)


# ============================================================================
# CircleCI API helpers
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


# ============================================================================
# Timezone helper
# ============================================================================

def midnight_central() -> datetime:
    """Return today's midnight in America/Chicago (handles CST/CDT automatically)."""
    try:
        from zoneinfo import ZoneInfo  # Python 3.9+
        tz = ZoneInfo("America/Chicago")
    except ImportError:
        tz = timezone(timedelta(hours=-5))
    now = datetime.now(tz)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


# ============================================================================
# Data fetching
# ============================================================================

def pipelines_since(since: datetime) -> list[dict]:
    """
    Fetch integration branch pipelines created on or after `since`.
    Stops early once a pipeline older than `since` is encountered
    (CircleCI returns newest-first).
    """
    out = []
    for p in paginate(f"/project/{PROJECT_SLUG}/pipeline", branch=BRANCH):
        created_at = p.get("created_at", "")
        if not created_at:
            continue
        if parse_iso(created_at) < since:
            break
        out.append(p)
    return out


def workflows_for_pipeline(pipeline_id: str) -> list[dict]:
    """Return all workflow entries for a single pipeline."""
    return list(paginate(f"/pipeline/{pipeline_id}/workflow"))


def failed_jobs_for_workflow(workflow_id: str) -> list[dict]:
    """Return name + job_number for each failed/errored job in a workflow."""
    FAIL_STATUSES = {"failed", "failing", "error", "infrastructure_fail", "timedout"}
    return [
        {"name": job["name"], "job_number": job.get("job_number")}
        for job in paginate(f"/workflow/{workflow_id}/job")
        if job.get("status") in FAIL_STATUSES
    ]


# ============================================================================
# Formatting helpers
# ============================================================================

STATUS_ICON = {
    "success":        "✓",
    "failed":         "✗",
    "failing":        "✗",
    "running":        "●",
    "on_hold":        "⏸",
    "canceled":       "⊘",
    "error":          "!",
    "not_run":        "-",
    "unauthorized":   "?",
}
FAIL_STATUSES = {"failed", "failing", "error", "infrastructure_fail", "timedout"}


def fmt_duration(seconds: float) -> str:
    if seconds < 60:
        return f"{seconds:.0f}s"
    if seconds < 3600:
        return f"{seconds / 60:.1f}m"
    return f"{seconds / 3600:.1f}h"


def workflow_url(pipeline_num: int | str, workflow_id: str) -> str:
    return (
        f"https://app.circleci.com/pipelines/{PROJECT_SLUG}"
        f"/{pipeline_num}/workflows/{workflow_id}"
    )


def _supports_osc8() -> bool:
    return os.environ.get("TERM_PROGRAM", "") in (
        "iTerm.app", "WezTerm", "Hyper", "vscode", "ghostty", "rio"
    )


def hyperlink(url: str, text: str | None = None) -> str:
    """Return a clickable OSC 8 hyperlink in supported terminals, underlined URL otherwise."""
    label = text if text is not None else url
    if _supports_osc8():
        return f"\033]8;;{url}\033\\{label}\033]8;;\033\\"
    return f"\033[4m{url}\033[24m"


# ============================================================================
# Main
# ============================================================================

def main() -> None:
    since = midnight_central()
    print(f"Integration branch · deployment health report")
    print(f"Window: {since.strftime('%Y-%m-%d %H:%M %Z')} → now\n")

    # ---- Fetch pipelines -------------------------------------------------------
    print("Fetching pipelines...", end="", flush=True)
    pipelines = pipelines_since(since)
    print(f" {len(pipelines)} found\n")

    if not pipelines:
        print("No pipelines found since midnight. Nothing to report.")
        sys.exit(0)

    # ---- Collect all workflow results per pipeline ----------------------------
    print("Fetching workflow statuses...", end="", flush=True)

    pipeline_rows: list[dict] = []   # one entry per pipeline
    all_wf_rows:   list[dict] = []   # flat list for summary stats

    for p in pipelines:
        pipeline_num = p.get("number", "?")
        vcs          = p.get("vcs", {})
        commit_sha   = vcs.get("revision", "")[:8]
        commit_msg   = (vcs.get("commit") or {}).get("subject", "")[:72]
        created_at   = p.get("created_at", "")

        wf_rows: list[dict] = []
        for wf in workflows_for_pipeline(p["id"]):
            status  = wf.get("status", "unknown")
            started = wf.get("created_at", "")
            stopped = wf.get("stopped_at")

            duration: float | None = None
            if started and stopped:
                duration = (parse_iso(stopped) - parse_iso(started)).total_seconds()

            failed_jobs: list[dict] = []
            if status in FAIL_STATUSES:
                failed_jobs = failed_jobs_for_workflow(wf["id"])

            row = {
                "pipeline_num": pipeline_num,
                "wf_id":        wf["id"],
                "wf_name":      wf.get("name", "unknown"),
                "created_at":   created_at,
                "commit":       commit_sha,
                "commit_msg":   commit_msg,
                "status":       status,
                "duration":     duration,
                "failed_jobs":  failed_jobs,
            }
            wf_rows.append(row)
            all_wf_rows.append(row)

        pipeline_rows.append({
            "pipeline_num": pipeline_num,
            "commit":       commit_sha,
            "commit_msg":   commit_msg,
            "created_at":   created_at,
            "workflows":    wf_rows,
        })

    print(f" done\n")

    if not all_wf_rows:
        print("No workflows found in today's pipelines.")
        sys.exit(0)

    # ---- Summary: one row per workflow type ----------------------------------
    by_workflow: dict[str, list[dict]] = defaultdict(list)
    for r in all_wf_rows:
        by_workflow[r["wf_name"]].append(r)

    total_pipelines = len(pipeline_rows)
    print("=" * 70)
    print(f"SUMMARY  ({total_pipelines} pipeline{'s' if total_pipelines != 1 else ''} since midnight CST)")
    print("=" * 70)
    print(f"  {'Workflow':<24}  {'Runs':>4}  {'✓':>4}  {'✗':>4}  {'●':>4}  {'Pass Rate':>9}")
    print(f"  {'-'*24}  {'-'*4}  {'-'*4}  {'-'*4}  {'-'*4}  {'-'*9}")

    for wf_name in sorted(by_workflow):
        rows    = by_workflow[wf_name]
        total   = len(rows)
        passed  = sum(1 for r in rows if r["status"] == "success")
        failed  = sum(1 for r in rows if r["status"] in FAIL_STATUSES)
        running = sum(1 for r in rows if r["status"] == "running")
        rate    = passed / (passed + failed) * 100 if (passed + failed) > 0 else None
        rate_str = f"{rate:.0f}%" if rate is not None else "—"
        print(f"  {wf_name:<24}  {total:>4}  {passed:>4}  {failed:>4}  {running:>4}  {rate_str:>9}")

    print()

    # ---- Per-pipeline detail -------------------------------------------------
    print("=" * 70)
    print("PIPELINE DETAILS  (newest first)")
    print("=" * 70)

    for p_row in pipeline_rows:
        commit_str = p_row["commit"] or "—"
        msg        = p_row["commit_msg"] or "—"
        print(f"\n  Pipeline #{p_row['pipeline_num']}  ·  {commit_str}  ·  {msg}")

        for wf in p_row["workflows"]:
            icon       = STATUS_ICON.get(wf["status"], "?")
            status_str = f"{icon} {wf['status']}"
            dur_str    = fmt_duration(wf["duration"]) if wf["duration"] is not None else "—"
            print(f"    {wf['wf_name']:<24}  {status_str:<14}  {dur_str:>8}")

            for job in wf["failed_jobs"]:
                jnum     = job.get("job_number")
                jnum_str = f"  (job {jnum})" if jnum else ""
                print(f"    {'':>24}  {'':>14}  {'':>8}  ↳ failed: {job['name']}{jnum_str}")

    print()

    # ---- Failure detail ------------------------------------------------------
    failures = [r for r in all_wf_rows if r["status"] in FAIL_STATUSES]
    if failures:
        # Group by pipeline so multi-workflow failures are consolidated
        failures_by_pipeline: dict[str, list[dict]] = defaultdict(list)
        for r in failures:
            failures_by_pipeline[str(r["pipeline_num"])].append(r)

        print("=" * 70)
        print(f"FAILURE DETAILS  ({len(failures)} failed workflow run{'s' if len(failures) != 1 else ''})")
        print("=" * 70)

        for pipeline_num in sorted(failures_by_pipeline, key=lambda x: int(x) if str(x).isdigit() else 0, reverse=True):
            wf_failures = failures_by_pipeline[pipeline_num]
            first       = wf_failures[0]
            time_str    = parse_iso(first["created_at"]).strftime("%H:%M UTC")
            print(f"\n  Pipeline #{pipeline_num}  ·  triggered {time_str}  ·  commit {first['commit']}")
            if first["commit_msg"]:
                print(f"  Message:  {first['commit_msg']}")

            for r in wf_failures:
                print(f"\n    [{r['wf_name']}]  {r['status']}")
                if r["failed_jobs"]:
                    print(f"    Failed jobs:")
                    for job in r["failed_jobs"]:
                        jnum     = job.get("job_number")
                        jnum_str = f"  → job {jnum}" if jnum else ""
                        print(f"      - {job['name']}{jnum_str}")
                        if jnum and r["wf_name"] == "nova-e2e":
                            print(f"        python3 open_trace.py {jnum} --failed")
                url = workflow_url(pipeline_num, r['wf_id'])
                print(f"    URL: {hyperlink(url)}")
                print(f"    \033[3m⌘+double-click to open in your browser\033[23m")

        print()
    else:
        print("All completed workflows passed today.")
        print()


if __name__ == "__main__":
    main()
