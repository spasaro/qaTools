#!/usr/bin/env node
/**
 * generate_weekly_slack_report.js
 *
 * Generates a draft Slack message for the weekly E2E Workflow Execution report.
 *
 * What it does:
 *   1. Fetches flaky tests from CircleCI Insights (last 7 days, integration branch)
 *   2. Fetches open child stories from Jira epic QAE2ETC-2039
 *   3. Crosses flaky tests with Jira tickets by spec file path
 *   4. Prints the draft Slack message to stdout
 *
 * Usage:
 *   CIRCLECI_TOKEN=xxx JIRA_API_TOKEN=xxx JIRA_EMAIL=xxx node generate_weekly_slack_report.js --pass-rate 90%
 *
 * Required env vars:
 *   CIRCLECI_TOKEN   — CircleCI personal API token (read-only)
 *   JIRA_API_TOKEN       — Jira personal API token
 *   JIRA_EMAIL       — Jira account email (used for Basic Auth)
 *
 * Optional env vars:
 *   PROJECT_SLUG     — CircleCI project slug (default: gh/tunecore/tc-www)
 *   JIRA_BASE_URL    — Jira base URL (default: https://support-tech.atlassian.net)
 *   EPIC_KEY         — Jira epic to search child stories in (default: QAE2ETC-2039)
 *   WINDOW           — CircleCI reporting window (default: last-7-days)
 */

import readline from 'readline';

// ── Config ────────────────────────────────────────────────────────────────────

const CIRCLECI_TOKEN = process.env.CIRCLECI_TOKEN;
const JIRA_API_TOKEN     = process.env.JIRA_API_TOKEN;
const JIRA_EMAIL     = process.env.JIRA_EMAIL;
const PROJECT_SLUG   = process.env.PROJECT_SLUG  || 'gh/tunecore/tc-www';
const JIRA_BASE_URL  = process.env.JIRA_BASE_URL || 'https://support-tech.atlassian.net';
const EPIC_KEY       = process.env.EPIC_KEY      || 'QAE2ETC-2039';
const WINDOW         = process.env.WINDOW        || 'last-7-days';

const CIRCLECI_API   = 'https://circleci.com/api/v2';

// CC list — update as needed
const CC_LIST = [
  '@Droo HASTINGS', '@Brennan CALDWELL', '@Brittany JACOBS',
  '@Nidhin GEETHA (EXT)', '@Michael APICELLI', '@Roberto BRENES',
  '@Madhava REDDY', '@Kaiyan LIANG',
];

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const prIdx = args.indexOf('--pass-rate');
  if (prIdx === -1 || !args[prIdx + 1]) {
    console.error('ERROR: --pass-rate <value> is required (e.g. --pass-rate 90%)');
    process.exit(1);
  }
  const passRate = args[prIdx + 1].replace('%', '').trim();
  if (isNaN(Number(passRate))) {
    console.error(`ERROR: --pass-rate value "${args[prIdx + 1]}" is not a valid number`);
    process.exit(1);
  }
  const epicIdx = args.indexOf('--flaky-epic');
  const epicKey = epicIdx !== -1 ? args[epicIdx + 1] : EPIC_KEY;
  return { passRate: `${passRate}%`, epicKey };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validate() {
  const missing = [];
  if (!CIRCLECI_TOKEN) missing.push('CIRCLECI_TOKEN');
  if (!JIRA_API_TOKEN)     missing.push('JIRA_API_TOKEN');
  if (!JIRA_EMAIL)     missing.push('JIRA_EMAIL');
  if (missing.length) {
    console.error(`ERROR: Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// ── CircleCI ──────────────────────────────────────────────────────────────────

async function fetchFlakyTests() {
  const params = new URLSearchParams({ branch: 'integration' });
  if (WINDOW) params.set('reporting-window', WINDOW);
  const url = `${CIRCLECI_API}/insights/${PROJECT_SLUG}/workflows/nova-e2e/test-metrics?${params}`;

  const res = await fetch(url, {
    headers: { 'Circle-Token': CIRCLECI_TOKEN, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CircleCI API ${res.status}: ${body}`);
  }
  const data = await res.json();
  const apiTests = data.most_failed_tests || [];

  return apiTests
    .filter(t => t.flaky && t.classname?.startsWith('spec/e2e/tests/tc-www/'))
    .map(t => ({
      name:       t.test_name,
      classname:  t.classname,
      failRate:   t.total_runs > 0 ? t.failed_runs / t.total_runs : 0,
      failedRuns: t.failed_runs,
      totalRuns:  t.total_runs,
    }))
    .sort((a, b) => b.failRate - a.failRate);
}

