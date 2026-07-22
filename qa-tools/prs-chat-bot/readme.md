# 🤖 PRs Chat Bot

The **PRs Chat Bot** is a Slack-based automation tool built with Node.js and TypeScript using the `@slack/bolt` framework.
It automatically detects GitHub Pull Request links shared in Slack channels and assigns reviewers equitably with a **daily fair rotation algorithm + persistent scoring system**.

With the new **Reviewer Scoring System**, the bot now keeps long-term scores for each reviewer, ensuring balanced distribution across days, weeks, and months — not just per-day rotation.

---

## ✨ Key Features

- Automatic detection of GitHub PR links posted in Slack.
- Fair reviewer assignment based on:
  - Daily deterministic shuffle
  - Long-term reviewer scoring (NEW)
  - Exclusion of PR author
  - Exclusion of people that is OOO
- Real Slack mentions (`<@USER_ID>`).
- Socket Mode support (no ngrok/localtunnel needed).
- Repository filtering via `ALLOWED_REPOS`.
- Batch mode for CI/CD (scheduled).
- Persistent daily state **and** persistent long-term scoring (NEW).
- Score recovery across runs (NEW).

---

## 🆕 Reviewer Scoring System (NEW)

The bot now maintains a **persistent scoring file** that tracks how many times each reviewer has been assigned over time.

### How it works

- Each reviewer starts with a score of **0**.
- Every time the bot assigns a reviewer, their score is incremented.
- Reviewers with **lower scores** are prioritized in future assignments.
- The scoring persists even across:
  - Daily resets
  - Workflow restarts
  - Machine restarts
  - Weekends and inactivity

### Benefits

- Prevents long-term reviewer imbalance.
- Ensures fairness even if certain people review fewer PRs on a given day.
- Makes assignment transparent and auditable.

### Score Persistence

Scores are stored inside the `.state/` directory under a dedicated file:

```
.state/reviewer-scores.json
```

This ensures:
- CI/CD restores correct long-term score state
- Bot mode and batch mode share the same scoring data
- No reviewer resets unless manually cleared

---

## 🔐 Environment Variables (`.env`)

| Variable | Description |
|-----------|--------------|
| `SLACK_BOT_TOKEN` | OAuth token from Slack |
| `SLACK_APP_TOKEN` | Socket Mode token |
| `SLACK_SIGNING_SECRET` | App signing secret |
| `REVIEWERS` | Comma-separated list of reviewer aliases |
| `SLACK_USER_IDS` | Map of aliases to Slack user IDs |
| `ALLOWED_REPOS` | Optional whitelist of repositories |
| `TARGET_CHANNELS` | Channels scanned in batch mode |
| `REVIEWERS_PER_PR` | Number of reviewers to assign |
| `STATE_DIR` | Directory for daily & scoring state |

---

## 🚀 Running the Bot (Socket Mode)

Install dependencies:
```bash
npm install
```

Run the bot locally:
```bash
npm run bot
```

No tunnel is required — the bot uses **Socket Mode**.

---

## ⚙️ Running Batch Mode (CI/CD)

The batch workflow scans messages hourly between 08:00–18:00 Buenos Aires.

It will:
- Restore fair rotation state
- Restore reviewer scoring data (NEW)
- Assign missing reviewers
- Update scoring and state files
- Save new cache version identified by GitHub run ID

Trigger manually via GitHub Actions:
```
PR Chat Bot (Batch Hourly) → Run workflow
```

---

## 🧠 Fair Rotation + Scoring Algorithm (NEW)

### Combined Logic

1. **Daily Shuffle**
   - Deterministic shuffle using current New York date.
   - Ensures randomness and fairness within each day.

2. **Long-Term Scoring**
   - Reviewers with fewer total assignments are prioritized.
   - Prevents “lucky” shuffle weeks where one reviewer gets fewer PRs.

3. **Assignment Rules**
   - Exclude PR author.
   - Exclude duplicates.
   - Exclude people that is OOO.
   - Pick lowest-score reviewers first.
   - Update scores immediately.

### Result
> The system is fair both **within the same day** and **across multiple days**.

---

## 🛠️ Maintenance & Best Practices

- Keep `.env` secure.
- Commit `package-lock.json`.
- Never delete `.state/` unless intentionally resetting scores.
- When updating reviewers, also update:
  - `REVIEWERS`
  - `SLACK_USER_IDS`
  - Optional: manually adjust `reviewer-scores.json`

---

## 🧩 Architecture Overview

- `fair-assigner.ts` → Assignment algorithm + scoring (NEW)
- `reviewer-scores.ts` → Persistent score handling (NEW)
- `batch.ts` → GitHub Actions batch runner
- `adjust-scores.ts` → Class for manually updating scores if needed
- `slack-availability.service.ts` → Class that manages all slack profile status code
- `.github/workflows/pr-chat-bot-batch.yml` → Scheduled workflow
- `.state/` → Persistent scoring & daily state storage

---

## 📚 Example Output (Slack)

```
🎯 Reviewers assigned:
<@U08V2G6UR9R>  <@U09A79EP1KR>

📊 Updated Scores:
Flor: 12
Dario: 11
Guille: 9
Rodri: 9
```

---

## Reviewers and slack user id mapping ( ENV variables/secrets )
**REVIEWERS**
Dario,Flor,Rodri,Mauro,Rachel,Prasanth,Facu,Nico

**SLACK_USER_IDS**
Dario:U09A79EP1KR,Flor:U08V2G6UR9R,Rodri:U093711UCSK,Mauro:U09371090NB,Rachel:U09DX9AJLDN,Prasanth:U014K3RV1LY,Facu:U093713A423,Nico:U09HPNM4WM8  

```
🎯 Reviewers assigned:
<@U08V2G6UR9R>  <@U09A79EP1KR>

📊 Updated Scores:
Flor: 12
Dario: 11
Guille: 9
Rodri: 9
```

---

## ❤️ Credits

Built with TypeScript, Slack Bolt, and a lot of patience debugging Socket Mode.
Now with a fair scoring system that your team will *actually trust*.
