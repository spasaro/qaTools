import fs from 'node:fs/promises';
import { qase, PROJECT_CODE } from './client.js';

type QaseCase = {
  id: number;
  title: string;
  automation?: number | null;
};

type QaseCasesResponse = {
  status: boolean;
  result?: {
    total?: number;
    count?: number;
    entities?: QaseCase[];
  };
};

async function fetchAllCases(projectCode: string): Promise<QaseCase[]> {
  const limit = 100;
  let offset = 0;
  const all: QaseCase[] = [];

  for (;;) {
    const res = await qase.get<QaseCasesResponse>(`/case/${projectCode}`, {
      params: { limit, offset },
    });

    const entities = res.data.result?.entities ?? [];
    const total = res.data.result?.total ?? entities.length;

    all.push(...entities);

    if (!entities.length || all.length >= total) {
      break;
    }

    offset += entities.length;
  }

  return all;
}

function buildHtml(total: number, automated: number, manual: number): string {
  const automatedPct = total ? ((automated / total) * 100).toFixed(1) : '0.0';
  const manualPct = total ? ((manual / total) * 100).toFixed(1) : '0.0';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>QASE – Test Case Overview</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin: 0;
      padding: 24px;
      background: #0b0c10;
      color: #f5f5f5;
    }
    .card {
      max-width: 720px;
      margin: 0 auto;
      padding: 24px;
      border-radius: 12px;
      background: #161821;
      box-shadow: 0 16px 40px rgba(0,0,0,0.35);
    }
    h1 {
      margin: 0 0 16px;
      font-size: 24px;
    }
    h2 {
      margin: 0 0 24px;
      font-size: 18px;
      font-weight: 500;
      color: #c8d0e0;
    }
    .layout {
      display: flex;
      gap: 32px;
      align-items: center;
      flex-wrap: wrap;
    }
    .meta {
      min-width: 220px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      margin: 4px 0;
      font-size: 14px;
    }
    .legend {
      margin-top: 16px;
      font-size: 14px;
    }
    .legend-item {
      display: flex;
      align-items: center;
      margin-bottom: 4px;
    }
    .legend-color {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      margin-right: 8px;
    }
    .legend-automated {
      background: #4285f4;
    }
    .legend-manual {
      background: #ea4335;
    }
    .total {
      margin-top: 8px;
      font-weight: 500;
    }
    .footer {
      margin-top: 24px;
      font-size: 12px;
      color: #9aa4c0;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1>QAE2E – Test Case Overview</h1>
    <h2>All Test Cases (Done: Automated – To Do: Manual)</h2>

    <div class="layout">
      <canvas id="qasePieChart" width="260" height="260"></canvas>

      <div class="meta">
        <div class="meta-row">
          <span>Automated</span>
          <span>${automated} (${automatedPct}%)</span>
        </div>
        <div class="meta-row">
          <span>Manual / To Do</span>
          <span>${manual} (${manualPct}%)</span>
        </div>
        <div class="total">
          Total cases: ${total}
        </div>

        <div class="legend">
          <div class="legend-item">
            <span class="legend-color legend-automated"></span>
            <span>Done (Automated)</span>
          </div>
          <div class="legend-item">
            <span class="legend-color legend-manual"></span>
            <span>To Do (Manual)</span>
          </div>
        </div>
      </div>
    </div>

    <div class="footer">
      Generated from QASE API for project <strong>${PROJECT_CODE}</strong>.
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script>
    const ctx = document.getElementById('qasePieChart').getContext('2d');
    new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Automated', 'Manual / To Do'],
        datasets: [{
          data: [${automated}, ${manual}],
          backgroundColor: ['#4285f4', '#ea4335'],
          hoverOffset: 4
        }]
      },
      options: {
        plugins: {
          legend: {
            display: false
          }
        },
        cutout: '55%'
      }
    });
  </script>
</body>
</html>`;
}

async function main() {
  const cases = await fetchAllCases(PROJECT_CODE);

  const total = cases.length;
  const automated = cases.filter(c => typeof c.automation === 'number' && c.automation > 0).length;
  const manual = total - automated;

  const html = buildHtml(total, automated, manual);
  const outputPath = 'qase-test-case-overview.html';

  await fs.writeFile(outputPath, html, 'utf8');
  process.stdout.write(`HTML report generated at: ${outputPath}\n`);
}

main().catch(err => {
  console.error('Failed to generate QASE report:', err);
  process.exit(1);
});
