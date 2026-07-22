# SDET On-Call Slack Bot

A lightweight Slack bot that automatically notifies the SDET on-call person each weekday.

The bot:
- Posts a message in a configured Slack channel indicating who is on-call today
- Sends a direct message (DM) to the assigned on-call person as a reminder
- Runs automatically via GitHub Actions on a scheduled cron (9:00 AM Argentina time)

---

## How It Works

1. The on-call rotation is provided via a GitHub Secret (`ON_CALL_SCHEDULE`)
2. Every weekday morning, a GitHub Actions workflow runs the bot
3. The bot:
   - Determines **today’s date** in `America/Buenos_Aires`
   - Finds the matching on-call entry for today
   - Resolves the Slack user ID
   - Posts a message in the configured Slack channel
   - Sends a DM to the on-call person

No state is persisted. Everything is computed fresh on each run.

---

## On-Call Schedule Format

The schedule is provided as **plain text**, usually copy-pasted from Slack.

Example:

```
Monday 01/19: Florencia MIHAICH
Tuesday 01/20: Nicolas Rizzo
Wednesday 01/21: Facundo VEGA PUENTE
Thursday 01/22: Rachel GARZA
Friday 01/23: Prasanth HARIKUMAR
Monday 01/26: Mauro LAURENZI
Tuesday 01/27: Dario SPASARO
Wednesday 01/28: Florencia MIHAICH
Thursday 01/29: Rachel GARZA
Friday 01/30: Prasanth HARIKUMAR
```

Notes:
- Bullet points (`•`) are optional
- Newlines or single-line text both work
- The year is inferred automatically based on the current date
- Names are matched using **full name or first name**

---

## Required GitHub Secrets

The bot relies entirely on GitHub Secrets.

### `ON_CALL_BOT_TOKEN`
Slack Bot OAuth Token  
Used to post messages and send DMs.

Example:
```
xoxb-************
```

---

### `SLACK_USER_IDS`
Mapping between human-readable names and Slack user IDs.

Format:
```
Dario:XXXXXX,Flor:XXXXXX,Rodri:XXXXXX
```

Rules:
- Keys are matched case-insensitively
- Full name or first name can be used
- Values must be valid Slack user IDs

---

### `ON_CALL_SCHEDULE`
The on-call rotation text.

Example:
```
Monday 01/19: Florencia MIHAICH Tuesday 01/20: Nicolas Rizzo Wednesday 01/21: Facundo VEGA PUENTE ...
```

This can be:
- Multi-line text
- Single-line pasted text
- Copied directly from Slack

---

### `SLACK_QASE_REPORTS_CHANNEL_ID`
Slack channel ID where the daily on-call message is posted.

Example:
```
C0123456789
```

---

## GitHub Actions Schedule

The workflow runs on weekdays at **09:00 AM Argentina time**:

```
cron: '0 12 * * 1-5'
```
(GitHub Actions uses UTC)

---

## Local Development

```bash
npm install
npm run build
npm run start
```

Required environment variables must be set locally for testing.

---
