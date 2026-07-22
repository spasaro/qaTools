/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { WebClient, LogLevel } from "@slack/web-api";
import { runCoverageReviewForMessage } from "../gemini/qaCoverageRunner.js";
import { extractSuiteIdFromText } from "../gemini/slackUtils.js";
import {
  SlackStatus,
  type SlackUserMap,
  type UnavailableReviewer,
} from "./slackStatus.js";

interface State {
  lastIndex: number;
  lastReviewer: string | null;
  lastTsByChannel: Record<string, string>;
  processedMessageTsByChannel: Record<string, string[]>;
  assignedMessageTsByChannel: Record<string, string[]>;
}

interface Assignment {
  channel: string;
  channelId: string;
  messageTs: string;
  mentions: string[];
  assignedIds: string[];
  assignedNames: string[];
}

function getEnv(name: string, required = true): string {
  const value = process.env[name];
  if (!value && required) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value ?? "";
}

function parseSlackMap(raw: string | undefined): {
  names: string[];
  ids: string[];
  map: Record<string, string>;
} {
  if (!raw) {
    throw new Error("SLACK_USER_IDS env var is not set");
  }

  const map: Record<string, string> = {};
  const clean = raw.trim();
  if (!clean) {
    throw new Error("SLACK_USER_IDS is empty");
  }

  try {
    const json = JSON.parse(clean) as Record<string, string>;
    for (const [name, id] of Object.entries(json)) {
      map[name.toLowerCase()] = id;
    }
  } catch {
    const entries = clean
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const [name, id] = entry.split(":").map(s => s.trim());
      if (name && id) {
        map[name.toLowerCase()] = id;
      }
    }
  }

  const names = Object.keys(map);
  const ids = Object.values(map);

  if (names.length === 0) {
    throw new Error("No valid Slack users found in SLACK_USER_IDS");
  }

  return { names, ids, map };
}

