"""
Jira AI Impact HTML Report Generator
--------------------------------------
Reads the baseline (output/team/team_summary_sp*_only_auto.csv) and AI
(output/ai/team_summary_sp*_ai.csv) summaries and generates a self-contained
HTML report comparing cycle times with and without AI.

Output: output/ai_impact_report.html

Usage:
  python3 html_report/jira_html_report.py

Setup:
  No Jira credentials needed — reads from existing CSV outputs.
  Run team_report/jira_team_report.py and ai_report/jira_ai_report.py first.
"""

import csv
import os
import re
import sys
from datetime import date

ROOT         = os.path.join(os.path.dirname(__file__), "..")
OUTPUT_ROOT  = os.path.join(ROOT, "output")
BASELINE_DIR = os.path.join(OUTPUT_ROOT, "team")
AI_DIR       = os.path.join(OUTPUT_ROOT, "ai")
OUTPUT_FILE  = os.path.join(OUTPUT_ROOT, "ai_impact_report.html")

sys.path.insert(0, ROOT)
from utils.team_settings import TEAM, STORY_POINTS  # noqa: E402


# ---------------------------------------------------------------------------
# CSV parsing
# ---------------------------------------------------------------------------

def parse_cycle_time_str(s: str):
    """Parse '5 days 7 hours 15 minutes' → total seconds, or None if N/A."""
    if not s or s.strip() in ("N/A", ""):
        return None
    total = 0
    d = re.search(r"(\d+)\s+days?", s)
    h = re.search(r"(\d+)\s+hours?", s)
    m = re.search(r"(\d+)\s+minutes?", s)
    if d:
        total += int(d.group(1)) * 86400
    if h:
        total += int(h.group(1)) * 3600
    if m:
        total += int(m.group(1)) * 60
    return total if total > 0 else None


def load_summary_csv(filepath: str) -> dict:
    """
    Read a team summary CSV and return {assignee: {count, avg_str, avg_seconds}}.
    Skips blank rows and the TEAM AVERAGE row (handled separately).
    """
    data = {}
    if not os.path.exists(filepath):
        return data
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            assignee = (row.get("Assignee") or "").strip()
            if not assignee or assignee == "TEAM AVERAGE":
                continue
            avg_str   = (row.get("Average Cycle Time") or "").strip()
            count_str = (row.get("Ticket Count") or "").strip()
            try:
                count = int(count_str)
            except ValueError:
                count = 0
            data[assignee] = {
                "count":       count,
                "avg_str":     avg_str,
                "avg_seconds": parse_cycle_time_str(avg_str),
            }
    return data


def load_team_average(filepath: str):
    """Extract the TEAM AVERAGE row. Returns (count, avg_str, avg_seconds)."""
    if not os.path.exists(filepath):
        return None, None, None
    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("Assignee") or "").strip() == "TEAM AVERAGE":
                avg_str   = (row.get("Average Cycle Time") or "").strip()
                count_str = (row.get("Ticket Count") or "").strip()
                try:
                    count = int(count_str)
                except ValueError:
                    count = 0
                return count, avg_str, parse_cycle_time_str(avg_str)
    return None, None, None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def improvement_pct(baseline_sec, ai_sec):
    """Positive = AI is faster. Negative = AI is slower."""
    if baseline_sec is None or ai_sec is None:
        return None
    return (baseline_sec - ai_sec) / baseline_sec * 100


def fmt_improvement(pct):
    if pct is None:
        return '<span class="na">\u2014</span>'
    if pct > 0:
        return f'<span class="green">\u25bc {abs(pct):.1f}%</span>'
    return f'<span class="red">\u25b2 {abs(pct):.1f}%</span>'


def fmt_avg(avg_str, avg_seconds, ai=False):
    if not avg_str or avg_str == "N/A" or avg_seconds is None:
        return '<span class="na">N/A</span>'
    cls = ' class="ai-value"' if ai else ""
    return f"<span{cls}>{avg_str}</span>"


def fmt_count(count):
    if not count:
        return '<span class="na">0</span>'
    return str(count)


