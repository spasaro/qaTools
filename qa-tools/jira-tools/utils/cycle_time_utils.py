"""
Shared cycle time helpers — status mappings, changelog parsing, formatting,
ticket processing, and outlier exclusion.
Used by all scripts that compute cycle time.
"""

from datetime import datetime
from typing import Optional, Tuple, List

IN_PROGRESS_STATUSES = {"dev in progress", "in progress"}
CLOSED_STATUSES      = {"closed", "done"}


def extract_cycle_time(changelog_histories: list) -> Tuple[Optional[str], Optional[str]]:
    """
    Find the LAST transition to an In Progress status and the transition to Closed.
    Returns (in_progress_dt_str, closed_dt_str) or (None, None).
    """
    last_in_progress = None
    closed_at = None

    for history in changelog_histories:
        for item in history.get("items", []):
            if item.get("field") != "status":
                continue
            to_status = (item.get("toString") or "").lower()
            if to_status in IN_PROGRESS_STATUSES:
                last_in_progress = history["created"]
            if to_status in CLOSED_STATUSES:
                closed_at = history["created"]

        if last_in_progress and closed_at:
            break

    return last_in_progress, closed_at


def parse_datetime(dt_str: str) -> datetime:
    """Parse a Jira timestamp string into a datetime object."""
    return datetime.strptime(dt_str, "%Y-%m-%dT%H:%M:%S.%f%z")


def format_cycle_time(delta_seconds: float) -> str:
    """Format a duration in seconds to a human-readable string."""
    total_seconds = int(delta_seconds)
    days, remainder = divmod(total_seconds, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, _ = divmod(remainder, 60)

    parts = []
    if days:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return " ".join(parts) if parts else "< 1 minute"


def process_ticket(issue: dict) -> dict:
    """Fetch the full changelog for an issue and compute its cycle time."""
    from utils.jira_client import get_issue  # local import to avoid circular deps

    key = issue["key"]
    fields = issue["fields"]
    assignee = (fields.get("assignee") or {}).get("displayName", "Unknown")
    sp = fields.get("customfield_10005")

    full_issue = get_issue(key)
    histories = full_issue.get("changelog", {}).get("histories", [])

    in_progress_str, closed_str = extract_cycle_time(histories)

    if not in_progress_str:
        return {
            "Ticket": key,
            "Assignee": assignee,
            "Story Points": int(sp) if sp else None,
            "Started At": "N/A",
            "Closed At": "N/A",
            "Cycle Time": "No In Progress found",
            "cycle_time_seconds": None,
        }

    started = parse_datetime(in_progress_str)
    closed = parse_datetime(closed_str)
    delta_seconds = (closed - started).total_seconds()

    return {
        "Ticket": key,
        "Assignee": assignee,
        "Story Points": int(sp) if sp else None,
        "Started At": started.strftime("%m/%d/%Y %H:%M"),
        "Closed At": closed.strftime("%m/%d/%Y %H:%M"),
        "Cycle Time": format_cycle_time(delta_seconds),
        "cycle_time_seconds": delta_seconds,
    }


def _percentile(sorted_values: list, p: float) -> float:
    """Linear interpolation percentile on a sorted list (0 <= p <= 1)."""
    n = len(sorted_values)
    if n == 1:
        return sorted_values[0]
    idx = p * (n - 1)
    lo, hi = int(idx), min(int(idx) + 1, n - 1)
    return sorted_values[lo] + (idx - lo) * (sorted_values[hi] - sorted_values[lo])


def exclude_outliers_q3(rows: List[dict]) -> Tuple[List[dict], List[dict]]:
    """Exclude tickets whose cycle time is above Q3 (75th percentile).

    Returns (kept_rows, excluded_rows).
    """
    durations = sorted(
        r["cycle_time_seconds"]
        for r in rows
        if r.get("cycle_time_seconds") is not None
    )
    if len(durations) < 2:
        return rows, []

    q3 = _percentile(durations, 0.75)
    kept = [r for r in rows if r.get("cycle_time_seconds") is not None and r["cycle_time_seconds"] <= q3]
    excluded = [r for r in rows if r.get("cycle_time_seconds") is not None and r["cycle_time_seconds"] > q3]
    return kept, excluded
