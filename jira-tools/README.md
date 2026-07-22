# Jira Tools

Python scripts to measure and visualize the AI impact on cycle time across the team.

## Scripts

| Script | Folder | What it does |
|---|---|---|
| `jira_team_report.py` | `team_report/` | Computes average cycle time per member and team for each SP. Only tickets closed before `BEFORE_AI_DATE` (2026-04-17). Outputs to `output/team/`. |
| `jira_ai_report.py` | `ai_report/` | Same but restricted to `ai-implemented` automation tickets closed on or after 2026-03-20. Outputs to `output/ai/`. Run this to refresh AI data. |
| `jira_html_report.py` | `html_report/` | Reads both outputs and generates a self-contained HTML report. Outputs `output/ai_impact_report.html`. No Jira credentials needed. |

## Usage

```bash
# 1. Refresh AI data (most common — run as new ai-implemented tickets accumulate)
python3 ai_report/jira_ai_report.py

# 2. Regenerate the HTML report
python3 html_report/jira_html_report.py

# 3. Regenerate baseline data (only needed if the team or BEFORE_AI_DATE changes)
python3 team_report/jira_team_report.py
```

## Output structure

```
output/
  team/                    # baseline CSVs (pre-AI)
  ai/                      # AI CSVs
  ai_impact_report.html    # final report
```

## Setup

### 1. Install dependencies

```bash
pip install requests
```

### 2. Configure credentials

```bash
export JIRA_BASE_URL="https://your-domain.atlassian.net"
export JIRA_EMAIL="your-email@example.com"
export JIRA_API_TOKEN="your-api-token"
```

> Generate an API token at: https://id.atlassian.com/manage-profile/security/api-tokens
