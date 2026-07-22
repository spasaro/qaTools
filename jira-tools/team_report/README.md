# Jira Team Report

Runs the dev cycle report for every team member across all configured story points (1, 2, 3, 5).

For each (assignee, SP) combination it computes the average cycle time — the duration from the **last "In Progress" transition** to when the ticket was **Closed** — using all tickets as well as only automation tickets.

Only tickets with `updatedDate < 2026-04-17` are considered (defined as `BEFORE_AI_DATE` in `utils/jira_client.py`). This cutoff ensures the baseline reflects pre-AI work only.

Outliers are excluded via the **IQR method** (upper fence = Q3 + 1.5 × IQR). Tickets with no "In Progress" transition are always excluded.

## Output

All files are written to `output/team/` at the repo root.

**Per-member files** (one per assignee × SP × filter combination):

| File pattern | Contents |
|---|---|
| `<Name>_sp<N>.csv` | All closed tickets for that member and SP |
| `<Name>_sp<N>_only_auto.csv` | Automation tickets only (`summary ~ "Automat*"`) |

**Team summary files** (one per SP × filter combination):

| File pattern | Contents |
|---|---|
| `team_summary_sp<N>.csv` | Average cycle time per member + team average, all tickets |
| `team_summary_sp<N>_only_auto.csv` | Same, automation tickets only |

Each CSV includes excluded tickets (no In Progress, outliers) appended at the bottom.

## Usage

```bash
python3 team_report/jira_team_report.py
```



## Setup

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_EMAIL="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

> Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens
