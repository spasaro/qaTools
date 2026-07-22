import fs from "fs";
import path from "path";
import { promisify } from "util";
import { exec as cpExec } from "child_process";
import { parse } from "csv-parse/sync";
import { QaseTestCase } from "./analyzer";

const exec = promisify(cpExec);

const QASE_UPDATER_DIR = path.resolve(__dirname, "../qase-updater");
const OUTPUT_CSV = path.join(QASE_UPDATER_DIR, "output", "cases.csv");

type CsvRow = {
  id: string;
  title: string;
  automation?: string;
  tags?: string;
};

export async function loadQaseCasesFromCsv(suiteId: number): Promise<QaseTestCase[]> {
  await exec(`npm run get:ids -- --suite=${suiteId} --toCsv=output/cases.csv`, {
    cwd: QASE_UPDATER_DIR
  });

  const csv = fs.readFileSync(OUTPUT_CSV, "utf8");

  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true
  }) as CsvRow[];

  const cases: QaseTestCase[] = records.map((row) => {
    const labels =
      row.tags && row.tags.trim().length > 0
        ? row.tags
            .split(/\s+/)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];

    return {
      id: Number(row.id),
      title: row.title,
      labels
    };
  });

  return cases;
}