import { WebClient } from "@slack/web-api";
import { analyzeSuiteCoverage } from "./analyzer";
import { loadQaseCasesFromCsv } from "./qaseCsvLoader";
import { formatCoverageForSlack } from "./slackFormatter";
import { extractSuiteIdFromText, getThreadScreenshots } from "./slackUtils";

export async function runCoverageReviewForMessage(params: {
  client: WebClient;
  channel: string;
  threadTs: string;
  parentText: string;
  slackToken: string;
}) {
  const { client, channel, threadTs, parentText, slackToken } = params;

  const suiteId = extractSuiteIdFromText(parentText);
  if (!suiteId) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "Could not find a `suite=` parameter in the Qase URL from this message."
    });
    return;
  }

  const screenshots = await getThreadScreenshots({
    client,
    channel,
    threadTs,
    slackToken
  });

  if (screenshots.length === 0) {
    await client.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: "No screenshots found in this thread. Please upload at least one UI screenshot."
    });
    return;
  }

  const testCases = await loadQaseCasesFromCsv(suiteId);

  const analysis = await analyzeSuiteCoverage({
    suiteId,
    moduleName: undefined,
    testCases,
    screenshots
  });

  const text = formatCoverageForSlack(analysis);

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text
  });
}