"""
Extract the WWW AGGREGATE section from the retry report and post it to Slack.

Required env vars:
  SLACK_BOT_TOKEN       Slack bot OAuth token
  SLACK_CHANNEL_ID      Target channel ID
  REPORT_URL            Link to the GitHub Actions run (for "View full report")
  REPORT_FILE           Path to the report text file (default: retry-report.txt)
"""

import os
import re
import sys

import requests


def extract_www_aggregate(report_text: str) -> str:
    m = re.search(
        r"(={10,}\nWWW AGGREGATE.*?\n={10,}\n.*?)(?=\n={10,}|\Z)",
        report_text,
        re.DOTALL,
    )
    return m.group(1).strip() if m else ""


def send_to_slack(token: str, channel: str, section: str, report_url: str) -> None:
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "E2E Retry Weekly Report"},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"```{section}```"},
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"<{report_url}|View full report>"},
        },
    ]
    resp = requests.post(
        "https://slack.com/api/chat.postMessage",
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json={"channel": channel, "text": "E2E Retry Weekly Report", "blocks": blocks},
        timeout=30,
    )
    resp.raise_for_status()
    result = resp.json()
    if not result.get("ok"):
        raise RuntimeError(f"Slack API error: {result.get('error')}")
    print("Slack message sent.")


def main() -> None:
    token = os.environ["SLACK_BOT_TOKEN"]
    channel = os.environ["SLACK_CHANNEL_ID"]
    report_url = os.environ.get("REPORT_URL", "")
    report_file = os.environ.get("REPORT_FILE", "retry-report.txt")

    text = open(report_file).read()
    section = extract_www_aggregate(text)

    if not section:
        print("ERROR: WWW AGGREGATE section not found in report.", file=sys.stderr)
        sys.exit(1)

    send_to_slack(token, channel, section, report_url)


if __name__ == "__main__":
    main()
