/**
 * Lab 2: competitor product pages for one search query, the way an SEO
 * agency would audit them.
 *
 * Ten standing-desk product pages → sieve_page → what the page states (title,
 * H1, price facts, dates, structure) → Jev: which page answers the query best
 * (jev_rerank) and the price and the warranty read verbatim (jev_extract).
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/seo-competitors/run.ts
 */

import { servers, call, page, save, csv, BAD, pad, num } from '../lib.ts';

const DIR = 'bench/lab/seo-competitors';
const QUERY = 'electric standing desk for a home office, sturdy, under $700, with a warranty';
const PAGES: Record<string, string> = {
  uplift: 'https://www.upliftdesk.com/uplift-v2-standing-desk/',
  flexispot: 'https://www.flexispot.com/e7-pro-standing-desk',
  ikea: 'https://www.ikea.com/us/en/p/trotten-desk-sit-stand-white-s99429578/',
  autonomous: 'https://www.autonomous.ai/standing-desks/smartdesk-2-home',
  hermanmiller: 'https://www.hermanmiller.com/products/tables/sit-to-stand-tables/motia-sit-to-stand-table/',
  secretlab: 'https://secretlab.co/products/magnus-pro',
  branch: 'https://www.branchfurniture.com/products/standing-desk',
  vari: 'https://www.vari.com/electric-standing-desk-60x30/',
  desky: 'https://desky.com/products/desky-dual-sit-stand-desk',
  ergonofis: 'https://www.ergonofis.com/products/sway-standing-desk',
};

const { sieve, jev, close } = await servers();

console.log('== sieve_page ==');
const rows: any[] = [];
const texts: Record<string, string> = {};
for (const [vendor, url] of Object.entries(PAGES)) {
  const p = await page(sieve, url, 'markdown');
  const md = p.text;
  const h1 = (md.match(/^#\s+(.+)$/m) ?? [])[1]?.trim();
  const priceFacts = (p.state?.facts ?? []).filter((f: any) => /^USD/.test(f.unit ?? ''));
  const row = {
    vendor, ...p.row, h1, h1MatchesTitle: !!h1 && !!p.row.title && p.row.title.toLowerCase().includes(h1.toLowerCase().slice(0, 20)),
    priceFacts: priceFacts.length, prices: priceFacts.slice(0, 6).map((f: any) => f.value).join(' '),
    warningDetail: p.warnings.map((w) => w.detail ?? '').join(' | ').slice(0, 80),
  };
  rows.push(row);
  texts[vendor] = md;
  console.log(pad(vendor, 13), num(row.rawTokens, 7), '→', num(row.stateTokens, 5), pad(row.warnings || '-', 16), 'h1:', pad(h1, 34), 'prices:', pad(row.prices, 24), pad(row.title, 40));
}

const usable = rows.filter((r) => !String(r.warnings).split('|').some((w) => BAD.has(w)) && texts[r.vendor]);

console.log('\n== jev_rerank: who answers the query ==');
const rank = await call(jev, 'jev_rerank', {
  query: QUERY,
  candidates: usable.map((r) => ({ id: r.vendor, text: `${r.title ?? ''}\n\n${texts[r.vendor]!.slice(0, 1900)}` })),
});
for (const r of rank.ranked ?? []) {
  const row = rows.find((x) => x.vendor === r.id);
  if (row) row.relevance = r.relevance;
  console.log(' ', num(r.relevance?.toFixed(2), 5), pad(r.id, 13));
}

console.log('\n== jev_extract: price and warranty, verbatim ==');
for (const r of usable) {
  const x = await call(jev, 'jev_extract', {
    document: texts[r.vendor]!.slice(0, 50000),
    purpose: 'Product page audit: the price of the desk as sold on this page and the warranty it promises.',
    fields: [
      { id: 'price', pattern: '(?:\\$|USD\\s?)\\s?\\d[\\d,]*(?:\\.\\d\\d)?', description: 'The current selling price of the desk itself, not a monthly instalment, not a strike-through old price, not an accessory.' },
      { id: 'warranty', pattern: '\\d{1,2}[- ]?(?:year|yr|years)', description: 'The warranty length promised for the desk or its frame.' },
    ],
  });
  const got = Object.fromEntries((x.results ?? []).map((f: any) => [f.id, f]));
  r.jevPrice = got.price?.value ?? null; r.jevPriceStatus = got.price?.status;
  r.jevWarranty = got.warranty?.value ?? null; r.jevWarrantyStatus = got.warranty?.status;
  console.log(' ', pad(r.vendor, 13), 'price', pad(r.jevPrice, 10), pad(r.jevPriceStatus, 10), 'warranty', pad(r.jevWarranty, 10), pad(r.jevWarrantyStatus, 10), '| sieve prices:', r.prices || '-');
}

save(DIR, 'pages.json', rows);
save(DIR, 'pages.csv', csv(rows.map(({ error, warningDetail, ...r }) => r)));
console.log(`\n${usable.length}/${rows.length} usable; raw ${rows.reduce((s, r) => s + r.rawTokens, 0)} → state ${rows.reduce((s, r) => s + r.stateTokens, 0)} tokens`);
await close();
