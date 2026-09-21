/**
 * Lab 6: long documents and the quality of the cut. Wikipedia's longest
 * articles, RFCs, a statute, a novel: does every chunk start where a reader
 * would start (a heading), does its anchor resolve to a real id on the page,
 * how often does a single block exceed the budget (block-split), and does
 * the chunk count match the size.
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/long-documents/run.ts
 */

import { servers, call, page, save, csv, BAD, pad, num, share } from '../lib.ts';

const DIR = 'bench/lab/long-documents';
const PAGES: Record<string, string> = {
  'wiki: World War II': 'https://en.wikipedia.org/wiki/World_War_II',
  'wiki: United States': 'https://en.wikipedia.org/wiki/United_States',
  'wiki: Вторая мировая': 'https://ru.wikipedia.org/wiki/%D0%92%D1%82%D0%BE%D1%80%D0%B0%D1%8F_%D0%BC%D0%B8%D1%80%D0%BE%D0%B2%D0%B0%D1%8F_%D0%B2%D0%BE%D0%B9%D0%BD%D0%B0',
  'rfc 9110 http': 'https://www.rfc-editor.org/rfc/rfc9110.html',
  'rfc 8259 json': 'https://www.rfc-editor.org/rfc/rfc8259.html',
  'html spec: parsing': 'https://html.spec.whatwg.org/multipage/parsing.html',
  'gutenberg: Pride': 'https://www.gutenberg.org/files/1342/1342-h/1342-h.htm',
  'w3c wcag 2.2': 'https://www.w3.org/TR/WCAG22/',
  'python tutorial': 'https://docs.python.org/3/tutorial/classes.html',
  'ecma-262 intro': 'https://tc39.es/ecma262/multipage/overview.html',
};

const { sieve, jev, close } = await servers();

console.log('== sieve_page ==');
const rows: any[] = [];
const chunkRows: any[] = [];
for (const [name, url] of Object.entries(PAGES)) {
  const r = await page(sieve, url, 'full');
  const chunks: any[] = r.state?.chunks ?? [];
  // A chunk that opens with a heading line (markdown heading or a short
  // capitalised line) starts where a reader would.
  const startsAtHeading = chunks.filter((c) => /^(#{1,6}\s|[^\n]{3,80}\n\n)/.test(c.text)).length;
  const withIdAnchor = chunks.filter((c) => typeof c.anchor === 'string' && c.anchor.startsWith('#')).length;
  const withAnyAnchor = chunks.filter((c) => c.anchor).length;
  const sizes = chunks.map((c) => c.tokens);
  const row = {
    name, ...r.row, chunkCount: chunks.length, startsAtHeading, withIdAnchor, withAnyAnchor,
    minTokens: sizes.length ? Math.min(...sizes) : 0, maxTokens: sizes.length ? Math.max(...sizes) : 0,
    fill: sizes.length ? sizes.reduce((s, t) => s + t, 0) / (sizes.length * 20000) : 0,
    split: String(r.row.warnings).includes('block-split'),
  };
  rows.push(row);
  for (const c of chunks) chunkRows.push({ page: name, id: c.id, tokens: c.tokens, chars: c.chars, anchor: c.anchor ?? '', blocks: c.blocks.length, head: c.text.slice(0, 60).replace(/\s+/g, ' ') });
  console.log(pad(name, 22), num(row.rawTokens, 8), '→', num(row.stateTokens, 7), 'chunks', num(row.chunkCount, 3), 'heading-start', num(startsAtHeading, 3), 'id-anchor', num(withIdAnchor, 3), 'any', num(withAnyAnchor, 3), 'max', num(row.maxTokens, 6), 'fill', (row.fill * 100).toFixed(0).padStart(3) + '%', pad(row.warnings || '-', 22));
}

// Jev: can a judge find the right chunk from anchors and heads alone? One
// question per document, answered with jev_find over chunk summaries — the
// summary-mode workflow, where chunk text is never sent.
console.log('\n== jev_find over chunk heads: which chunk answers? ==');
const QUESTIONS: Record<string, string> = {
  'wiki: World War II': 'the atomic bombings of Hiroshima and Nagasaki',
  'rfc 9110 http': 'the definition of the 404 Not Found status code',
  'gutenberg: Pride': "Mr. Darcy's first proposal to Elizabeth",
  'w3c wcag 2.2': 'the minimum contrast ratio for text',
  'html spec: parsing': 'the tokenization state for a comment',
};
for (const [name, q] of Object.entries(QUESTIONS)) {
  const candidates = chunkRows.filter((c) => c.page === name).map((c) => ({ id: c.id, text: `${c.anchor}\n${c.head}` }));
  if (!candidates.length) continue;
  const f = await call(jev, 'jev_find', { query: q, candidates, top_k: 3 });
  const top = (f.ranked ?? f.results ?? []).slice(0, 3).map((x: any) => `${x.id}(${(x.relevance ?? x.score ?? 0).toFixed(2)})`).join(' ');
  console.log(' ', pad(name, 22), pad(q, 48), top, f.exists === false ? 'exists:false' : '');
}

save(DIR, 'pages.json', rows);
save(DIR, 'pages.csv', csv(rows.map(({ error, ...r }) => r)));
save(DIR, 'chunks.csv', csv(chunkRows));
const ok = rows.filter((r) => !String(r.warnings).split('|').some((w) => BAD.has(w)));
const all = chunkRows.length;
console.log(`\n${ok.length}/${rows.length} usable; ${all} chunks; heading-start ${share(chunkRows, (c) => /^(#{1,6}\s|[^\n]{3,80}\n\n)/.test(c.head + '\n\n')).toFixed(2)}; id anchors ${chunkRows.filter((c) => c.anchor.startsWith('#')).length}/${all}; any anchor ${chunkRows.filter((c) => c.anchor).length}/${all}; block-split on ${rows.filter((r) => r.split).length} pages`);
await close();
