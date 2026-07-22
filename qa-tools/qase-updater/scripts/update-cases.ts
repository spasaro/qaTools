/**
 * Usage:
 * 1) List of IDs:
 *    npm run update -- --ids=1119,1120 --tag=@smoke --automated
 *
 * 2) CSV (column: caseId):
 *    npm run update -- --csv=samples/cases.csv --tag=Dario --automation=1
 *
 * 3) Tags:
 *    --tag=a,b,c                (adds/merges)
 *    --replaceTags              (completely replaces; does not perform GET)
 *    --removeTag=X              (removes X; requires GET)
 *
 * 4) Automation:
 *    --automated                (shortcut => automation=1)
 *    --automation=0|1|2         (explicit)
 *
 * 5) Others:
 *    --dryRun                   (does not call the API, only shows payloads)
 */

import fs from 'fs';
import path from 'path';
import { qase, PROJECT_CODE } from '../qase/client';

type Args = Record<string, string | boolean | undefined>;
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.split('=');
    return [k.replace(/^--/, ''), v ?? true];
  })
) as Args;

function parseIdsList(ids?: string): number[] {
  if (!ids) return [];
  return ids
    .split(',')
    .map(s => Number(s.trim()))
    .filter(n => !Number.isNaN(n));
}

function readCsvIds(csvPath?: string): number[] {
  if (!csvPath) return [];
  const full = path.resolve(String(csvPath));
  const content = fs.readFileSync(full, 'utf-8');
  const lines = content.trim().split(/\r?\n/);
  const header = lines[0].split(',').map(s => s.trim());
  const idx = header.indexOf('caseId');
  if (idx === -1) throw new Error(`CSV (${full}) must contain a "caseId" column`);
  const ids = lines
    .slice(1)
    .map(l => Number(l.split(',')[idx]?.trim()))
    .filter(n => !Number.isNaN(n));
  if (!ids.length) throw new Error(`CSV (${full}) does not contain valid IDs`);
  console.log(`CSV: ${ids.length} caseId(s) loaded.`);
  return ids;
}

async function getCase(project: string, caseId: number) {
  const res = await qase.get(`/case/${project}/${caseId}`);
  return res.data?.result as { tags?: string[] } | undefined;
}

function parseTagsInput(tagArg?: string): string[] | undefined {
  if (!tagArg) return undefined;
  return tagArg
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);
}

function mergeTags(existing: string[] | undefined, toAdd?: string[], toRemove?: string): string[] {
  const set = new Set(existing || []);
  if (toAdd) for (const t of toAdd) set.add(t);
  if (toRemove) set.delete(toRemove);
  return Array.from(set);
}

function resolveAutomation(args: Args): number | undefined {
  const automatedFlag = String(args.automated || 'false') === 'true';
  if (automatedFlag) return 2;

  if (typeof args.automation === 'string') {
    const val = Number(args.automation);
    if ([0, 1, 2].includes(val)) return val;
    throw new Error(`Invalid value for --automation (${args.automation}). Use 0|1|2.`);
  }
  return undefined;
}

async function updateCase(caseId: number, payload: any, dryRun: boolean) {
  if (dryRun) {
    console.log(`(DRY RUN) Case ${caseId} -> ${JSON.stringify(payload)}`);
    return;
  }
  return qase.patch(`/case/${PROJECT_CODE}/${caseId}`, payload);
}

async function main() {
  const listIds = parseIdsList(args.ids as string | undefined);
  const csvIds = readCsvIds(args.csv as string | undefined);
  const caseIds = [...new Set([...listIds, ...csvIds])];

  if (!caseIds.length) throw new Error('Provide --ids=1,2 or --csv=path.csv');

  const tagsToAdd = parseTagsInput(args.tag as string | undefined);
  const removeTag = args.removeTag as string | undefined;
  const replaceTags = String(args.replaceTags || 'false') === 'true';
  const dryRun = String(args.dryRun || 'false') === 'true';
  const automation = resolveAutomation(args);

  for (const id of caseIds) {
    let tagsPayload: string[] | undefined;

    if (replaceTags) {
      tagsPayload = tagsToAdd ?? [];
    } else if (tagsToAdd || removeTag) {
      const current = await getCase(PROJECT_CODE, id);
      const existing = current?.tags || [];
      tagsPayload = mergeTags(existing, tagsToAdd, removeTag);
    }

    const payload: Record<string, unknown> = {};
    if (automation !== undefined) payload.automation = automation;
    if (tagsPayload !== undefined) payload.tags = tagsPayload;

    if (!Object.keys(payload).length) {
      console.log(`(Skip) Case ${id}: no changes to apply`);
      continue;
    }

    try {
      await updateCase(id, payload, dryRun);
      console.log(`(OK) Case ${id} updated -> ${JSON.stringify(payload)}`);
    } catch (err: any) {
      const data = err?.response?.data;
      console.error(`(ERROR) Case ${id}`, data ?? err?.message ?? err);
      process.exitCode = 1;
    }
  }
}

main().catch(err => {
  console.error(err?.response?.data ?? err);
  process.exit(1);
});