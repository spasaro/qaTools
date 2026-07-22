import { WebClient, LogLevel } from '@slack/web-api';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { FairPairAssigner, AssignerState, canonicalPair } from './fair-assigner';
import { SlackAvailabilityService } from './slack-availability.service';

dotenv.config();

type BotState = {
  assigner: AssignerState;
  scores: Record<string, number>;
  lastPairKey: string | null;
  authorHistory: Record<string, string[]>;
};

function parseIdMap(s: string | undefined): Record<string, string> {
  const map: Record<string, string> = {};
  if (!s) return map;
  for (const entry of s.split(',').map(x => x.trim()).filter((v: string) => Boolean(v))) {
    const parts = entry.split(':').map(x => x.trim());
    const key = parts[0];
    const val = parts[1];
    if (key && val) map[key.toLowerCase()] = val;
  }
  return map;
}

const SLACK_ID_MAP = parseIdMap(process.env.SLACK_USER_IDS);
const REVERSE_ID_MAP = Object.fromEntries(
  Object.entries(SLACK_ID_MAP).map(([alias, id]) => [id, alias]),
);

function mention(alias: string): string {
  const id = SLACK_ID_MAP[alias.toLowerCase()];
  return id ? `<@${id}>` : `@${alias}`;
}

const PR_REGEX =
  /https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[\/?#].*)?/gi;

const ALLOWED_REPOS = new Set(
  (process.env.ALLOWED_REPOS || '')
    .split(',')
    .map((s: string) => s.trim())
    .filter((v: string) => Boolean(v)),
);

const REVIEWERS: string[] = (process.env.REVIEWERS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter((v: string) => Boolean(v));

if (REVIEWERS.length < 2)
  throw new Error('Env REVIEWERS must include at least two reviewers.');

const REVIEWERS_LOWER = new Set(REVIEWERS.map((r: string) => r.toLowerCase()));

const N = 2;
const AUTHOR_HISTORY_WINDOW = parseInt(process.env.AUTHOR_HISTORY_WINDOW ?? '4', 10);

const TARGET_CHANNELS = (process.env.TARGET_CHANNELS ?? '')
  .split(',')
  .map((s: string) => s.trim())
  .filter((v: string) => Boolean(v));

if (TARGET_CHANNELS.length === 0)
  throw new Error('Set TARGET_CHANNELS with comma-separated channel IDs');

const slackToken = process.env.SLACK_BOT_TOKEN;
if (!slackToken) {
  throw new Error('SLACK_BOT_TOKEN env var is required');
}

const client = new WebClient(slackToken, { logLevel: LogLevel.INFO });

const STATE_DIR = process.env.STATE_DIR || path.resolve(__dirname, '../.state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function loadState(): BotState | undefined {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as any;

    if (parsed.assigner && parsed.scores !== undefined) {
      const assigner: AssignerState = {
        userCounts: parsed.assigner.userCounts || {},
      };

      const scores: Record<string, number> = {};
      for (const r of REVIEWERS) {
        const v = parsed.scores[r];
        let n: number;

        if (typeof v === 'number') {
          n = v;
        } else if (typeof v === 'string') {
          const parsedNum = Number(v);
          n = Number.isFinite(parsedNum) ? parsedNum : 0;
        } else {
          n = 0;
        }

        scores[r] = n;
      }

      const lastPairKey =
        typeof parsed.lastPairKey === 'string' ? parsed.lastPairKey : null;

      return { assigner, scores, lastPairKey, authorHistory: parsed.authorHistory ?? {} };
    }

    if (parsed.userCounts) {
      const assigner: AssignerState = {
        userCounts: parsed.userCounts as Record<string, number>,
      };
      const scores: Record<string, number> = {};
      for (const r of REVIEWERS) {
        scores[r] = 0;
      }
      const lastPairKey =
        typeof parsed.lastPairKey === 'string' ? parsed.lastPairKey : null;
      return { assigner, scores, lastPairKey, authorHistory: {} };
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function saveState(state: BotState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function repoAllowed(owner: string, repo: string): boolean {
  if (ALLOWED_REPOS.size === 0) return true;
  const key = `${owner}/${repo}`;
  return ALLOWED_REPOS.has(key);
}

async function threadAlreadyAssigned(
  channel: string,
  ts: string,
): Promise<boolean> {
  const replies = await client.conversations.replies({ channel, ts, limit: 50 });
  const msgs = replies.messages ?? [];
  return msgs.some(
    (m: any) =>
      (m.bot_id && m.bot_id.length > 0) ||
      (typeof m.text === 'string' && m.text.includes('Assigning reviewers')),
  );
}

function toCanonicalReviewerName(name: string): string | null {
  const lower = name.toLowerCase();
  const match = REVIEWERS.find((r: string) => r.toLowerCase() === lower);
  return match ?? null;
}

async function main(): Promise<void> {
  const restored = loadState();

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
    available = reviewerSlackIds;
    unavailable = [];
  }

  const availableAliases = available
    .map((id: string) => {
      const lower = REVERSE_ID_MAP[id];
      if (!lower) return null;
      return toCanonicalReviewerName(lower);
    })
    .filter((v: string | null): v is string => v !== null);

  const reviewerPool: string[] =
    availableAliases.length > 0 ? availableAliases : REVIEWERS;

  let unavailableSummary = '';
  if (unavailable.length > 0) {
    const lines = unavailable
      .map((u: { user: string; reason: string }) => {
        const lower = REVERSE_ID_MAP[u.user] ?? u.user;
        const alias = toCanonicalReviewerName(lower) ?? lower;
        return `- ${alias} (${u.reason})`;
      })
      .join('\n');
    unavailableSummary =
      `### 🚫 Following members are not available\n` + `${lines}\n\n`;
  }

const initialCounts: Record<string, number> =
  restored?.scores ??
  Object.fromEntries(REVIEWERS.map((r: string) => [r, 0] as [string, number]));

const assigner = new FairPairAssigner(reviewerPool, undefined, { userCounts: initialCounts });

  const authorHistory: Record<string, string[]> = restored?.authorHistory ?? {};
  let lastPairKey: string | null = restored?.lastPairKey ?? null;
  let assignmentsMade = false;

  const now = Math.floor(Date.now() / 1000);
  const oldest = (now - 2 * 60 * 60).toString();

  for (const channel of TARGET_CHANNELS) {
    const hist = await client.conversations.history({
      channel,
      oldest,
      limit: 200,
      inclusive: true,
    });
    const messages = (hist.messages ?? []).filter(
      (m: any) => !('subtype' in m) && !m.bot_id,
    );

    for (const m of messages) {
      const text = ((m as any).text as string) || '';
      if (!text) continue;

      const matches = [...text.matchAll(PR_REGEX)];
      if (matches.length === 0) continue;

      const ts = (m as any).ts as string;
      const userId = (m as any).user as string;

      if (await threadAlreadyAssigned(channel, ts)) continue;

      const authorAliasLower = REVERSE_ID_MAP[userId]?.toLowerCase();
      const excluded = new Set<string>();
      if (authorAliasLower && REVIEWERS_LOWER.has(authorAliasLower)) {
        const canonical = toCanonicalReviewerName(authorAliasLower);
        if (canonical) excluded.add(canonical.toLowerCase());
      }

      const seenPrs = new Set<string>();
      for (const match of matches) {
        const owner = match[1]!;
        const repo = match[2]!;
        const prNum = match[3]!;
        const prKey = `${owner}/${repo}/${prNum}`;

        if (seenPrs.has(prKey)) continue;
        seenPrs.add(prKey);

        if (!repoAllowed(owner, repo)) continue;

        // Soft exclusion: avoid assigning recently-used reviewers to the same author
        const recentForAuthor = new Set<string>(
          (authorAliasLower ? (authorHistory[authorAliasLower] ?? []) : []).map(r => r.toLowerCase()),
        );
        const fullAvailablePool = reviewerPool.filter(r => !excluded.has(r.toLowerCase()));
        const effectivePool = fullAvailablePool.filter(r => !recentForAuthor.has(r.toLowerCase()));

        // Don't soft-exclude if it would force picking higher-scored reviewers over lower-scored soft-excluded ones
        let useSoftExclude = effectivePool.length >= N;
        if (useSoftExclude) {
          const currentScores = assigner.getScores();
          const effectiveSorted = [...effectivePool].sort(
            (a, b) => (currentScores[a] ?? 0) - (currentScores[b] ?? 0),
          );
          const worstPickScore = currentScores[effectiveSorted[N - 1]!] ?? 0;
          const hasBetterSoftExcluded = fullAvailablePool
            .filter(r => recentForAuthor.has(r.toLowerCase()))
            .some(r => (currentScores[r] ?? 0) < worstPickScore);
          if (hasBetterSoftExcluded) useSoftExclude = false;
        }

        const picked: string[] = [];
        const guard = REVIEWERS.length * 2;
        let tries = 0;

        while (picked.length < N && tries < guard) {
          const picksExcluded = new Set<string>([
            ...excluded,
            ...(useSoftExclude ? recentForAuthor : []),
            ...picked.map((p: string) => p.toLowerCase()),
          ]);
          const [a, b] = assigner.peekNextPair(picksExcluded, lastPairKey);
          for (const r of [a, b]) {
            const low = r.toLowerCase();
            const alreadyPicked = picked.some(x => x.toLowerCase() === low);
            if (!excluded.has(low) && !(useSoftExclude && recentForAuthor.has(low)) && !alreadyPicked) {
              picked.push(toCanonicalReviewerName(r) ?? r);
            }
            if (picked.length === N) break;
          }
          tries++;
        }

        // Safety net: never assign the PR author as a reviewer
        if (authorAliasLower) {
          const safe = picked.filter(r => r.toLowerCase() !== authorAliasLower);
          picked.splice(0, picked.length, ...safe);
        }

        // Commit only for reviewers that survived the safety net
        if (picked.length >= 2) {
          assigner.commitPick(picked[0]!, picked[1]!);
        }

        // Update per-author reviewer history
        if (authorAliasLower && picked.length > 0) {
          const prev = authorHistory[authorAliasLower] ?? [];
          authorHistory[authorAliasLower] = [...prev, ...picked].slice(-AUTHOR_HISTORY_WINDOW);
        }

        if (picked.length >= 2) {
          lastPairKey = canonicalPair(picked[0]!, picked[1]!);
        }

        const reviewersText = picked.map(mention).join(', ');
        await client.chat.postMessage({
          channel,
          thread_ts: ts,
          text: `🤖 Assigning reviewers for <https://github.com/${owner}/${repo}/pull/${prNum}|PR #${prNum}>:\n${reviewersText}`,
        });

        assignmentsMade = true;
      }
    }
  }

  let scores = assigner.saveState().userCounts;
  if (Number.isFinite(Math.max(...Object.values(scores))) && Math.max(...Object.values(scores)) >= 100) {
    if (lastPairKey) {
      const parts = lastPairKey.split('|');
      const name1 = REVIEWERS.find((r: string) => r.toLowerCase() === parts[0]);
      const name2 = REVIEWERS.find((r: string) => r.toLowerCase() === parts[1]);
      assigner.resetCounts(name1 && name2 ? [name1, name2] : undefined);
    } else {
      assigner.resetCounts();
    }
    scores = assigner.saveState().userCounts;
  }

  // Preserve previous scores for reviewers excluded from this run's pool (e.g. OOO, sick)
  if (restored?.scores) {
    for (const reviewer of REVIEWERS) {
      if (scores[reviewer] === undefined) {
        scores[reviewer] = restored.scores[reviewer] ?? 0;
      }
    }
  }

  saveState({ assigner: { userCounts: scores }, scores, lastPairKey, authorHistory });

  const prevPair =
    restored && restored.lastPairKey
      ? restored.lastPairKey.replace('|', ' - ')
      : 'None';

  const lastPair =
    lastPairKey && lastPairKey.length > 0
      ? lastPairKey.replace('|', ' - ')
      : 'None';

  const sortedReviewers = [...REVIEWERS].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  const maxScore = Math.max(...sortedReviewers.map(r => scores[r] ?? 0), 1);
  const medals = ['🥇', '🥈', '🥉'];

  const scoreboardTable = [
    '| Rank | Reviewer | Score | Progress |',
    '|:----:|----------|------:|:---------|',
    ...sortedReviewers.map((name, i) => {
      const value = scores[name] ?? 0;
      const filled = Math.round((value / maxScore) * 20);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      const rank = medals[i] ?? `${i + 1}`;
      return `| ${rank} | **${name}** | \`${value}\` | \`${bar}\` |`;
    }),
  ].join('\n');

  const statusBlock = assignmentsMade
    ? `> ✅ Run executed successfully\n` +
      `> 🤖 Assignments were made in this run\n\n`
    : `> ✅ Run executed successfully\n` +
      `> ℹ️ No PRs found in target channels — no assignments made in this run\n\n`;

  const githubSummary =
    `# 🟩 PR Review Bot — Assignment Report\n\n` +
    unavailableSummary +
    statusBlock +
    `## 🔁 Previous Pair\n` +
    `**${prevPair}**\n\n` +
    `## 🎯 Last Pair Assigned\n` +
    `**${lastPair}**\n\n` +
    `## 🧮 Reviewer Scoreboard\n\n` +
    `${scoreboardTable}\n\n` +
    `> 💡 Scores indicate how many PRs each reviewer took since the last reset.\n`;

  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, githubSummary, 'utf8');
  }

  // Fallback for run logs (::notice:: doesn't render markdown tables)
  const scoreboardLines = sortedReviewers.map((name, i) => {
    const value = scores[name] ?? 0;
    const rank = medals[i] ?? `${i + 1}.`;
    return `${rank} ${name}: ${value}`;
  }).join(' | ');

  console.log(`::notice::PR Review Bot | Prev: ${prevPair} | Last: ${lastPair} | ${scoreboardLines}`);
}

main().catch(err => {
  console.error('Batch failed:', err);
  process.exit(1);
});
