"""
Jira AI Report — Update Script
---------------------------
Refreshes ONLY the ai-implemented data. Run this as new ai-implemented
tickets accumulate (the baseline data in team_output/ never changes).

Restricted to automation tickets labeled 'ai-implemented' closed on or
after 2026-04-20. For each (assignee, SP) combination it:
  - Saves an individual CSV to output/ai/
  - Saves a team summary CSV per SP to output/ai/

For the first-time / full run (baseline + AI together), use:
  python3 full_report/jira_full_report.py

Usage:
  python3 ai_report/jira_ai_report.py

Setup:
  export JIRA_BASE_URL="https://your-domain.atlassian.net"
  export JIRA_EMAIL="your-email@example.com"
  export JIRA_API_TOKEN="your-api-token"
"""

import csv
import os
import sys
from datetime import datetime
from typing import Optional
import requests

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, ROOT)

from utils.jira_client import find_account_id, fetch_ai_tickets, AI_START_DATE     # noqa: E402
from utils.cycle_time_utils import format_cycle_time, process_ticket, exclude_outliers_q3  # noqa: E402
from utils.team_settings import TEAM, STORY_POINTS                    # noqa: E402

OUTPUT_DIR = os.path.join(ROOT, "output", "ai")


# ---------------------------------------------------------------------------
# Per-member processing
# ---------------------------------------------------------------------------

def process_member(assignee: str, sp: int) -> Optional[dict]:
    """
    Fetch and process ai-implemented automation tickets for one team member.
    Returns a summary dict, or None if the member has no matching tickets.
    """
    try:
        account_id = find_account_id(assignee)
    except requests.HTTPError as e:
        print(f"    ❌ Could not look up '{assignee}': {e}")
        return None

    if not account_id:
        print(f"    ❌ No Jira user found for '{assignee}', skipping.")
        return None

    issues = fetch_ai_tickets(account_id, sp)
    if not issues:
        print(f"    — No ai-implemented tickets found.")
        return None

    rows = []
    for issue in issues:
        try:
            rows.append(process_ticket(issue))
        except (requests.HTTPError, requests.ConnectionError) as e:
            print(f"    ERROR processing {issue['key']}: {e}")

    no_progress = [r for r in rows if r["Cycle Time"] == "No In Progress found"]
    rows = [r for r in rows if r["Cycle Time"] != "No In Progress found"]
    if no_progress:
        print(f"    ⚠️  {len(no_progress)} ticket(s) with no In Progress excluded")

    ai_start_dt = datetime.strptime(AI_START_DATE, "%Y-%m-%d")
    before_count = len(rows)
    rows = [r for r in rows if datetime.strptime(r["Started At"], "%m/%d/%Y %H:%M") >= ai_start_dt]
    excluded_early = before_count - len(rows)
    if excluded_early:
        print(f"    🗓  {excluded_early} ticket(s) excluded (In Progress before {AI_START_DATE})")

    rows, excluded_outliers = exclude_outliers_q3(rows)
    if excluded_outliers:
        print(f"    📊 {len(excluded_outliers)} outlier(s) excluded (above Q3)")

    durations = [r["cycle_time_seconds"] for r in rows if r["cycle_time_seconds"] is not None]
    avg_seconds = sum(durations) / len(durations) if durations else None
    avg_str = format_cycle_time(avg_seconds) if avg_seconds is not None else "N/A"

    print(f"    ✅ {len(rows)} ticket(s) | Average: {avg_str}")

    return {
        "assignee": assignee,
        "sp": sp,
        "ticket_count": len(rows),
        "avg_seconds": avg_seconds,
        "avg_str": avg_str,
        "rows": rows,
        "no_progress": no_progress,
        "excluded_outliers": excluded_outliers,
    }


# ---------------------------------------------------------------------------
# CSV writers
# ---------------------------------------------------------------------------

def save_individual_csv(result: dict) -> None:
    first_name = result["assignee"].strip().split()[0]
    filepath = os.path.join(OUTPUT_DIR, f"{first_name}_sp{result['sp']}_ai.csv")

    fieldnames = ["Ticket", "Assignee", "Story Points", "Started At", "Closed At", "Cycle Time"]
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(result["rows"])

        excluded = result["no_progress"] + result["excluded_outliers"]
        if excluded:
            writer.writerow({})
            writer.writerow({"Ticket": "--- Excluded ---"})
            for r in result["no_progress"]:
                writer.writerow({**r, "Assignee": f"{r['Assignee']} (no In Progress)"})
            for r in result["excluded_outliers"]:
                writer.writerow({**r, "Assignee": f"{r['Assignee']} (outlier)"})

        writer.writerow({})
        writer.writerow({
            "Ticket": f"Total: {result['ticket_count']} ticket(s)",
            "Assignee": f"Average cycle time: {result['avg_str']}",
        })

    print(f"    💾 {os.path.basename(filepath)}")


def save_summary_csv(sp: int, results: list) -> None:
    filepath = os.path.join(OUTPUT_DIR, f"team_summary_sp{sp}_ai.csv")

    valid = [r for r in results if r is not None and r["avg_seconds"] is not None]

    fieldnames = ["Assignee", "Ticket Count", "Average Cycle Time"]
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            if r is None:
                continue
            writer.writerow({
                "Assignee": r["assignee"],
                "Ticket Count": r["ticket_count"],
                "Average Cycle Time": r["avg_str"],
            })

        if valid:
            team_avg_seconds = sum(r["avg_seconds"] for r in valid) / len(valid)
            team_total = sum(r["ticket_count"] for r in valid)
            writer.writerow({})
            writer.writerow({
                "Assignee": "TEAM AVERAGE",
                "Ticket Count": team_total,
                "Average Cycle Time": format_cycle_time(team_avg_seconds),
            })

    print(f"\n  📋 Team summary SP{sp} (ai-implemented): {os.path.basename(filepath)}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    print(f"\nOutput folder: {os.path.abspath(OUTPUT_DIR)}\n")

    for sp in STORY_POINTS:
        print(f"\n{'='*60}")
        print(f"  SP {sp} | ai-implemented")
        print(f"{'='*60}")

        sp_results = []
        for assignee in TEAM:
            print(f"\n  👤 {assignee}")
            result = process_member(assignee, sp)
            sp_results.append(result)
            if result is not None:
                save_individual_csv(result)

        save_summary_csv(sp, sp_results)

    print(f"\n✅ All done! Output saved to: {os.path.abspath(OUTPUT_DIR)}")


if __name__ == "__main__":
    main()
