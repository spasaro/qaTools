# Flaky Test Report

Fetches all flaky E2E tests from the `nova-e2e` CircleCI workflow (integration branch) and generates an HTML report sorted by fail rate.

Uses the CircleCI Insights v2 API — no local state, no threshold: every test marked as flaky by CircleCI is included.

## Usage

```bash
export CIRCLECI_TOKEN=your_token_here
node generate-report.js
```

Opens `flaky-report.html` in your browser to see the results.

### Options

| Flag | Description |
|------|-------------|
| `--window <value>` | Reporting window: `last-7-days`, `last-30-days`, `last-90-days`. Default: `last-7-days`. |
| `--output <file>` | Write the HTML to a custom path (default: `flaky-report.html`) |
| `--debug` | Print the raw CircleCI API response to stderr |

## Requirements

- Node.js 18+ (uses native `fetch`)
- A CircleCI Personal API Token with read scope → [generate one here](https://app.circleci.com/settings/user/tokens)
