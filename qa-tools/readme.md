# 🧰 QA Tools

A collection of **custom utilities for QA automation** — designed to improve efficiency, consistency, and integration across projects.

This repository gathers multiple tools built in **TypeScript**, intended for both **internal automation** and **CI/CD pipelines**.  
Each tool can be executed independently, with its own documentation and configuration.

---

## 🚀 Currently Available Tools

| Tool | Description 
|------|--------------|
| **[Qase API Tool](./qase-updater/readme.md)** | Command-line utility to create, update, or tag test cases in [Qase.io](https://qase.io/) using REST API calls. Ideal for bulk updates, tag management, and test case creation directly from CSV files. |
| **[PRs Chat Bot](./prs-chat-bot/readme.md)** | Slack-based automation bot that detects GitHub Pull Request links in channels and assigns reviewers equitably. Built with Node.js, TypeScript, and Socket Mode for seamless integration.
| **[QASE Chat Bot](./qase-chat-bot/README.md)** | Slack-based automation bot that detects QASE links in channels and assigns reviewers equitably. Built with Node.js, TypeScript, and Socket Mode for seamless integration.
| **[QASE Coverage Bot (Gemini)](./gemini/readme.md)** | Automated test-coverage reviewer powered by Google Gemini. Generates CSVs from Qase suites, analyzes coverage using screenshots + AI, and posts structured feedback directly in Slack threads.
| **[SDET On Call Bot](./sdet-on-call/README.md)** | Slack-based automation bot that read a secret variable and reminds the assigned SDET that is gonna be in charge of e2e testing support channel.
| **[GIT FLOW SCRIPT](./scripts/readme.md)** | Git workflow automation script that standardizes branching, rebasing, and backup processes to reduce human error in SDET workflows.
| **[E2E Retry Analyzer](https://github.com/tunecore/qa-tools/tree/main/e2e-retry-analyzer)** | Custom Python script that measures the time Playwright retries cost in the nova-e2e workflow.
| **[Jira Tools](./jira-tools/README.md)** | Python scripts that measure and visualize the AI impact on cycle time. Generates per-member and team reports from Jira data, compares pre-AI vs. AI-implemented tickets, and produces a self-contained HTML report. |
| **[Flaky Test Report](./flaky-test-report/README.md)** | Fetches all flaky E2E tests from the `nova-e2e` CircleCI workflow (integration branch) via the Insights v2 API and generates an HTML report sorted by fail rate. |
| **[E2E Weekly Report](./e2e-weekly-report/README.md)** | Generates a draft Slack message for the weekly E2E Workflow Execution report, crossing CircleCI flaky test data with open Jira tickets from the flaky reduction epic. |
---

## 🧩 Project Overview

- **Goal:** Centralize QA automation tools in one place  
- **Focus:**  
  - Qase integration  
  - Slack-based automations  
  - Fair reviewer assignment  
  - Report generation  

---

## ⚙️ Getting Started

Clone the repository:

```bash
git clone https://github.com/tunecore/qa-tools.git
cd qa-tools
npm install
```

Run any tool from its directory, for example:

```bash
cd qase-chat-bot
npx tsx batch.ts
```

---

## 🧠 Roadmap

- [x] QASE API integration  
- [x] CSV-based test case generator  
- [x] PR Chat Bot with fair reviewer distribution  
- [x] QASE Chat Bot — automated reviewer rotation on Slack  
- [x] QASE Summary Reporter
- [x] Integrating GEMINI for auto reviewing test cases  
- [x] SDET Bot - Notifications for the assigned SDET of the day
- [x] GIT FLOW script

---

## 🧾 License

This repository is private and intended for internal **TuneCore QA Automation** purposes.

---
