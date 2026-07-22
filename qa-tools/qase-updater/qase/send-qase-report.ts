import fs from 'fs';
import path from 'path';
import { WebClient } from '@slack/web-api';

const token = process.env.SLACK_QASE_REPORTS_BOT_TOKEN;
const channel = process.env.SLACK_QASE_REPORTS_CHANNEL_ID;

if (!token) {
  throw new Error('Missing SLACK_QASE_REPORTS_BOT_TOKEN');
}

if (!channel) {
  throw new Error('Missing SLACK_QASE_REPORTS_CHANNEL_ID');
}

const client = new WebClient(token);

function formatDate() {
  const now = new Date();
  return now
    .toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    })
    .replace(',', '');
}

async function main() {
  const argPath = process.argv[2];
  const fallbackPath = 'qase-test-case-overview.html';
  const finalPath = path.resolve(argPath || fallbackPath);

  if (!fs.existsSync(finalPath)) {
    throw new Error(`HTML report not found at: ${finalPath}`);
  }

  const uploadResult: any = await client.files.uploadV2({
    channel_id: channel,
    file: fs.createReadStream(finalPath),
    filename: path.basename(finalPath),
    title: 'Qase HTML Report'
  });

  const outerFileEntry = Array.isArray(uploadResult.files) ? uploadResult.files[0] : undefined;
  const slackFile =
    outerFileEntry && Array.isArray(outerFileEntry.files)
      ? outerFileEntry.files[0]
      : undefined;

  const downloadUrl =
    slackFile?.url_private_download ||
    slackFile?.permalink ||
    slackFile?.permalink_public ||
    slackFile?.url_private;

  const formattedDate = formatDate();

  if (!downloadUrl) {
    await client.chat.postMessage({
      channel,
      text: `:white_check_mark: QASE Test Case Report : ${formattedDate}`
    });
    return;
  }

  await client.chat.postMessage({
    channel,
    text: `:white_check_mark: QASE Test Case Report : ${formattedDate}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:white_check_mark: *QASE Test Case Report : ${formattedDate}*`
        }
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Download report',
              emoji: true
            },
            url: downloadUrl,
            style: 'primary'
          }
        ]
      }
    ]
  });
}

main().catch(error => {
  console.error('Failed to send Qase report to Slack:', error);
  process.exit(1);
});
