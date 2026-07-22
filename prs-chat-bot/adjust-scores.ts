import fs from 'fs';
import path from 'path';

type BotState = {
  assigner: {
    userCounts: Record<string, number>;
  };
  scores: Record<string, number>;
  lastPairKey: string | null;
};

const STATE_DIR = process.env.STATE_DIR || path.resolve(__dirname, '../.state');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function loadState(): BotState {
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  return JSON.parse(raw) as BotState;
}

function saveState(state: BotState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function parseAdjustments(raw: string | undefined): Record<string, number> {
  const result: Record<string, number> = {};
  if (!raw) return result;

  const parts = raw.split(',').map(p => p.trim()).filter(p => p.length > 0);

  for (const part of parts) {
    const [name, deltaStr] = part.split('=').map(p => p.trim());
    if (!name || !deltaStr) continue;

    const delta = Number(deltaStr);
    if (!Number.isFinite(delta)) continue;

    result[name] = (result[name] ?? 0) + delta;
  }

  return result;
}

function applyAdjustments(): void {
  const adjustments = parseAdjustments(process.env.ADJUST_SCORES);
  if (Object.keys(adjustments).length === 0) return;

  const state = loadState();
  const scores = state.scores ?? {};

  for (const [name, delta] of Object.entries(adjustments)) {
    const current = scores[name] ?? 0;
    const next = current + delta;
    scores[name] = next < 0 ? 0 : next;
  }

  state.scores = scores;
  saveState(state);
}

applyAdjustments();
