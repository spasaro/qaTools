import { WebClient, LogLevel } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { SlackAvailabilityService } from './slack-availability.service';

dotenv.config();

function parseIdMap(s: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!s) return map;
  for (const entry of s.split(',').map((x: string) => x.trim()).filter((v: string) => Boolean(v))) {
    const parts = entry.split(':').map((x: string) => x.trim());
    if (parts[0] && parts[1]) map[parts[0].toLowerCase()] = parts[1];
  }
  return map;
}

const SLACK_ID_MAP = parseIdMap(process.env.SLACK_USER_IDS);
const REVERSE_ID_MAP = Object.fromEntries(
  Object.entries(SLACK_ID_MAP).map(([alias, id]) => [id, alias]),
);

const REVIEWERS: string[] = (process.env.REVIEWERS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter((v: string) => Boolean(v));

if (REVIEWERS.length < 2)
  throw new Error('Env REVIEWERS must include at least two reviewers.');

const STATE_DIR = process.env.STATE_DIR || path.resolve(__dirname, '../.state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

type BotState = {
  assigner: { userCounts: Record<string, number> };
  scores: Record<string, number>;
  lastPairKey: string | null;
  authorHistory?: Record<string, string[]>;
};

function loadState(): BotState {
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  return JSON.parse(raw) as BotState;
}

function saveState(state: BotState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

async function main(): Promise<void> {
  const slackToken = process.env.SLACK_BOT_TOKEN;
  if (!slackToken) throw new Error('SLACK_BOT_TOKEN env var is required');

  const client = new WebClient(slackToken, { logLevel: LogLevel.WARN });
  const availabilityService = new SlackAvailabilityService({ client });

  const reviewerSlackIds = REVIEWERS.map(
    (alias: string) => SLACK_ID_MAP[alias.toLowerCase()] ?? alias,
  );

  let available: string[] = [];
  let unavailable: { user: string; reason: string }[] = [];

  try {
    const result = await availabilityService.filterUsers(reviewerSlackIds);
    available = result.available;
    unavailable = result.unavailable;
  } catch {
    console.log('::notice::equalize-ooo: Could not fetch availability — skipping equalization');
    return;
  }

  if (unavailable.length === 0) {
    console.log('::notice::equalize-ooo: No absent reviewers — nothing to equalize');
    return;
  }

  const availableAliases = available
    .map((id: string) => {
      const lower = REVERSE_ID_MAP[id];
      if (!lower) return null;
      return REVIEWERS.find((r: string) => r.toLowerCase() === lower) ?? null;
    })
    .filter((v): v is string => v !== null);

  if (availableAliases.length === 0) {
    console.log('::notice::equalize-ooo: No active reviewers found — skipping');
    return;
  }

  const state = loadState();
  const scores = state.scores ?? {};

  const minActiveScore = Math.min(...availableAliases.map((r: string) => scores[r] ?? 0));

  const absent = unavailable
    .map((u: { user: string; reason: string }) => {
      const lower = REVERSE_ID_MAP[u.user] ?? u.user;
      return REVIEWERS.find((r: string) => r.toLowerCase() === lower) ?? null;
    })
    .filter((v): v is string => v !== null);

  const updates: string[] = [];
  for (const reviewer of absent) {
    const current = scores[reviewer] ?? 0;
    if (current < minActiveScore) {
      scores[reviewer] = minActiveScore;
      state.assigner.userCounts[reviewer] = minActiveScore;
      updates.push(`${reviewer}: ${current} → ${minActiveScore}`);
    }
  }

  if (updates.length === 0) {
    console.log('::notice::equalize-ooo: Absent reviewers already at or above minimum — no changes needed');
    return;
  }

  saveState(state);
  console.log(`::notice::equalize-ooo: Equalized scores | min_active=${minActiveScore} | ${updates.join(' | ')}`);
}

main().catch(err => {
  console.error('equalize-ooo-scores failed:', err);
  process.exit(1);
});
