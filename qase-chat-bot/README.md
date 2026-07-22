# QASE Chat Bot — Automated Slack Reviewer Rotation

## 🚀 Overview
QASE Chat Bot is a GitHub Actions–powered automation that scans Slack channels for Qase links and automatically assigns reviewers in a rotating sequence.  
It supports multi-channel scanning, state persistence, Slack thread replies, and artifact outputs.

---

## ⚙️ Required Environment Variables

| Variable | Description |
|---------|-------------|
| `QASE_BOT_TOKEN` | Slack Bot Token for this app |
| `QASE_ALLOWED_REPO` | Base Qase URL to detect (e.g., `https://app.qase.io/project/TC`) |
| `QASE_REVIEWERS_PER_PR` | Number of reviewers to assign per message |
| `REVIEWERS` | Comma‑separated list of reviewer names (used for display) |
| `SLACK_USER_IDS` | Mapping of reviewer names to Slack IDs (JSON or `name:id,name:id`) |
| `TARGET_CHANNELS` | Slack channels or channel IDs to scan |
| `QASE_STATE_DIR` | Directory for persisted rotation state |

---

## 📂 Project Structure

```
qase-chat-bot/
  ├── batch.ts
  ├── package.json
  ├── slackStatus.ts
  ├── tsconfig.json
  └── .state/
```

`batch.ts` is the main script executed by GitHub Actions.

---

## 🏗️ GitHub Action Summary

The QASE Chat Bot GitHub Action:

- Runs **every 0 and 30 minutes between 08:00 and 18:00 BA time**
- Scans the configured Slack channels for new Qase URLs
- Checks if someone is OOO to not assign someone as reviewer
- Assigns reviewers in a rotating order
- Replies inside the same Slack thread
- Avoids assigning the person who wrote the message
- Persists rotation and per‑channel timestamps
- Generates artifacts for debugging and historical tracking

---

## 🧪 Running Locally

### 1. Install dependencies
```
npm install
```

### 2. Create `.env` with:
```
QASE_BOT_TOKEN=
QASE_ALLOWED_REPO=https://app.qase.io/project/TC
QASE_REVIEWERS_PER_PR=1
REVIEWERS=Dario,Rodri,Mauro
SLACK_USER_IDS={"dario":"U123","rodri":"U456","mauro":"U789"}
TARGET_CHANNELS=general,my-channel
QASE_STATE_DIR=.state
```

### 3. Execute the bot manually
```
npx tsx batch.ts
```

---

## 🔄 Rotation Logic

- Reviewer order is circular  
  Example: `[A,B,C,D]` → A → B → C → D → A …
- Reviewers who match the author of the detected message are skipped
- People that are OOO won't be assigned as reviewers
- Rotation state survives across GitHub Action runs due to caching and `.state` files

---

## 🔍 Slack Behavior

- The bot replies **in the thread** of each detected Qase message
- Mentions use Slack IDs: `<@UXXXXX>`
- Multiple channels are supported
- Channel IDs are resolved automatically from names

---

## 🧠 Notes

- The bot uses `conversations.history` with per‑channel timestamps to ensure no duplicate assignments.
- If no messages are detected, the bot logs this and generates an empty assignment artifact.
- If `SLACK_USER_IDS` is provided as JSON or as a simple string map, both formats are accepted.

---

## ✨ Made for the QA Tools ecosystem

This bot is part of your internal automation suite, designed to reduce manual reviewer assignment and improve PR/Qase workflow efficiency.
