# On-Call Helpers

Python scripts to speed up SDET on-call triage for the `integration` branch.

---

## Setup

**Requirements:** Python 3.9+, `pip`, and `npx` / `playwright` (for `open_trace.py`)

```bash
pip install -r requirements.txt
```

**CircleCI token** — both scripts need a personal CircleCI API token. Set it once as an environment variable so you don't have to edit the files:

```bash
export CIRCLE_TOKEN=your_token_here
```

You can add this to your shell profile (`~/.zshrc`, `~/.bashrc`) to make it permanent. If `CIRCLE_TOKEN` is not set, you'll need to replace the `YOUR_TOKEN_HERE` placeholder in each script directly.

---

## `integration_e2e_report.py`

Reports the deployment health of the `integration` branch for the current day (since midnight CST).

**What it does:**
- Fetches all CircleCI pipelines on `integration` since midnight CST
- For each pipeline, retrieves every workflow and its status
- Prints a summary table (runs, pass/fail counts, pass rate per workflow type)
- Prints a per-pipeline breakdown with commit SHA and message
- For any failed workflows, lists the failed job names with direct CircleCI links
- For failed `nova-e2e` jobs, prints the `open_trace.py` command to run next

**Usage:**

```bash
python3 integration_e2e_report.py
```

**Sample output:**

```
Integration branch · deployment health report
Window: 2026-04-30 00:00 CDT → now

Fetching pipelines... 8 found
Fetching workflow statuses... done

======================================================================
SUMMARY  (8 pipelines since midnight CST)
  Workflow                  Runs     ✓     ✗     ●  Pass Rate
  ------------------------  ----  ----  ----  ----  ---------
  nova-e2e                     8     6     2     0       75%
  ...

======================================================================
FAILURE DETAILS  (2 failed workflow runs)
...
    python3 open_trace.py 98765 --failed
```

---

## `open_trace.py`

Downloads and opens the Playwright trace for a failed or flaky test from a CircleCI e2e job. Intended to be run on job numbers surfaced by `integration_e2e_report.py`.

**What it does:**
1. Fetches all artifacts from the given CircleCI job
2. Scans `suites.json` to identify failed and flaky tests (fast path — no bulk download)
3. Cross-references with CircleCI's test results API to distinguish true failures from flaky tests that passed on retry
4. Presents an interactive numbered menu to select a test
5. Downloads the `trace.zip` for the selected test and opens it with `playwright show-trace`

**Usage:**

```bash
python3 open_trace.py <job_number> [options]
```

**Options:**

| Flag | Description |
|------|-------------|
| `--failed` | Show only hard failures — excludes flaky tests that eventually passed |
| `--all-retried` | Show all retried tests, not just CI-flagged failures |
| `--filter WORD` | Case-insensitive substring filter on test name (e.g. `--filter checkout`) |
| `--list` | Print all CI-flagged test names and exit — useful with `grep` to find the right `--filter` value |
| `--search WORD` | Search `suites.json` for any test matching `WORD` (any status) and show its raw Allure fields — useful for diagnosing why a test isn't being flagged |
| `--debug` | Dump artifact and attachment structure to diagnose trace detection issues |

**Examples:**

```bash
# Open a trace for a failed test from job 98765
python3 open_trace.py 98765

# Show only hard failures (no flaky tests)
python3 open_trace.py 98765 --failed

# Filter to tests with "checkout" in the name
python3 open_trace.py 98765 --filter checkout

# List all CI-flagged test names, then grep to find what to filter on
python3 open_trace.py 98765 --list | grep -i lyrics
```

**Typical triage flow:**

```bash
# 1. Run the report to find failing jobs
python3 integration_e2e_report.py

# 2. Copy the suggested command from the output for a failing nova-e2e job
python3 open_trace.py 98765 --failed

# 3. Select a test from the menu → trace opens in your browser
```

The script will open the Playwright trace viewer in your browser. Type `exit` or press `Ctrl+C` to close it and clean up the downloaded trace file.

---

## Color coding in `open_trace.py`

| Color | Meaning |
|-------|---------|
| Red | Failed after all retries — true failure |
| Yellow | Broken — unexpected crash or infrastructure error |
| No color | Flaky — failed at least once but passed on retry |
