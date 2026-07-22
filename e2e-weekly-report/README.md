# E2E Weekly Report

Generates a draft Slack message for the weekly E2E Workflow Execution report.

## What it does

1. Fetches flaky tests from CircleCI Insights (last 7 days, integration branch)
2. Fetches open child stories from the Jira epic `QAE2ETC-2039`
3. Crosses flaky tests with Jira tickets by spec file path
4. Prints the draft Slack message to stdout — ready to copy and paste

## Usage

```bash
CIRCLECI_TOKEN=xxx JIRA_API_TOKEN=xxx JIRA_EMAIL=xxx node generate_weekly_report.js --pass-rate 90%

# With a custom flaky reduction epic
CIRCLECI_TOKEN=xxx JIRA_API_TOKEN=xxx JIRA_EMAIL=xxx node generate_weekly_report.js --pass-rate 90% --flaky-epic QAE2ETC-9999
```

## Required env vars

| Variable | Description |
|----------|-------------|
| `CIRCLECI_TOKEN` | CircleCI personal API token (read-only) |
| `JIRA_API_TOKEN` | Jira personal API token |
| `JIRA_EMAIL` | Jira account email (used for Basic Auth) |

## Optional env vars

| Variable | Default | Description |
|----------|---------|-------------|
| `PROJECT_SLUG` | `gh/tunecore/tc-www` | CircleCI project slug |
| `JIRA_BASE_URL` | `https://support-tech.atlassian.net` | Jira base URL |
| `EPIC_KEY` | `QAE2ETC-2039` | Jira flaky reduction epic (fallback if `--flaky-epic` not passed) |
| `WINDOW` | `last-7-days` | CircleCI reporting window |

## CLI flags

| Flag | Default | Description |
|------|---------|-------------|
| `--pass-rate <value>` | _(required)_ | Pass rate to include in the report (e.g. `90%`) |
| `--flaky-epic <key>` | `QAE2ETC-2039` | Jira epic key to search flaky reduction tickets in |

## Requirements

- Node.js 18+ (uses native `fetch`)
- CircleCI personal API token → [generate one here](https://app.circleci.com/settings/user/tokens)
- Jira personal API token → [generate one here](https://id.atlassian.com/manage-profile/security/api-tokens)
