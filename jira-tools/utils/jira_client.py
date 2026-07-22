"""
Shared Jira API client — configuration, session, and common query functions.
Used by all scripts in this repository.
"""

import os
from typing import List, Optional
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# ---- CONFIGURATION ----
JIRA_BASE_URL  = os.environ.get("JIRA_BASE_URL", "https://support-tech.atlassian.net")
JIRA_EMAIL     = os.environ.get("JIRA_EMAIL", "your-email@tunecore.com")
JIRA_API_TOKEN = os.environ.get("JIRA_API_TOKEN", "your-api-token")
PROJECT_KEY    = "QAE2ETC"
BEFORE_AI_DATE = "2026-04-17"
AI_START_DATE  = "2026-04-20"
# -----------------------

_retry = Retry(total=3, backoff_factor=2, status_forcelist=[429, 500, 502, 503, 504])
SESSION = requests.Session()
SESSION.auth = (JIRA_EMAIL, JIRA_API_TOKEN)
SESSION.headers.update({"Accept": "application/json"})
SESSION.mount("https://", HTTPAdapter(max_retries=_retry))


def find_account_id(display_name: str) -> Optional[str]:
    """Search for a Jira user by display name and return their accountId."""
    url = f"{JIRA_BASE_URL}/rest/api/3/user/search"
    response = SESSION.get(url, params={"query": display_name}, timeout=15)
    response.raise_for_status()
    users = response.json()
    if not users:
        return None
    for user in users:
        if user.get("displayName", "").lower() == display_name.lower():
            return user["accountId"]
    return users[0]["accountId"]


def fetch_tickets(account_id: str, story_points: int, only_auto: bool = False) -> List[dict]:
    """Fetch all closed tickets for the given assignee, filter by SP in Python."""
    url = f"{JIRA_BASE_URL}/rest/api/3/search/jql"
    auto_filter = 'AND summary ~ "Automat*" ' if only_auto else ''
    jql = (
        f'project = {PROJECT_KEY} '
        f'AND assignee = "{account_id}" '
        f'{auto_filter}'
        f'AND status = Closed '
        f'AND updatedDate < "{BEFORE_AI_DATE}" '
        f'ORDER BY updated DESC'
    )

    results = []
    next_page_token = None

    while True:
        body = {
            "jql": jql,
            "fields": ["summary", "customfield_10005", "status", "assignee", "updated"],
            "maxResults": 50,
        }
        if next_page_token:
            body["nextPageToken"] = next_page_token

        response = SESSION.post(url, json=body, timeout=30)
        response.raise_for_status()
        data = response.json()
        issues = data.get("issues", [])

        for issue in issues:
            sp = issue["fields"].get("customfield_10005")
            if sp is not None and int(sp) == story_points:
                results.append(issue)

        next_page_token = data.get("nextPageToken")
        if not issues or not next_page_token:
            break

    return results


def fetch_ai_tickets(account_id: str, story_points: int) -> List[dict]:
    """Fetch closed automation tickets labeled 'ai-implemented' for the given assignee.

    Only considers tickets closed on or after AI_START_DATE (2026-03-20).
    """
    url = f"{JIRA_BASE_URL}/rest/api/3/search/jql"
    jql = (
        f'project = {PROJECT_KEY} '
        f'AND assignee = "{account_id}" '
        f'AND summary ~ "Automat*" '
        f'AND labels = "ai-implemented" '
        f'AND status = Closed '
        f'AND updatedDate >= "{AI_START_DATE}" '
        f'ORDER BY updated DESC'
    )

    results = []
    next_page_token = None

    while True:
        body = {
            "jql": jql,
            "fields": ["summary", "customfield_10005", "status", "assignee", "updated"],
            "maxResults": 50,
        }
        if next_page_token:
            body["nextPageToken"] = next_page_token

        response = SESSION.post(url, json=body, timeout=30)
        response.raise_for_status()
        data = response.json()
        issues = data.get("issues", [])

        for issue in issues:
            sp = issue["fields"].get("customfield_10005")
            if sp is not None and int(sp) == story_points:
                results.append(issue)

        next_page_token = data.get("nextPageToken")
        if not issues or not next_page_token:
            break

    return results


def get_issue(ticket_key: str) -> dict:
    """Fetch a single issue with all relevant fields and its full changelog."""
    url = f"{JIRA_BASE_URL}/rest/api/3/issue/{ticket_key}"
    response = SESSION.get(
        url,
        params={
            "fields": "summary,assignee,customfield_10005,status",
            "expand": "changelog",
        },
        timeout=30,
    )
    response.raise_for_status()
    return response.json()
