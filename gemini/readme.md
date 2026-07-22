# Gemini QA Coverage Analyzer (POC)

## Overview
This tool automates **test‑case coverage analysis** for Qase suites using **Google Gemini**, screenshots, and automated CSV extraction.

It integrates with **QASE Chat Bot**:  
Whenever someone posts a Qase suite link + screenshots in Slack, the bot replies with:
- Assigned reviewer(s)
- Automated Gemini coverage analysis
- Missing cases, suggested improvements, coverage score, etc.

## Folder Structure
```
gemini/
  analyzer.ts
  buildPrompt.ts
  client.ts
  qaCoverageRunner.ts
  qaseCsvLoader.ts
  runLocal.ts
  runSuiteAnalysis.ts
  slackFormatter.ts
  slackHandler.ts
  slackUtils.ts
  sample.png
  tsconfig.json
```

## 1. Requirements

### Environment variables
You must define:

```
GEMINI_API_KEY=your_google_gemini_key
```

A **.env** file must exist in `gemini/../.env`.

### Node
```
Node 20+
```

Install deps inside `gemini/`:

```
npm install
```

## 2. Running the analyzer locally

You can run a local analysis passing:
- suite ID (`--suite=XX`)
- image file (`--image=./whatever.png`)
- optional model name (`--model=gemini-2.0-flash`)

### Example
```
npm run analyze -- --suite=22 --image=./sample.png
```

## 3. Slack integration

The QASE Chat Bot automatically:

1. Detects messages containing:  
   `https://app.qase.io/project/TC?suite=XYZ`
2. Extracts the suite ID  
3. Executes Qase CSV export using:  
   ```
   npm run get:ids -- --suite=XYZ --toCsv=output/cases.csv
   ```
4. Downloads all screenshots posted in the message thread
5. Calls Gemini analyzer
6. Replies in Slack with the formatted coverage report

### Function used
```
runCoverageReviewForMessage({
  client,
  channel,
  threadTs,
  parentText,
  slackToken
})
```

## 4. Running Qase Suite Export Manually

Inside `qase-updater/`:

```
npm run get:ids -- --suite=22 --toCsv=output/cases.csv
```

This generates:
```
qase-updater/output/cases.csv
```

Then you can drop that CSV into the local analyzer.

## 5. Scripts

### `runLocal.ts`
Runs analysis locally:

```
npx ts-node runLocal.ts --suite=22 --image=./sample.png
```

### `runSuiteAnalysis.ts`
Low‑level runner used by Slack bot.

### `qaCoverageRunner.ts`
Glue between:
- CSV loader  
- Prompt builder  
- Gemini API  
- Slack formatting  

### `slackHandler.ts`
Used by the Chat Bot to:
- Extract suite ID
- Download all screenshots
- Run coverage analysis
- Post results

## 6. Slack Bot YAML (Github Actions)
The bot runs every 30 minutes and responds only to Qase URLs.

❗ **Important:**  
If Gemini fails, the bot still completes its execution with a warning message in Slack.  
The batch job **never fails** because of analysis errors.

## 7. Model Used
Default model:
```
gemini-2.5-flash-lite
```

Retry logic:
- Up to 3 attempts
- Auto‑backoff
- Fallback to text‑only prompt if images fail

## 8. Result Format
Gemini always returns a JSON:

```
{
  "suiteId": 22,
  "globalScore": 87,
  "rating": "Good",
  "justification": "...",
  "missingCriticalCases": [...],
  "suggestedImprovements": [...],
  "perTestFeedback": [...]
}
```

This JSON is rendered into a readable Slack message.

---

## 9. Local Development Notes

### Update dependencies:
```
npm install
```

### If using VSCode
TypeScript config is included.

### To debug Gemini errors:
```
GEMINI_DEBUG=1 npm run analyze ...
```

---

## 10. License
Internal Tool — temporary POC state until validated.

