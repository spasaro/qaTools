# E2E Retry Analyzer

A Python script that measures how much time Playwright retries cost in the `nova-e2e` CircleCI workflow.

**Author:** Rachel Garza (@rachelgarza-tc)

## What it does

Pulls the last N pipelines on a given branch, finds the `nova-e2e-www-tests` and `nova-e2e-studio-tests` jobs (each runs with parallelism=12 shards), downloads per-shard Allure report widgets from CircleCI's artifacts API, and reports:

- Aggregate retry rate (% of test executions that are retries)
- Estimated retry-attributable wallclock cost per shard
- Top 20 retry offenders (single most recent job, walked in detail)
- p50/p95 duration of `nova-e2e-env-checkout` (the job that leases a Nova test env)

## Setup

1. Create a virtual environment and install dependencies:

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Create a CircleCI Personal API token:
   - Log in to CircleCI
   - Click on your profile (top-right) → **User Settings**
   - Go to **Personal API Tokens** → **Create New Token**
   - Choose a name (e.g. `circleCI-API-token`) and click **Add API Token**
   - Copy the token — it will only be shown once

3. Export your token as an environment variable:

```bash
export CIRCLE_TOKEN=your_token_here
```

## Usage

```bash
python measure_e2e_retries.py
```

### Options

| Flag | Description |
|---|---|
| `--no-offenders` | Skip the per-test offender deep-dive (saves ~1 min) |
| `--offender-job <JOB_NUMBER>` | Use a specific job number for offender analysis instead of auto-picking the most recent |
| `--dump-allure-retries <JOB_NUMBER>` | Diagnostic: print `retry-trend.json` + `summary.json` + a sample test-case from one job's artifacts |

## Configuration

The following constants at the top of the script can be adjusted:

| Constant | Default | Description |
|---|---|---|
| `PROJECT_SLUG` | `github/tunecore/tc-www` | CircleCI project slug |
| `BRANCH` | `integration` | Branch to pull pipelines from |
| `NUM_PIPELINES` | `30` | Number of recent pipelines to analyze |
| `PLAYWRIGHT_WORKERS` | `3` | Number of Playwright workers per shard |
| `DOWNLOAD_THREADS` | `32` | Parallelism for artifact downloads |

## Output legend

The offender table uses single-letter flags:

- `F` — test is marked flaky in Allure
- `C` — test status changed across retries (e.g. failed then passed)
- `X` — test ultimately failed after all retries