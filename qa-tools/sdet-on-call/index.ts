import { WebClient } from '@slack/web-api';

type ScheduleEntry = {
  date: string;
  assignee: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function getTodayBuenosAiresISO(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

function getTodayBuenosAiresParts(): { year: number; month: number; day: number } {
  const iso = getTodayBuenosAiresISO();
  const [y, m, d] = iso.split('-').map(v => Number(v));
  return { year: y, month: m, day: d };
}

function toISODate(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pickYearForMonthDay(
  baseYear: number,
  baseMonth: number,
  baseDay: number,
  month: number,
  day: number,
): number {
  const base = new Date(Date.UTC(baseYear, baseMonth - 1, baseDay));
  const candidate = new Date(Date.UTC(baseYear, month - 1, day));
  const diffDays = Math.round((candidate.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
  if (diffDays < -180) return baseYear + 1;
  if (diffDays > 180) return baseYear - 1;
  return baseYear;
}

function parseUserIds(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, id] = trimmed.split(':').map(s => s.trim());
    if (!name || !id) continue;
    map.set(name.toLowerCase(), id);
  }
  return map;
}

function normalizeAssignee(raw: string): { full: string; first?: string } {
  const cleaned = raw
    .replace(/[@•]/gu, ' ')
    .replace(/\(.*?\)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  if (!cleaned) return { full: '' };

  const tokens = cleaned.split(' ').filter(Boolean);
  const first = tokens[0] ? tokens[0].toLowerCase() : undefined;

  return { full: cleaned.toLowerCase(), first };
}

function parseScheduleFromJson(raw: string, base: { year: number; month: number; day: number }): ScheduleEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const entries: ScheduleEntry[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const dateRaw = typeof obj.date === 'string' ? obj.date.trim() : '';
    const assigneeRaw = typeof obj.assignee === 'string' ? obj.assignee.trim() : '';
    if (!dateRaw || !assigneeRaw) continue;

    if (/^\d{4}-\d{2}-\d{2}$/u.test(dateRaw)) {
      entries.push({ date: dateRaw, assignee: assigneeRaw });
      continue;
    }

    const mmdd = dateRaw.match(/^(\d{1,2})\/(\d{1,2})$/u);
    if (mmdd) {
      const month = Number(mmdd[1]);
      const day = Number(mmdd[2]);
      const year = pickYearForMonthDay(base.year, base.month, base.day, month, day);
      entries.push({ date: toISODate(year, month, day), assignee: assigneeRaw });
    }
  }

  return entries;
}

function parseScheduleFromText(raw: string, base: { year: number; month: number; day: number }): ScheduleEntry[] {
  const cleaned = raw
    .replace(/\r/gu, ' ')
    .replace(/\n/gu, ' ')
    .replace(/\u00A0/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  const entries: ScheduleEntry[] = [];

  const re =
    /(?:•\s*)?(?:@?\s*)?(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d{1,2})\/(\d{1,2})\s*:\s*@?\s*([^•]+?)(?=(?:\s*•\s*|\s*(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+\d{1,2}\/\d{1,2}\s*:|$))/giu;

  let match: RegExpExecArray | null = re.exec(cleaned);
  while (match) {
    const month = Number(match[1]);
    const day = Number(match[2]);
    const assignee = String(match[3]).trim();
    if (month > 0 && day > 0 && assignee) {
      const year = pickYearForMonthDay(base.year, base.month, base.day, month, day);
      entries.push({ date: toISODate(year, month, day), assignee });
    }
    match = re.exec(cleaned);
  }

  return entries;
}

function parseScheduleFlexible(raw: string): ScheduleEntry[] {
  const base = getTodayBuenosAiresParts();

  const fromJson = parseScheduleFromJson(raw, base);
  if (fromJson.length > 0) return fromJson;

  const fromText = parseScheduleFromText(raw, base);
  if (fromText.length > 0) return fromText;

  throw new Error(
    'ON_CALL_SCHEDULE must be either a JSON array (objects with {date, assignee}) or the pasted Slack rotation text',
  );
}

const ASSIGNEE_ALIASES = new Map<string, string>([
  ['florencia', 'flor'],
  ['nicolas', 'nico'],
  ['facundo', 'facu'],
  ['rodrigo', 'rodri'],
]);

function parseChannelIds(raw: string): string[] {
  return raw
    .split(',')
    .map(id => id.trim())
    .filter(Boolean);
}

async function main(): Promise<void> {
  const token = requireEnv('ON_CALL_BOT_TOKEN');
  const slackUserIdsRaw = requireEnv('SLACK_USER_IDS');
  const scheduleRaw = requireEnv('ON_CALL_SCHEDULE');
  const channelIdsRaw = requireEnv('SLACK_ON_CALL_CHANNEL_IDS');

  const slack = new WebClient(token);

  const userIds = parseUserIds(slackUserIdsRaw);
  const schedule = parseScheduleFlexible(scheduleRaw);
  const channelIds = parseChannelIds(channelIdsRaw);

  const overrideDate = process.env.ON_CALL_DATE_OVERRIDE?.trim();
  const todayIso = overrideDate && /^\d{4}-\d{2}-\d{2}$/u.test(overrideDate) ? overrideDate : getTodayBuenosAiresISO();

  const entry = schedule.find(e => e.date === todayIso);

  if (!entry) {
    console.log(`No on-call entry found for ${todayIso}`);
    return;
  }

  const assigneeNorm = normalizeAssignee(entry.assignee);
  const alias = assigneeNorm.first ? ASSIGNEE_ALIASES.get(assigneeNorm.first) : undefined;

  const assigneeUserId =
    userIds.get(assigneeNorm.full) ??
    (assigneeNorm.first ? userIds.get(assigneeNorm.first) : undefined) ??
    (alias ? userIds.get(alias) : undefined);

  if (!assigneeUserId) {
    throw new Error(
      `No Slack user id found for assignee "${entry.assignee}". Check SLACK_USER_IDS secret (supports full name or first name).`,
    );
  }

  const mention = `<@${assigneeUserId}>`;

  for (const channelId of channelIds) {
    await slack.chat.postMessage({
      channel: channelId,
      text: `Today ${todayIso}: ${mention} will be on watch for e2e testing support.`,
    });
  }

  const dm = await slack.conversations.open({ users: assigneeUserId });
  const dmChannel = dm.channel?.id;

  if (!dmChannel) {
    throw new Error('Failed to open DM channel');
  }

  await slack.chat.postMessage({
    channel: dmChannel,
    text: `Reminder: Today ${todayIso} you are on watch for e2e testing support.`,
  });

  console.log(`Notified ${entry.assignee} for ${todayIso}`);
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
