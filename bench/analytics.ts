// Runs a large mixed sample through the pipeline and writes per-page rows
// plus aggregates — the numbers a presentation can quote. Feeds and random
// pages make part of the sample different on every run; the final URLs are
// recorded so any row can be reproduced.
//
// Usage: npm run analytics            → bench/analytics/{results.json,results.csv,summary.md}

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { sieve } from '../src/index.ts';
import type { Result } from '../src/types.ts';

const LIST = process.argv[2] ?? 'bench/analytics-pages.txt';
const OUT = 'bench/analytics';
await mkdir(OUT, { recursive: true });

interface Row {
  category: string;
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  lang: string;
  rawTokens: number;
  stateTokens: number;
  saved: number;
  chunks: number;
  blocks: number;
  facts: number;
  factsWithContext: number;
  dateFound: boolean;
  dateSource: string;
  anchorsWithId: number;
  bodyChars: number;
  stateChars: number;
  keptShare: number;
  warnings: string[];
  dropped: number;
  ms: number;
  glued: number;
  note?: string;
}

// --- Resolve the sample --------------------------------------------------------

const lines = (await readFile(LIST, 'utf8'))
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

const targets: { category: string; url: string }[] = [];
for (const line of lines) {
  const [category = 'misc', spec = '', count = '2'] = line.split('\t');
  if (spec.startsWith('rss:')) {
    const feed = spec.slice(4);
    try {
      const xml = await (await fetch(feed, { signal: AbortSignal.timeout(15_000), headers: { 'user-agent': 'codearia-sieve/0.0 analytics' } })).text();
      const links = [...xml.matchAll(/<item>[\s\S]*?<link>\s*(?:<!\[CDATA\[)?\s*(https?:[^\s<\]]+)/g)].map((m) => m[1]!);
      const picked = links.slice(0, Number(count));
      for (const url of picked) targets.push({ category, url });
      console.log(`feed ${feed} → ${picked.length} items`);
    } catch (e) {
      console.log(`feed ${feed} failed: ${(e as Error).message}`);
    }
  } else if (spec.startsWith('random-wiki:')) {
    // Special:Random is closed to crawlers by robots.txt; the REST API is not.
    const lang = spec.slice('random-wiki:'.length);
    for (let n = 0; n < Number(count); n++) {
      // Wikimedia rate-limits bursts on this endpoint ("You are making too many requests").
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/random/summary`, {
          signal: AbortSignal.timeout(15_000),
          headers: { 'user-agent': 'codearia-sieve/0.0 analytics (github.com/AntonG87/codearia-sieve)' },
        });
        const data = (await res.json()) as { content_urls?: { desktop?: { page?: string } } };
        const url = data.content_urls?.desktop?.page;
        if (url) targets.push({ category, url });
      } catch (e) {
        console.log(`random ${lang} failed: ${(e as Error).message}`);
      }
    }
  } else {
    targets.push({ category, url: spec });
  }
}
console.log(`\n${targets.length} pages to run\n`);

// --- Run ---------------------------------------------------------------------------

const GLUED = /\p{Ll}\p{Lu}|\p{L}\d{5,}|\d{5,}\p{L}/gu;
const rows: Row[] = [];

for (const [i, t] of targets.entries()) {
  const started = Date.now();
  let r: Result | undefined;
  let note: string | undefined;
  try {
    r = await sieve({ kind: 'url', url: t.url }, { trace: true });
  } catch (e) {
    note = `THREW: ${(e as Error).message}`;
  }
  const s = r?.state;
  const text = s?.chunks.map((c) => c.text).join('\n\n') ?? '';
  const stateChars = r?.usage.stateChars ?? 0;
  const bodyChars = r?.usage.visibleChars ?? 0;
  const row: Row = {
    category: t.category,
    url: t.url,
    finalUrl: r?.source.url ?? t.url,
    status: r?.source.status ?? 0,
    ok: !!r && r.source.status === 200 && (s?.chunks.length ?? 0) > 0 && !r.warnings.some((w) => ['blocked', 'fetch-failed', 'empty-without-js', 'no-main-content'].includes(w.code)),
    lang: s?.language ?? '',
    rawTokens: r?.usage.rawTokens ?? 0,
    stateTokens: r?.usage.stateTokens ?? 0,
    saved: r && r.usage.rawTokens ? 1 - r.usage.stateTokens / r.usage.rawTokens : 0,
    chunks: s?.chunks.length ?? 0,
    blocks: s?.chunks.reduce((n, c) => n + c.blocks.length, 0) ?? 0,
    facts: s?.facts.length ?? 0,
    factsWithContext: s?.facts.filter((f) => f.context).length ?? 0,
    dateFound: !!s?.publishedAt,
    dateSource: r?.trace?.dateSource ?? '',
    anchorsWithId: s?.chunks.filter((c) => c.anchor?.startsWith('#')).length ?? 0,
    bodyChars,
    stateChars,
    // Prose-only measure: a listing of links can have less "prose" than we returned.
    keptShare: bodyChars ? Math.min(1, stateChars / bodyChars) : 0,
    warnings: r?.warnings.map((w) => w.code) ?? [],
    dropped: r?.trace?.dropped.length ?? 0,
    ms: r?.usage.ms ?? Date.now() - started,
    glued: (text.match(GLUED) ?? []).length,
  };
  if (note) row.note = note;
  rows.push(row);
  const flag = row.ok ? 'ok ' : 'xx ';
  console.log(`${flag}${String(i + 1).padStart(2)}/${targets.length} ${t.category.padEnd(9)} ${row.rawTokens.toLocaleString().padStart(9)} → ${row.stateTokens.toLocaleString().padStart(7)} ${(row.saved * 100).toFixed(0).padStart(3)}%  ${row.dateFound ? 'date' : '    '} ${row.facts.toString().padStart(3)}f ${String(row.ms).padStart(5)}ms  ${row.warnings.join(',')}${note ? ' ' + note : ''}  ${t.url.slice(0, 60)}`);
}

// --- Aggregate ---------------------------------------------------------------------

const ok = rows.filter((r) => r.ok);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const byCategory = new Map<string, Row[]>();
for (const r of rows) byCategory.set(r.category, [...(byCategory.get(r.category) ?? []), r]);

const warningCounts = new Map<string, number>();
for (const r of rows) for (const w of r.warnings) warningCounts.set(w, (warningCounts.get(w) ?? 0) + 1);

const buckets = [
  ['≥ 99%', (s: number) => s >= 0.99],
  ['95–99%', (s: number) => s >= 0.95 && s < 0.99],
  ['90–95%', (s: number) => s >= 0.9 && s < 0.95],
  ['80–90%', (s: number) => s >= 0.8 && s < 0.9],
  ['< 80%', (s: number) => s < 0.8],
] as const;

const summary = `# Analytics run — ${new Date().toISOString().slice(0, 10)}

Pages attempted: ${rows.length}. Usable (200, content, no blocking warning): ${ok.length} (${pct(ok.length / rows.length)}).

## Token saving (usable pages)

| Statistic | Value |
|---|---|
| Mean saving | ${pct(mean(ok.map((r) => r.saved)))} |
| Median saving | ${pct(median(ok.map((r) => r.saved)))} |
| Raw tokens, total | ${ok.reduce((n, r) => n + r.rawTokens, 0).toLocaleString()} |
| State tokens, total | ${ok.reduce((n, r) => n + r.stateTokens, 0).toLocaleString()} |
| Raw tokens, median page | ${median(ok.map((r) => r.rawTokens)).toLocaleString()} |
| State tokens, median page | ${median(ok.map((r) => r.stateTokens)).toLocaleString()} |
| Time, median | ${median(ok.map((r) => r.ms)).toLocaleString()} ms |
| Time, p90 | ${[...ok.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(ok.length * 0.9)]?.toLocaleString()} ms |

Distribution of saving:

${buckets.map(([label, f]) => `- ${label}: ${ok.filter((r) => f(r.saved)).length}`).join('\n')}

## What the state contains

| Statistic | Value |
|---|---|
| Publication date found | ${ok.filter((r) => r.dateFound).length} / ${ok.length} (${pct(ok.filter((r) => r.dateFound).length / ok.length)}) |
| Date sources | ${[...ok.reduce((m, r) => m.set(r.dateSource || '—', (m.get(r.dateSource || '—') ?? 0) + 1), new Map<string, number>())].map(([k, v]) => `${k}: ${v}`).join(', ')} |
| Facts per page, mean | ${mean(ok.map((r) => r.facts)).toFixed(1)} |
| Pages with ≥ 1 fact | ${ok.filter((r) => r.facts > 0).length} / ${ok.length} |
| Chunks per page, mean | ${mean(ok.map((r) => r.chunks)).toFixed(2)} |
| Chunks anchored to a real #id | ${ok.reduce((n, r) => n + r.anchorsWithId, 0)} / ${ok.reduce((n, r) => n + r.chunks, 0)} |
| Languages seen | ${[...new Set(ok.map((r) => r.lang || '—'))].join(', ')} |

## By category

| Category | Pages | Usable | Mean saving | Date found | Facts/page |
|---|---|---|---|---|---|
${[...byCategory].map(([c, rs]) => {
  const u = rs.filter((r) => r.ok);
  return `| ${c} | ${rs.length} | ${u.length} | ${u.length ? pct(mean(u.map((r) => r.saved))) : '—'} | ${u.filter((r) => r.dateFound).length}/${u.length} | ${u.length ? mean(u.map((r) => r.facts)).toFixed(1) : '—'} |`;
}).join('\n')}

## Warnings across all pages

${[...warningCounts].sort((a, b) => b[1] - a[1]).map(([w, n]) => `- \`${w}\`: ${n}`).join('\n') || '- none'}

## Pages that were not usable

${rows.filter((r) => !r.ok).map((r) => `- ${r.url} — status ${r.status}, ${r.warnings.join(', ') || 'no warning'}${r.note ? `, ${r.note}` : ''}`).join('\n') || '- none'}

## Anomalies to look at

${rows.filter((r) => r.ok && (r.keptShare < 0.3 || r.chunks > 5)).map((r) => `- ${r.finalUrl.slice(0, 80)} — kept ${pct(r.keptShare)} of visible text, chunks ${r.chunks}${r.warnings.length ? `, ${r.warnings.join(', ')}` : ''}`).join('\n') || '- none'}
`;

await writeFile(`${OUT}/results.json`, JSON.stringify(rows, null, 1));
await writeFile(
  `${OUT}/results.csv`,
  ['category,url,finalUrl,status,ok,lang,rawTokens,stateTokens,saved,chunks,blocks,facts,dateFound,dateSource,anchorsWithId,keptShare,warnings,dropped,ms,glued']
    .concat(rows.map((r) => [r.category, r.url, r.finalUrl, r.status, r.ok, r.lang, r.rawTokens, r.stateTokens, r.saved.toFixed(4), r.chunks, r.blocks, r.facts, r.dateFound, r.dateSource, r.anchorsWithId, r.keptShare.toFixed(3), r.warnings.join('|'), r.dropped, r.ms, r.glued].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
    .join('\n'),
);
await writeFile(`${OUT}/summary.md`, summary);
console.log(`\n${summary}`);
