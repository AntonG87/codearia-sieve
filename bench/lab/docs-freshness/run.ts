/**
 * Lab 3: documentation freshness across twelve framework and platform doc
 * pages. What the markup says (publishedAt / updatedAt and their tier), what
 * the text says ("Last updated …"), and how many pages are client-rendered.
 * Jev reads the date stated in the text so the two can be compared.
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/docs-freshness/run.ts
 */

import { servers, call, page, save, csv, BAD, pad, num } from '../lib.ts';

const DIR = 'bench/lab/docs-freshness';
const PAGES: Record<string, string> = {
  'react': 'https://react.dev/reference/react/useEffect',
  'vue': 'https://vuejs.org/guide/essentials/reactivity-fundamentals.html',
  'svelte': 'https://svelte.dev/docs/svelte/$state',
  'nextjs': 'https://nextjs.org/docs/app/building-your-application/routing',
  'astro': 'https://docs.astro.build/en/basics/astro-components/',
  'node': 'https://nodejs.org/api/fs.html',
  'mdn': 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch',
  'wordpress': 'https://developer.wordpress.org/reference/functions/get_posts/',
  'php': 'https://www.php.net/manual/en/function.array-map.php',
  'python': 'https://docs.python.org/3/library/asyncio.html',
  'postgres': 'https://www.postgresql.org/docs/current/sql-select.html',
  'tailwind': 'https://tailwindcss.com/docs/responsive-design',
  'typescript': 'https://www.typescriptlang.org/docs/handbook/2/generics.html',
  'stripe': 'https://docs.stripe.com/api/charges',
  'cloudflare': 'https://developers.cloudflare.com/workers/runtime-apis/fetch/',
};

const { sieve, jev, close } = await servers();

console.log('== sieve_page ==');
const rows: any[] = [];
const texts: Record<string, string> = {};
for (const [name, url] of Object.entries(PAGES)) {
  const p = await page(sieve, url, 'markdown');
  texts[name] = p.text;
  const stated = (p.text.match(/(?:last (?:updated|modified)|updated on|updated)[:\s]+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Za-z]+\s+\d{4})/i) ?? [])[1];
  const row = { name, ...p.row, statedInText: stated, empty: String(p.row.warnings).includes('empty-without-js') };
  rows.push(row);
  console.log(pad(name, 11), num(row.rawTokens, 7), '→', num(row.stateTokens, 5), 'pub', pad(row.publishedAt, 10), 'upd', pad(row.updatedAt, 10), pad(row.dateSource, 8), 'text:', pad(stated, 18), pad(row.warnings || '-', 18), `h${row.headings} c${row.codeBlocks}`);
}

console.log('\n== jev_extract: the date the page states ==');
for (const r of rows) {
  if (String(r.warnings).split('|').some((w) => BAD.has(w))) continue;
  const x = await call(jev, 'jev_extract', {
    document: texts[r.name]!.slice(0, 50000),
    purpose: 'Documentation freshness audit.',
    fields: [{ id: 'updated', pattern: '(?:[A-Z][a-z]+\\.? \\d{1,2},? \\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2} [A-Z][a-z]+ \\d{4})', description: 'The date this documentation page says it was last updated or published. Not a release date of a version mentioned in the body, not a copyright year.' }],
  });
  const f = x.results?.[0];
  r.jevUpdated = f?.value ?? null; r.jevStatus = f?.status;
  console.log(' ', pad(r.name, 11), 'markup', pad(r.updatedAt ?? r.publishedAt, 10), 'jev', pad(r.jevUpdated, 20), pad(r.jevStatus, 10));
}

save(DIR, 'pages.json', rows);
save(DIR, 'pages.csv', csv(rows));
const ok = rows.filter((r) => !String(r.warnings).split('|').some((w) => BAD.has(w)));
console.log(`\n${ok.length}/${rows.length} usable; dated by markup ${rows.filter((r) => r.publishedAt || r.updatedAt).length}; client-rendered ${rows.filter((r) => r.empty).length}; raw ${rows.reduce((s, r) => s + r.rawTokens, 0)} → state ${rows.reduce((s, r) => s + r.stateTokens, 0)}`);
await close();
