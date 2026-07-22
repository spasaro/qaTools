# 🧩 Qase Updater

CLI tool to **create or modify test cases in Qase** using REST API calls.  
Ideal for bulk updates, tagging, or case creation directly from CSV files.

---

## 📦 Requirements
- **Node.js** ≥ 18  
- **Qase API Token**

---

## ⚙️ Setup

```bash
cp .env.example .env
```

Then edit your `.env` file with:

```env
QASE_API_KEY=<your_api_key>
QASE_PROJECT_CODE=<your_project_code>
```

Install dependencies:

```bash
npm install
```

---

## 🚀 Usage / Scripts

### 🔄 Update test cases
Update cases using tags or fields defined in a CSV file:

```bash
npm run update -- --csv=samples/cases.csv --tag=@smoke --automated
```

👉 Updates all test cases listed in `samples/cases.csv`, adding the tag `@smoke` and setting them as automated.

---

### 🏷️ Add or remove tags
Add multiple tags and optionally remove others:

```bash
npm run update -- --ids=1119 --tag=@smoke,@regression --removeTag=@regression
```

---

### 📋 Get test case IDs from a suite
Retrieve case IDs from a specific suite:

```bash
npm run get:ids -- --suite=104
```

Save the result to a CSV file:

```bash
npm run get:ids -- --suite=104 --toCsv=output/cases.csv
```

---

### 🆕 Create new test cases

#### Single test case
```bash
npm run create:case -- --suite=115 --title="New test from CLI" --tags=@smoke --automation=2
```

#### Multiple test cases (from CSV)
```bash
npm run create:case -- --csv=samples/new-cases.csv
```

---

## 📁 Folder Structure (suggested)
```
.
├── samples/
│   ├── cases.csv
│   └── new-cases.csv
├── output/
│   └── cases.csv
├── src/
│   ├── api/
│   ├── utils/
│   └── scripts/
├── .env
└── package.json
```

---

## 💡 Tips
- Use `--dryRun` (if implemented) to preview changes before updating Qase.  
- Always verify suite IDs and project code before bulk operations.  
- Combine flags for advanced filtering (e.g., `--tag`, `--removeTag`, `--automated`).  

---

© 2025
