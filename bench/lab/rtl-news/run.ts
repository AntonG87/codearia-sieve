/**
 * Lab 4: right-to-left news. Hebrew and Arabic articles from six feeds:
 * are dates found, is the language detected, do numbers with Hebrew and
 * Arabic units become facts, and does the text come out in reading order.
 * Jev classifies each story's topic, so the whole chain is exercised in RTL.
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/rtl-news/run.ts
 */

import { servers, call, page, feedLinks, save, csv, BAD, pad, num, share } from '../lib.ts';

const DIR = 'bench/lab/rtl-news';
const FEEDS: Record<string, string> = {
  'ynet.co.il': 'https://www.ynet.co.il/Integration/StoryRss2.xml',
  'haaretz.co.il': 'https://www.haaretz.co.il/srv/rss---feedly',
  'walla.co.il': 'https://rss.walla.co.il/feed/1',
  'globes.co.il': 'https://www.globes.co.il/webservice/rss/rssfeeder.asmx/FeederNode?iID=2',
  'aljazeera.net': 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9',
  'bbc.com/arabic': 'https://feeds.bbci.co.uk/arabic/rss.xml',
  'aawsat.com': 'https://aawsat.com/feed',
};
const PER_FEED = 4;
const CLASSES = [
  { id: 'politics', description: 'Government, elections, parliament, diplomacy, parties.' },
  { id: 'security', description: 'War, military operations, attacks, hostages, police.' },
  { id: 'economy', description: 'Markets, prices, companies, budgets, employment, real estate.' },
  { id: 'society', description: 'Health, education, crime, weather, culture, sport, daily life.' },
  { id: 'tech', description: 'Technology companies, products, science, AI.' },
];

const { sieve, jev, close } = await servers();

console.log('== sieve_page ==');
const rows: any[] = [];
const texts: Record<string, string> = {};
let i = 0;
for (const [source, feed] of Object.entries(FEEDS)) {
  let links: string[] = [];
  try { links = await feedLinks(feed, PER_FEED); } catch (e) { console.log(`${source}: feed failed ${String(e).slice(0, 60)}`); }
  if (!links.length) console.log(`${source}: no items`);
  for (const url of links) {
    const id = `r${++i}`;
    const p = await page(sieve, url, 'full');
    const text = p.text;
    const rtlChars = (text.match(/[֐-׿؀-ۿ]/g) ?? []).length;
    const latinChars = (text.match(/[A-Za-z]/g) ?? []).length;
    const row = {
      id, source, ...p.row, rtlShare: text.length ? rtlChars / (rtlChars + latinChars || 1) : 0,
      factUnits: (p.state?.facts ?? []).map((f: any) => f.unit).filter(Boolean).slice(0, 8).join(' '),
      facts: p.state?.facts?.length ?? 0,
    };
    rows.push(row);
    texts[id] = `${p.state?.title ?? ''}\n\n${text.slice(0, 1800)}`;
    console.log(pad(source, 15), num(row.rawTokens, 7), '→', num(row.stateTokens, 5), pad(row.language, 5), pad(row.publishedAt, 10), pad(row.dateSource, 7), 'rtl', (row.rtlShare * 100).toFixed(0).padStart(3) + '%', 'facts', num(row.facts, 2), pad(row.warnings || '-', 16), pad(row.title, 40));
  }
}

const usable = rows.filter((r) => !String(r.warnings).split('|').some((w) => BAD.has(w)) && texts[r.id]?.length > 100);

console.log('\n== jev_classify: topic ==');
for (let k = 0; k < usable.length; k += 64) {
  const batch = usable.slice(k, k + 64);
  const cls = await call(jev, 'jev_classify', {
    purpose: 'Route news stories by topic. Stories are in Hebrew or Arabic.',
    items: batch.map((r) => ({ id: r.id, text: texts[r.id]! })),
    classes: CLASSES,
  });
  for (const c of cls.results ?? []) { const r = rows.find((x) => x.id === c.id); if (r) { r.topic = c.classification; r.topicDecision = c.decision; r.topicConfidence = c.confidence; } }
}
for (const r of usable) console.log(' ', pad(r.source, 15), pad(r.topic, 9), pad(r.topicDecision, 7), pad(r.title, 60));

// A sample of facts, to eyeball units in Hebrew and Arabic.
console.log('\n== facts sample ==');
for (const r of usable.slice(0, 40)) if (r.facts) console.log(' ', pad(r.source, 15), r.factUnits);

save(DIR, 'pages.json', rows);
save(DIR, 'pages.csv', csv(rows));
console.log(`\n${usable.length}/${rows.length} usable; dated ${rows.filter((r) => r.publishedAt).length}/${rows.length}; language detected ${rows.filter((r) => r.language).length}; he ${rows.filter((r) => String(r.language).startsWith('he')).length}, ar ${rows.filter((r) => String(r.language).startsWith('ar')).length}; topic auto ${share(usable, (r) => r.topicDecision === 'auto').toFixed(2)}; raw ${rows.reduce((s, r) => s + r.rawTokens, 0)} → state ${rows.reduce((s, r) => s + r.stateTokens, 0)}`);
await close();
