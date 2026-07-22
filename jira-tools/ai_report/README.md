# Jira AI Report

Computes cycle time for automation tickets labeled **`ai-implemented`**, covering tickets closed on or after **2026-03-20**.

For each (assignee, SP) combination it saves the individual ticket detail and a team summary to `ai_output/`. The logic (IQR outlier exclusion, no-In-Progress filtering) is identical to the baseline team report.

## When to run

Run this script every time new `ai-implemented` tickets are closed and you want to refresh the AI metrics. The baseline data in `team_output/` is never touched.

For a first-time / full run (baseline + AI together), use:

```bash
python3 full_report/jira_full_report.py
```

## Output

All files are written to `ai_output/` at the repo root.

| File pattern | Contents |
|---|---|
| `<Name>_sp<N>_ai.csv` | ai-implemented tickets per member and SP |
| `team_summary_sp<N>_ai.csv` | Average cycle time per member + team average |

## Usage

```bash
python3 ai_report/jira_ai_report.py
```

## Setup

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_EMAIL="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

> Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens
