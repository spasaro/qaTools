#!/usr/bin/env node
import fs from 'fs';

const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const outputIdx = args.indexOf('--output');
const OUTPUT_FILE = outputIdx !== -1 ? args[outputIdx + 1] : 'flaky-report.html';
const windowIdx = args.indexOf('--window');
const WINDOW = windowIdx !== -1 ? args[windowIdx + 1] : 'last-7-days';

const TOKEN = process.env.CIRCLECI_TOKEN;
const PROJECT_SLUG = process.env.PROJECT_SLUG || 'gh/tunecore/tc-www';
const API_BASE = 'https://circleci.com/api/v2';

if (!TOKEN) {
  console.error('ERROR: CIRCLECI_TOKEN env var not set');
  console.error('Create a read-only token at https://app.circleci.com/settings/user/tokens');
  process.exit(1);
}

async function fetchFlakyTests() {
  const params = new URLSearchParams({ branch: 'integration' });
  if (WINDOW) params.set('reporting-window', WINDOW);
  const url = `${API_BASE}/insights/${PROJECT_SLUG}/workflows/nova-e2e/test-metrics?${params}`;
  const res = await fetch(url, {
    headers: { 'Circle-Token': TOKEN, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CircleCI API ${res.status}: ${body}`);
  }

  return res.json();
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function generateHtml(tests, generatedAt) {
  const rows = [...tests]
    .sort((a, b) => b.failRate - a.failRate)
    .map(t => {
      const pct = (t.failRate * 100).toFixed(1);
      const bar = Math.round(t.failRate * 100);
      return `
      <tr>
        <td style="max-width:480px;word-break:break-word">${escHtml(t.test_name)}</td>
        <td style="color:#6b7280;font-size:12px;max-width:320px;word-break:break-word">${escHtml(t.classname)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:80px;background:#e5e7eb;border-radius:4px;height:8px">
              <div style="width:${bar}%;background:#d97706;border-radius:4px;height:8px"></div>
            </div>
            <span style="font-weight:600">${pct}%</span>
          </div>
        </td>
        <td style="text-align:center">${escHtml(t.failed_runs ?? '-')} / ${escHtml(t.total_runs ?? '-')}</td>
      </tr>`;
    })
    .join('');

  const updated = generatedAt.slice(0, 19).replace('T', ' ') + ' UTC';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Flaky Test Report — tc-www</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 32px; background: #f9fafb; color: #111827; }
    h1 { font-size: 24px; margin: 0 0 4px }
    .meta { color: #6b7280; font-size: 14px; margin-bottom: 24px }
    .cards { display: flex; gap: 16px; margin-bottom: 28px }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 24px; min-width: 120px }
    .card-value { font-size: 28px; font-weight: 700 }
    .card-label { font-size: 13px; color: #6b7280; margin-top: 2px }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden }
    th { background: #f3f4f6; text-align: left; padding: 10px 14px; font-size: 13px; color: #374151; font-weight: 600 }
    td { padding: 10px 14px; border-top: 1px solid #f3f4f6; font-size: 13px; vertical-align: middle }
    tr:hover td { background: #f9fafb }
  </style>
</head>
<body>
  <h1>Flaky Test Report — tc-www</h1>
  <div class="meta">integration branch &nbsp;·&nbsp; ${WINDOW} &nbsp;·&nbsp; generated ${updated}</div>
  <div class="cards">
    <div class="card">
      <div class="card-value" style="color:#d97706">${tests.length}</div>
      <div class="card-label">Flaky tests</div>
    </div>
  </div>
  <table>
    <thead>
      <tr>
        <th>Test</th>
        <th>File</th>
        <th>Fail rate</th>
        <th>Failed / Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>`;
}

async function main() {
  console.error(`Project: ${PROJECT_SLUG}`);
  console.error(`Window: ${WINDOW}`);
  console.error('Fetching flaky tests from nova-e2e / integration...');

  const response = await fetchFlakyTests();

  if (DEBUG) {
    console.error('\n--- raw API response ---');
    console.error(JSON.stringify(response, null, 2));
    console.error('--- end ---\n');
  }

  const apiTests = response.most_failed_tests || [];
  console.error(`API returned ${apiTests.length} test(s)`);

  const flaky = apiTests
    .filter(t => t.flaky && t.classname?.startsWith('spec/e2e/tests/tc-www/'))
    .map(t => ({
      ...t,
      failRate: t.total_runs > 0 ? t.failed_runs / t.total_runs : 0,
    }));

  console.error(`${flaky.length} flaky test(s) found`);

  const generatedAt = new Date().toISOString();
  const html = generateHtml(flaky, generatedAt);
  fs.writeFileSync(OUTPUT_FILE, html);
  console.error(`Report written to ${OUTPUT_FILE}`);
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