function parseTargetChannels(raw: string): string[] {
  return raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function isChannelId(value: string): boolean {
  return /^[CG][A-Z0-9]+$/iu.test(value);
}

async function resolveChannelId(
  api: WebClient,
  nameOrId: string,
): Promise<string | null> {
  if (isChannelId(nameOrId)) {
    return nameOrId;
  }

  const name = nameOrId.replace(/^#/, "");
  let cursor: string | undefined;

  for (let i = 0; i < 20; i += 1) {
    const res = await api.conversations.list({
      exclude_archived: true,
      limit: 1000,
      cursor,
    });

    const chans = res.channels ?? [];
    const found = chans.find(
      c => (c?.name ?? "").toLowerCase() === name.toLowerCase(),
    );

    if (found?.id) {
      return found.id;
    }
    cursor = res.response_metadata?.next_cursor || undefined;
    if (!cursor) {
      break;
    }
  }

  return null;
}

function loadState(stateFile: string): State {
  if (!fs.existsSync(stateFile)) {
    return {
      lastIndex: -1,
      lastReviewer: null,
      lastTsByChannel: {},
      processedMessageTsByChannel: {},
      assignedMessageTsByChannel: {},
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf8")) as Partial<State>;
    const lastIndex =
      typeof parsed.lastIndex === "number" ? parsed.lastIndex : -1;
    const lastReviewer =
      typeof parsed.lastReviewer === "string" ? parsed.lastReviewer : null;
    const lastTsByChannel =
      parsed.lastTsByChannel && typeof parsed.lastTsByChannel === "object"
        ? (parsed.lastTsByChannel as Record<string, string>)
        : {};
    const processedMessageTsByChannel =
      parsed.processedMessageTsByChannel &&
      typeof parsed.processedMessageTsByChannel === "object"
        ? (parsed.processedMessageTsByChannel as Record<string, string[]>)
        : {};
    const assignedMessageTsByChannel =
      parsed.assignedMessageTsByChannel &&
      typeof parsed.assignedMessageTsByChannel === "object"
        ? (parsed.assignedMessageTsByChannel as Record<string, string[]>)
        : {};

    return {
      lastIndex,
      lastReviewer,
      lastTsByChannel,
      processedMessageTsByChannel,
      assignedMessageTsByChannel,
    };
  } catch {
    return {
      lastIndex: -1,
      lastReviewer: null,
      lastTsByChannel: {},
      processedMessageTsByChannel: {},
      assignedMessageTsByChannel: {},
    };
  }
}

function saveState(stateFile: string, state: State): void {
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), "utf8");
}

function writeArtifact(
  dir: string,
  data: {
    timestamp: string;
    assignments: Assignment[];
    nextIndex: number;
    lastTsByChannel: Record<string, string>;
    unavailableReviewers: Array<{ name: string; reason: string }>;
  },
): string {
  const filePath = path.join(dir, "qase-bot-last-assignment.json");
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  return filePath;
}

function buildRegex(allowedRepo: string | undefined): RegExp {
  const def = /https:\/\/app\.qase\.io\/project\/TC/iu;

  if (!allowedRepo) {
    return def;
  }

  try {
    const esc = allowedRepo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(esc, "iu");
  } catch {
    return def;
  }
}

async function main(): Promise<void> {
  const token = getEnv("QASE_BOT_TOKEN");
  const reviewersPerPR = parseInt(
    getEnv("QASE_REVIEWERS_PER_PR", false) || "1",
    10,
  );

  const stateDir = getEnv("QASE_STATE_DIR", false) || "./.state";

  const slackMap = parseSlackMap(process.env.SLACK_USER_IDS);
  const targetChannels = parseTargetChannels(process.env.TARGET_CHANNELS || "");

  const allowed =
    getEnv("QASE_ALLOWED_REPO", false) ||
    "https://app.qase.io/project/TC";

  const urlRx = buildRegex(allowed);

  if (slackMap.ids.length === 0) {
    throw new Error("Empty reviewers list from SLACK_USER_IDS");
  }

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const stateFile = path.join(stateDir, "qase-bot-state.json");
  const state = loadState(stateFile);

  const api = new WebClient(token, { logLevel: LogLevel.ERROR });
  const slackStatus = new SlackStatus(api);

  const resolvedChannels: { name: string; id: string }[] = [];

  for (const ch of targetChannels) {
    const id = await resolveChannelId(api, ch);
    if (id) {
      resolvedChannels.push({ name: ch, id });
    }
  }

  if (resolvedChannels.length === 0) {
    console.log("ℹ️ No resolvable TARGET_CHANNELS. Exiting.");
    writeArtifact(stateDir, {
      timestamp: new Date().toISOString(),
      assignments: [],
      nextIndex: state.lastIndex,
      lastTsByChannel: state.lastTsByChannel,
      unavailableReviewers: [],
    });
    return;
  }

  const slackUserMap: SlackUserMap = {
    names: slackMap.names,
    ids: slackMap.ids,
  };

  const { available: availableReviewers, unavailable: unavailableReviewers } =
    await slackStatus.partitionReviewers(slackUserMap);

  if (availableReviewers.ids.length === 0) {
    console.log("ℹ️ No available reviewers (all in PTO or filtered). Exiting.");
    writeArtifact(stateDir, {
      timestamp: new Date().toISOString(),
      assignments: [],
      nextIndex: state.lastIndex,
      lastTsByChannel: state.lastTsByChannel,
      unavailableReviewers: unavailableReviewers.map((reviewer: UnavailableReviewer) => ({
        name: reviewer.name,
        reason: reviewer.reason,
      })),
    });
    return;
  }

  const assignments: Assignment[] = [];
  let index = state.lastIndex;

  const lookbackSeconds =
    parseInt(process.env.QASE_LOOKBACK_SECONDS || "", 10) || 60 * 60 * 24;
  const oldestSeconds = Math.floor(Date.now() / 1000) - lookbackSeconds;

  for (const ch of resolvedChannels) {
    const history = await api.conversations.history({
      channel: ch.id,
      oldest: String(oldestSeconds),
      inclusive: false,
      limit: 200,
    });

    const rawMessages = Array.isArray(history.messages)
      ? history.messages
      : [];

    const messages = rawMessages.filter(
      m => m.type === "message" && typeof m.text === "string",
    ) as Array<{
      ts: string;
      text: string;
      thread_ts?: string;
      user?: string;
    }>;

    const matches = messages.filter(m => urlRx.test(m.text));

    const processedTsList =
      state.processedMessageTsByChannel[ch.id] || [];
    const processedSet = new Set(processedTsList);

    const assignedTsList =
      state.assignedMessageTsByChannel[ch.id] || [];
    const assignedSet = new Set(assignedTsList);

    for (const msg of matches.sort((a, b) => Number(a.ts) - Number(b.ts))) {
      if (msg.thread_ts && assignedSet.has(msg.thread_ts)) {
        continue;
      }

      if (assignedSet.has(msg.ts)) {
        continue;
      }

      if (processedSet.has(msg.ts)) {
        continue;
      }

      const posterId = msg.user;

      const eligibleIds: string[] = [];
      const eligibleNames: string[] = [];

      for (let i = 0; i < availableReviewers.ids.length; i += 1) {
        const reviewerId = availableReviewers.ids[i];
        if (reviewerId !== posterId) {
          eligibleIds.push(reviewerId);
          eligibleNames.push(availableReviewers.names[i]);
        }
      }

      if (eligibleIds.length === 0) {
        processedSet.add(msg.ts);
        continue;
      }

      const baseIndex = index < 0 ? 0 : index;
      let nextIndex = (baseIndex + reviewersPerPR) % eligibleIds.length;

      let assignedIds = eligibleIds.slice(
        nextIndex,
        nextIndex + reviewersPerPR,
      );
      let assignedNames = eligibleNames.slice(
        nextIndex,
        nextIndex + reviewersPerPR,
      );

      if (state.lastReviewer && eligibleIds.length > reviewersPerPR) {
        const maxIterations = eligibleIds.length;
        let iterations = 0;

        while (
          assignedNames.join(", ") === state.lastReviewer &&
          iterations < maxIterations
        ) {
          nextIndex = (nextIndex + reviewersPerPR) % eligibleIds.length;
          assignedIds = eligibleIds.slice(
            nextIndex,
            nextIndex + reviewersPerPR,
          );
          assignedNames = eligibleNames.slice(
            nextIndex,
            nextIndex + reviewersPerPR,
          );
          iterations += 1;
        }
      }

      const mentions = assignedIds.map(id => `<@${id}>`);
      index = nextIndex;

      if (mentions.length === 0) {
        processedSet.add(msg.ts);
        continue;
      }

      await api.chat.postMessage({
        channel: ch.id,
        thread_ts: msg.thread_ts || msg.ts,
        text: `👋 Assigned reviewer(s): ${mentions.join(", ")}`,
      });

      assignments.push({
        channel: ch.name,
        channelId: ch.id,
        messageTs: msg.ts,
        mentions,
        assignedIds,
        assignedNames,
      });

      state.lastReviewer = assignedNames.join(", ");

      processedSet.add(msg.ts);
      assignedSet.add(msg.ts);

      await processCoverageForMessage({
        api,
        token,
        channelId: ch.id,
        msg,
      });
    }

    const baseTs = state.lastTsByChannel[ch.id] ?? String(oldestSeconds);
    const maxTs = messages.reduce(
      (acc, m) =>
        Number(m.ts) > Number(acc) ? m.ts : acc,
      baseTs,
    );

    state.lastTsByChannel[ch.id] = maxTs;
    state.processedMessageTsByChannel[ch.id] = Array.from(processedSet);
    state.assignedMessageTsByChannel[ch.id] = Array.from(assignedSet);
  }

  state.lastIndex = index;
  saveState(stateFile, state);

  const artifactPath = writeArtifact(stateDir, {
    timestamp: new Date().toISOString(),
    assignments,
    nextIndex: state.lastIndex,
    lastTsByChannel: state.lastTsByChannel,
    unavailableReviewers: unavailableReviewers.map((reviewer: UnavailableReviewer) => ({
      name: reviewer.name,
      reason: reviewer.reason,
    })),
  });

  if (assignments.length === 0) {
    console.log("ℹ️ No new QASE links detected. Nothing assigned.");
  } else {
    console.log(`✅ Assigned on ${assignments.length} message(s).`);
  }

  console.log(`💾 State: ${stateFile}`);
  console.log(`📦 Artifact: ${artifactPath}`);
}

async function processCoverageForMessage(params: {
  api: WebClient;
  token: string;
  channelId: string;
  msg: { text: string; ts: string; thread_ts?: string };
}): Promise<void> {
  const { api, token, channelId, msg } = params;

  const suiteId = extractSuiteIdFromText(msg.text);
  if (!suiteId) {
    return;
  }

  try {
    console.log(`🔍 Generating Qase CSV for suite ${suiteId}...`);

    execSync(
      `cd ../qase-updater && npm run get:ids -- --suite=${suiteId} --toCsv=output/cases.csv`,
      { stdio: "inherit" },
    );

    console.log("📸 Running coverage analysis...");

    await runCoverageReviewForMessage({
      client: api,
      channel: channelId,
      threadTs: msg.thread_ts || msg.ts,
      parentText: msg.text,
      slackToken: token,
    });

    console.log("✅ Coverage analysis posted.");
  } catch (error) {
    console.error("❌ Coverage analysis failed:", error);
    await api.chat.postMessage({
      channel: channelId,
      thread_ts: msg.thread_ts || msg.ts,
      text: "⚠️ Coverage analysis failed. Check logs.",
    });
  }
}

main().catch(error => {
  console.error("❌ Batch execution failed:", error);
  process.exit(1);
});
