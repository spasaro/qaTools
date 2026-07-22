import axios from "axios";
import { WebClient } from "@slack/web-api";
import { ScreenshotInput } from "./analyzer";

const ALLOWED_IMAGE_TYPES = new Set<string>([
  "image/png",
  "image/x-png",
  "image/jpeg",
  "image/jpg",
  "image/webp"
]);

export function extractSuiteIdFromText(text: string): number | null {
  const match = text.match(/suite=(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isNaN(id) ? null : id;
}

export async function getThreadScreenshots(params: {
  client: WebClient;
  channel: string;
  threadTs: string;
  slackToken: string;
}): Promise<ScreenshotInput[]> {
  const { client, channel, threadTs, slackToken } = params;

  const replies = await client.conversations.replies({
    channel,
    ts: threadTs,
    inclusive: true
  });

  const screenshots: ScreenshotInput[] = [];

  for (const message of replies.messages ?? []) {
    const files = (message as any).files ?? [];
    for (const file of files) {
      console.log("Found file info:", {
        name: file.name,
        mimetype: file.mimetype,
        url: file.url_private
      });

      const mimeType: string | undefined = file.mimetype;
      const urlPrivate: string | undefined = file.url_private;
      if (!mimeType || !urlPrivate) continue;
      if (!ALLOWED_IMAGE_TYPES.has(mimeType)) continue;

      const response = await axios.get<ArrayBuffer>(urlPrivate, {
        headers: { Authorization: `Bearer ${slackToken}` },
        responseType: "arraybuffer"
      });

      const base64 = Buffer.from(response.data).toString("base64");

      screenshots.push({
        mimeType,
        data: base64
      });
    }
  }

  return screenshots;
}
