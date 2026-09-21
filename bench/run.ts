// Runs every saved page through the pipeline and prints the numbers that
// decide whether a change helped. Modelled on trafilatura's in-repo
// evaluation: no fixtures, no claims.
//
// Usage: npm run bench            (test/fixtures + bench/pages)
//        npm run bench -- --json  (machine-readable)

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sieve } from '../src/index.ts';

const DIRS = ['test/fixtures', 'bench/pages'];
const asJson = process.argv.includes('--json');
const NOW = () => new Date('2026-01-01T00:00:00Z');

interface Row {
  file: string;
  rawTokens: number;
  stateTokens: number;
  saved: number;
  chunks: number;
  publishedAt?: string;
  warnings: string[];
  ms: number;
}

const rows: Row[] = [];
for (const dir of DIRS) {
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.html')).sort();
  } catch {
    continue;
  }
  for (const file of files) {
    const html = await readFile(join(dir, file), 'utf8');
    // bench/fetch.ts writes the source URL on the first line.
    const source = /^<!-- source: (\S+) -->/.exec(html)?.[1];
    const r = await sieve({ kind: 'html', html, url: source ?? `https://bench.local/${file}` }, { now: NOW });
    const row: Row = {
      file: join(dir, file),
      rawTokens: r.usage.rawTokens,
      stateTokens: r.usage.stateTokens,
      saved: r.usage.rawTokens ? 1 - r.usage.stateTokens / r.usage.rawTokens : 0,
      chunks: r.usage.chunks,
      warnings: r.warnings.map((w) => w.code),
      ms: r.usage.ms,
    };
    if (r.state.publishedAt) row.publishedAt = r.state.publishedAt;
    rows.push(row);
  }
}

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const pad = (s: string | number, n: number) => String(s).padStart(n);
  console.log(`${'page'.padEnd(34)} ${pad('raw', 8)} ${pad('state', 7)} ${pad('saved', 6)} ${pad('chunks', 6)}  date        warnings`);
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(34)} ${pad(r.rawTokens, 8)} ${pad(r.stateTokens, 7)} ${pad(`${(r.saved * 100).toFixed(0)}%`, 6)} ${pad(r.chunks, 6)}  ${(r.publishedAt ?? '—').padEnd(10)}  ${r.warnings.join(',') || '—'}`,
    );
  }
  const withDate = rows.filter((r) => r.publishedAt).length;
  const meanSaved = rows.length ? rows.reduce((s, r) => s + r.saved, 0) / rows.length : 0;
  console.log(`\npages: ${rows.length}   date found: ${withDate}/${rows.length}   mean saving: ${(meanSaved * 100).toFixed(1)}%`);
}
