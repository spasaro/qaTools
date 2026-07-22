/**
 * get-suite-ids.ts
 *
 * Fetches cases from a suite and displays:
 *  - by default: "id - title | automation=<num> | tags=a,b,c"
 *  - with --onlyIds: only the IDs
 *  - with --toCsv=path.csv: exports a CSV with columns id,title,automation,tags
 *
 * Usage:
 *   npm run get:ids -- --suite=104
 *   npm run get:ids -- --suite=104 --onlyIds
 *   npm run get:ids -- --suite=104 --toCsv=output/cases.csv
 *   npm run get:ids -- --suite=104 --limit=200
 *   npm run get:ids -- --suite=104 --project=TC
 *   npm run get:ids -- --suite=104 --debug
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

function getNumberArg(v: unknown, def: number): number {
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return def;
}

function normalizeTag(t: any): string {
  if (t == null) return '';
  if (typeof t === 'string') return t.trim();
  return String(t.title ?? t.name ?? t.value ?? '').trim();
}

async function main() {
  const suiteId = Number(args.suite);
  if (!suiteId) throw new Error('Missing --suite=<suite_id>');

  const project = (args.project as string) || ENV_PROJECT;
  if (!project) throw new Error('Missing project: define QASE_PROJECT_CODE in .env or pass --project=CODE');

  const limit = getNumberArg(args.limit, 100);
  let offset = getNumberArg(args.offset, 0);
  const onlyIds = String(args.onlyIds || 'false') === 'true';
  const toCsv = (args.toCsv as string) || '';
  const debug = String(args.debug || 'false') === 'true';

  type Row = { id: number; title: string; automation: number | null; tags: string[] };
  const rows: Row[] = [];
  let page = 0;
  const MAX_PAGES = 1000;

  while (true) {
    page++;
    if (page > MAX_PAGES) {
      throw new Error(`Too many pages (>${MAX_PAGES}). Stopping to avoid infinite loop. offset=${offset}`);
    }

    if (debug) console.log(`[DEBUG] GET /case/${project}?suite_id=${suiteId}&limit=${limit}&offset=${offset}`);

    const { data } = await qase.get(`/case/${project}`, {
      params: { suite_id: suiteId, limit, offset }
    });

    const result = data?.result ?? {};
    const entities: any[] = Array.isArray(result.entities) ? result.entities : [];
    const count: number = typeof result.count === 'number' ? result.count : entities.length;
    const total: number = typeof result.total === 'number' ? result.total : offset + count;

    if (debug) console.log(`[DEBUG] page=${page} count=${count} total=${total} rowsSoFar=${rows.length}`);

    if (count === 0 || entities.length === 0) break;

    for (const e of entities) {
      const id = Number(e.id);
      const title = String(e.title ?? '');
      const automation = typeof e.automation === 'number' ? e.automation : null;

      const rawTags = Array.isArray(e.tags) ? e.tags : [];
      const tags: string[] = rawTags.map(normalizeTag).filter(Boolean);

      rows.push({ id, title, automation, tags });
    }

    if (offset + count >= total) break;

    offset += count;
  }

  if (onlyIds) {
    for (const r of rows) console.log(r.id);
  } else {
    for (const r of rows) {
      const tagsStr = r.tags.join(', ');
      console.log(`${r.id} - ${r.title} | automation=${r.automation ?? ''} | tags=${tagsStr}`);
    }
  }

  if (toCsv) {
    const fullPath = path.resolve(toCsv);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    const header = 'id,title,automation,tags';
    const body = rows
      .map(r => {
        const titleEsc = String(r.title ?? '').replace(/"/g, '""').trim();
        const tagsEsc = r.tags.join(', ').replace(/"/g, '""').trim();
        const automationStr = (r.automation ?? '').toString();
        return `${r.id},"${titleEsc}",${automationStr},"${tagsEsc}"`;
      })
      .join('\n');
    fs.writeFileSync(fullPath, `${header}\n${body}\n`, 'utf-8');
    console.log(`\nCSV saved to: ${fullPath}`);
  }

  if (debug) console.log(`[DEBUG] Total rows: ${rows.length}`);
}

main().catch(err => {
  console.error(err?.response?.data ?? err?.message ?? err);
  process.exit(1);
});