# ---------------------------------------------------------------------------
# HTML building blocks
# ---------------------------------------------------------------------------

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  background: #f4f6f9; color: #1a1a2e;
}
header {
  background: #1a1a2e; color: #fff; padding: 28px 40px;
}
header h1 { font-size: 1.6rem; font-weight: 700; }
header p  { margin-top: 6px; font-size: 0.88rem; color: #a0aec0; }

main { max-width: 1140px; margin: 32px auto; padding: 0 24px; }

/* Executive summary cards */
.cards { display: flex; gap: 20px; margin-bottom: 36px; flex-wrap: wrap; }
.card {
  background: #fff; border-radius: 10px; padding: 22px 28px;
  flex: 1; min-width: 190px; box-shadow: 0 1px 4px rgba(0,0,0,.08);
}
.card .label {
  font-size: 0.72rem; color: #718096; text-transform: uppercase;
  letter-spacing: .06em; margin-bottom: 10px;
}
.card .value { font-size: 1.9rem; font-weight: 700; color: #1a1a2e; }
.card .sub   { font-size: 0.78rem; color: #718096; margin-top: 5px; }

/* SP sections */
.sp-section {
  background: #fff; border-radius: 10px;
  box-shadow: 0 1px 4px rgba(0,0,0,.08); margin-bottom: 28px; overflow: hidden;
}
.sp-header {
  background: #2d3748; color: #fff; padding: 14px 24px;
  font-size: 1rem; font-weight: 600; letter-spacing: .02em;
}
table { width: 100%; border-collapse: collapse; }
th {
  background: #edf2f7; font-size: 0.72rem; text-transform: uppercase;
  letter-spacing: .05em; padding: 10px 16px; text-align: left;
  color: #4a5568; border-bottom: 1px solid #e2e8f0;
}
td { padding: 11px 16px; font-size: 0.88rem; border-bottom: 1px solid #edf2f7; }
tr:last-child td { border-bottom: none; }
tr.team-avg td {
  background: #f7fafc; font-weight: 600;
  border-top: 2px solid #cbd5e0;
}
tr:not(.team-avg):hover td { background: #f7fafc; }

.na         { color: #a0aec0; }
.green      { color: #276749; font-weight: 600; }
.red        { color: #c53030; font-weight: 600; }
.ai-value   { color: #2b6cb0; font-weight: 600; }

.col-divider { border-left: 2px solid #e2e8f0; }

footer {
  text-align: center; padding: 28px;
  font-size: 0.78rem; color: #a0aec0;
}
"""


def render_sp_section(sp, baseline, ai,
                      b_team_count, b_team_avg_str, b_team_avg_sec,
                      a_team_count, a_team_avg_str, a_team_avg_sec) -> str:
    rows_html = ""
    for name in TEAM:
        b = baseline.get(name, {})
        a = ai.get(name, {})
        b_count   = b.get("count", 0)
        b_avg_str = b.get("avg_str", "N/A")
        b_avg_sec = b.get("avg_seconds")
        a_count   = a.get("count", 0)
        a_avg_str = a.get("avg_str", "N/A")
        a_avg_sec = a.get("avg_seconds")

        if b_count == 0 and a_count == 0:
            continue

        pct        = improvement_pct(b_avg_sec, a_avg_sec)
        first_name = name.split()[0]
        rows_html += f"""
        <tr>
          <td>{first_name}</td>
          <td>{fmt_count(b_count)}</td>
          <td>{fmt_avg(b_avg_str, b_avg_sec)}</td>
          <td class="col-divider">{fmt_count(a_count)}</td>
          <td>{fmt_avg(a_avg_str, a_avg_sec, ai=True)}</td>
          <td>{fmt_improvement(pct)}</td>
        </tr>"""

    team_pct   = improvement_pct(b_team_avg_sec, a_team_avg_sec)
    b_tc_html  = fmt_count(b_team_count) if b_team_count is not None else '<span class="na">\u2014</span>'
    a_tc_html  = fmt_count(a_team_count) if a_team_count is not None else '<span class="na">\u2014</span>'
    rows_html += f"""
        <tr class="team-avg">
          <td>Team Average</td>
          <td>{b_tc_html}</td>
          <td>{fmt_avg(b_team_avg_str, b_team_avg_sec)}</td>
          <td class="col-divider">{a_tc_html}</td>
          <td>{fmt_avg(a_team_avg_str, a_team_avg_sec, ai=True)}</td>
          <td>{fmt_improvement(team_pct)}</td>
        </tr>"""

    return f"""
  <div class="sp-section">
    <div class="sp-header">Story Points: {sp}</div>
    <table>
      <thead>
        <tr>
          <th>Assignee</th>
          <th>Automation — tickets</th>
          <th>Automation — avg cycle time</th>
          <th class="col-divider">AI-implemented — tickets</th>
          <th>AI-implemented — avg cycle time</th>
          <th>Improvement</th>
        </tr>
      </thead>
      <tbody>{rows_html}
      </tbody>
    </table>
  </div>"""


def build_executive_summary(sp_data: dict) -> dict:
    total_ai_tickets = 0
    improvements     = []
    for d in sp_data.values():
        total_ai_tickets += d["ai_team_count"] or 0
        pct = improvement_pct(d["baseline_team_avg_sec"], d["ai_team_avg_sec"])
        if pct is not None:
            improvements.append(pct)
    return {
        "total_ai_tickets": total_ai_tickets,
        "avg_improvement":  sum(improvements) / len(improvements) if improvements else None,
        "sp_with_ai":       sum(1 for d in sp_data.values() if d["ai_team_count"]),
    }


def generate_html(sp_data: dict, summary: dict) -> str:
    today        = date.today().strftime("%B %d, %Y")
    ai_count_str = str(summary["total_ai_tickets"]) if summary["total_ai_tickets"] else "\u2014"
    sp_str       = f"{summary['sp_with_ai']} / {len(STORY_POINTS)}"
    avg_imp      = summary["avg_improvement"]
    avg_imp_str  = f"{avg_imp:.1f}%" if avg_imp is not None else "\u2014"
    imp_color    = "#276749" if (avg_imp or 0) > 0 else "#c53030"

    cards_html = f"""
  <div class="cards">
    <div class="card">
      <div class="label">AI Tickets Processed</div>
      <div class="value">{ai_count_str}</div>
      <div class="sub">labeled ai-implemented, from 2026-03-20</div>
    </div>
    <div class="card">
      <div class="label">SP Categories with AI Data</div>
      <div class="value">{sp_str}</div>
      <div class="sub">SP {" &nbsp;/&nbsp; ".join(str(sp) for sp in STORY_POINTS)}</div>
    </div>
    <div class="card">
      <div class="label">Avg Team Improvement</div>
      <div class="value" style="color:{imp_color}">{avg_imp_str}</div>
      <div class="sub">across SP categories with AI data</div>
    </div>
  </div>"""

    sections_html = ""
    for sp in STORY_POINTS:
        d = sp_data[sp]
        sections_html += render_sp_section(
            sp, d["baseline"], d["ai"],
            d["baseline_team_count"], d["baseline_team_avg_str"], d["baseline_team_avg_sec"],
            d["ai_team_count"],       d["ai_team_avg_str"],       d["ai_team_avg_sec"],
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Impact Report \u2014 QA Automation Team</title>
  <style>{CSS}</style>
</head>
<body>
  <header>
    <h1>AI Impact Report \u2014 QA Automation Team</h1>
    <p>
      Cycle time comparison: automation implemented without AI vs. with AI (ai-implemented)
      &nbsp;\u00b7&nbsp; Generated {today}
    </p>
  </header>
  <main>
    {cards_html}
    {sections_html}
  </main>
  <footer>
    Generated by jira_html_report.py
    &nbsp;\u00b7&nbsp; Baseline: team_output/
    &nbsp;\u00b7&nbsp; AI data: ai_output/
  </footer>
</body>
</html>"""


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    sp_data = {}
    for sp in STORY_POINTS:
        b_file = os.path.join(BASELINE_DIR, f"team_summary_sp{sp}_only_auto.csv")
        a_file = os.path.join(AI_DIR,       f"team_summary_sp{sp}_ai.csv")

        b_team_count, b_team_avg_str, b_team_avg_sec = load_team_average(b_file)
        a_team_count, a_team_avg_str, a_team_avg_sec = load_team_average(a_file)

        sp_data[sp] = {
            "baseline":            load_summary_csv(b_file),
            "ai":                  load_summary_csv(a_file),
            "baseline_team_count": b_team_count,
            "baseline_team_avg_str": b_team_avg_str,
            "baseline_team_avg_sec": b_team_avg_sec,
            "ai_team_count":       a_team_count,
            "ai_team_avg_str":     a_team_avg_str,
            "ai_team_avg_sec":     a_team_avg_sec,
        }

    summary = build_executive_summary(sp_data)
    html    = generate_html(sp_data, summary)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"✅ Report generated: {os.path.abspath(OUTPUT_FILE)}")


if __name__ == "__main__":
    main()