// ── Jira ──────────────────────────────────────────────────────────────────────

async function fetchJiraChildStories(epicKey) {
  const jiraAuth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  // Fetch open (non-Done) child stories of the epic
  const jql = encodeURIComponent(
    `project = QAE2ETC AND "Epic Link" = ${epicKey} AND statusCategory != Done ORDER BY priority DESC`
  );
  const url = `${JIRA_BASE_URL}/rest/api/3/search/jql?jql=${jql}&fields=summary,description,status&maxResults=50`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Basic ${jiraAuth}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Jira API ${res.status}: ${body}`);
  }
  const data = await res.json();
  return data.issues || [];
}

// ── Matching logic ────────────────────────────────────────────────────────────
//
// Strategy: for each flaky test, look for a Jira story whose summary or
// description contains the spec file path (or a meaningful substring of it).
// We extract the feature-area segment from the classname, e.g.:
//   spec/e2e/tests/tc-www/cart/promo-code/... → "cart/promo-code"
//   spec/e2e/tests/tc-www/targeted-offers/... → "targeted-offers"

function extractFeatureArea(classname) {
  // classname: spec/e2e/tests/tc-www/<feature>/<sub>/file.spec.ts
  const prefix = 'spec/e2e/tests/tc-www/';
  if (!classname.startsWith(prefix)) return classname;
  const rest = classname.slice(prefix.length); // e.g. "cart/promo-code/file.spec.ts"
  const parts = rest.split('/').filter(p => !p.endsWith('.spec.ts'));
  // Return first two directory segments as the feature area
  return parts.slice(0, 2).join('/');
}

function matchStory(test, stories) {
  const featureArea = extractFeatureArea(test.classname);
  // 1. Try matching by spec file path in story summary or description text
  for (const story of stories) {
    const haystack = (story.fields.summary + ' ' + (story.fields.description?.content
      ?.flatMap(b => b.content || [])
      ?.map(c => c.text || '')
      ?.join(' ') || '')).toLowerCase();
    if (haystack.includes(featureArea.toLowerCase())) {
      return story.key;
    }
  }
  return null;
}

// ── Grouping ──────────────────────────────────────────────────────────────────
//
// Group flaky tests by feature area so the Slack message stays concise
// (one bullet per feature area, same as the manual report).

function groupByFeatureArea(tests, stories) {
  const groups = new Map(); // featureArea → { label, failRates[], ticketKey }

  for (const test of tests) {
    const area = extractFeatureArea(test.classname);
    if (!groups.has(area)) {
      groups.set(area, {
        area,
        label:      areaToLabel(area),
        failRates:  [],
        ticketKey:  matchStory(test, stories),
      });
    }
    const g = groups.get(area);
    g.failRates.push(test.failRate);
    // If we didn't find a ticket yet, try again with this test
    if (!g.ticketKey) g.ticketKey = matchStory(test, stories);
  }

  return [...groups.values()];
}

// Convert a feature area path to a human-readable label
function areaToLabel(area) {
  const labels = {
    'targeted-offers':                         'Targeted Offers',
    'cart/promo-code':                         'Promo Code - New Album Release',
    'plans/winbank':                           'Plans - Winback discount cancellation flow',
    'admin/tiktok-creators-track-selection':   'Admin TikTok Eligibility Batch Export',
    'accelerator-modal':                       'Accelerator Modal Opt-Out',
    'money-analytics/created-splits':          'Split Confirmation Dialog',
    'money-analytics/balance-history':         'Money Analytics - Balance History table',
    'money-analytics/trends-analytics':        'Trends & Analytics - Audience tab',
    'new-release':                             'New Release',
    'account_settings':                        'Account Settings',
    'mass_takedown_tool':                      'Mass Takedown Tool',
    'admin/publishing-kyc-status':             'Admin - Publishing KYC Status',
  };
  return labels[area] || area;
}

function formatFailRate(rates) {
  const pcts = rates.map(r => (r * 100).toFixed(1));
  if (pcts.length === 1) return `${pcts[0]}%`;
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  if (Math.abs(max - min) < 0.001) return `${pcts[0]}%`;
  return `${(min * 100).toFixed(1)}–${(max * 100).toFixed(1)}%`;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getWeekRange() {
  const now = new Date();
  const end = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - 6);
  const fmt = d => d.toISOString().slice(0, 10).replace(/-/g, '/');
  return `${fmt(start)} – ${fmt(end)}`;
}

// ── Draft builder ─────────────────────────────────────────────────────────────

function buildDraft(passRate, groups, epicKey) {
  const weekRange = getWeekRange();
  const cc = CC_LIST.join(', ');

  const flakinessList = groups.length === 0
    ? '• (no flaky tests detected this week)'
    : groups.map(g => {
        const ticket = g.ticketKey ? ` : ${g.ticketKey}` : '';
        const rate = ` (fail rate: ${formatFailRate(g.failRates)})`;
        return `• ${g.label}${ticket}${rate}`;
      }).join('\n');

  return `
@channel *Weekly Summary of E2E Workflow Execution*
CC: ${cc}.

*Summary*
• *${passRate}* pass rate in the integration branch of the latest 7 days (${weekRange})

*Highlights:*
• [ADD HIGHLIGHTS HERE — incidents, infra issues, on-call notes]

*Flakiness detected by CI in:*
${flakinessList}

All items above are tracked under epic: ${epicKey}: E2E Test Stability Q3 2026. ${JIRA_BASE_URL}/browse/${epicKey}

[ATTACH CIRCLECI SCREENSHOT HERE — https://app.circleci.com/insights/github/tunecore/tc-www/workflows/nova-e2e/overview?branch=integration&reporting-window=last-7-days]
`.trim();
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  validate();
  const { passRate, epicKey } = parseArgs();

  console.error('Fetching flaky tests from CircleCI...');
  const flaky = await fetchFlakyTests();
  console.error(`  ${flaky.length} flaky test(s) found`);

  console.error(`Fetching open Jira stories from epic ${epicKey}...`);
  const stories = await fetchJiraChildStories(epicKey);
  console.error(`  ${stories.length} open story/ies found`);

  const groups = groupByFeatureArea(flaky, stories);
  console.error(`  ${groups.length} feature area group(s) after matching\n`);

  // Warn about unmatched groups
  const unmatched = groups.filter(g => !g.ticketKey);
  if (unmatched.length) {
    console.error('⚠️  Could not find a Jira ticket for:');
    unmatched.forEach(g => console.error(`   - ${g.label} (${g.area})`));
    console.error('   → Create a ticket manually or check the epic.\n');
  }

  const draft = buildDraft(passRate, groups, epicKey);

  console.log('\n' + '═'.repeat(70));
  console.log('DRAFT SLACK MESSAGE — copy everything below this line');
  console.log('═'.repeat(70) + '\n');
  console.log(draft);
  console.log('\n' + '═'.repeat(70));
}

main().catch(err => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
