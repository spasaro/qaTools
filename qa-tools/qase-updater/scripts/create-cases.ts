/**
 * Creates test cases in Qase.
 *
 * Modes:
 *  1) Single via CLI:
 *     npm run create:case -- --suite=115 --title="New test" --tags=@smoke,Dario --automation=2
 *
 *  2) Bulk via CSV (columns: title,tags,automation,suiteId,optional sectionId):
 *     npm run create:case -- --csv=samples/new-cases.csv
 *
 * Notes:
 *  - automation: in your workspace 2 = automated
 *  - tags: comma-separated (@smoke,Dario) → sent as an array
 */

import fs from 'fs';
import path from 'path';
import { qase, PROJECT_CODE as ENV_PROJECT } from '../qase/client';

type Args = Record<string, string | boolean | undefined>;
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v ?? true];
  })
) as Args;

function parseTags(s?: string): string[] | undefined {
  if (!s) return undefined;
  return s
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function readCsv(csvPath: string): Array<Record<string, string>> {
  const full = path.resolve(csvPath);
  const content = fs.readFileSync(full, 'utf-8').trim();
  const lines = content.split(/\r?\n/);
  const header = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim());
    const obj: Record<string, string> = {};
    header.forEach((h, i) => (obj[h] = cols[i] ?? ''));
    return obj;
  });
}

async function createOne(params: {
  project: string;
  title: string;
  suiteId: number;
  tags?: string[];
  automation?: number;
  sectionId?: number;
  description?: string;
  preconditions?: string;
  postconditions?: string;
}) {
  const payload: any = {
    title: params.title,
    suite_id: params.suiteId
  };
  if (params.tags) payload.tags = params.tags;
  if (typeof params.automation === 'number') payload.automation = params.automation;
  if (params.sectionId) payload.section_id = params.sectionId;
  if (params.description) payload.description = params.description;
  if (params.preconditions) payload.preconditions = params.preconditions;
  if (params.postconditions) payload.postconditions = params.postconditions;

  const { data } = await qase.post(`/case/${params.project}`, payload);
  const id = data?.result?.id;
  console.log(`(OK) Created case ${id} in suite ${params.suiteId} → "${params.title}"`);
  return id;
}

async function main() {
  const project = (args.project as string) || ENV_PROJECT;
  if (!project) throw new Error('Define QASE_PROJECT_CODE in .env or pass --project=CODE');

  if (typeof args.csv === 'string') {
    const rows = readCsv(args.csv);
    for (const r of rows) {
      const title = r.title?.trim();
      const suiteId = Number(r.suiteId || r.suite_id || '0');
      if (!title) { console.error('(ERROR) Row without title'); continue; }
      if (!suiteId) { console.error(`(ERROR) Row "${title}" missing suiteId`); continue; }

      const tags = parseTags(r.tags);
      const automation = r.automation ? Number(r.automation) : undefined;
      const sectionId = r.sectionId ? Number(r.sectionId) : undefined;
      const description = r.description || undefined;
      const preconditions = r.preconditions || undefined;
      const postconditions = r.postconditions || undefined;

      try {
        await createOne({ project, title, suiteId, tags, automation, sectionId, description, preconditions, postconditions });
      } catch (err: any) {
        console.error('(ERROR)', err?.response?.data ?? err?.message ?? err);
        process.exitCode = 1;
      }
    }
    return;
  }

  const suiteId = Number(args.suite);
  const title = (args.title as string) || '';
  if (!suiteId) throw new Error('Missing --suite=<suite_id>');
  if (!title) throw new Error('Missing --title="Case title"');

  const tags = parseTags(args.tags as string | undefined);
  const automation = args.automation ? Number(args.automation) : undefined;
  const sectionId = args.sectionId ? Number(args.sectionId) : undefined;

  try {
    await createOne({ project, title, suiteId, tags, automation, sectionId });
  } catch (err: any) {
    console.error('(ERROR)', err?.response?.data ?? err?.message ?? err);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});