/**
 * A morning digest for one niche, built from thirty fresh pages without a
 * parser of your own and without a generative model reading any of them.
 *
 *   node --env-file=.env.local --experimental-strip-types examples/digest.ts [niche]
 *
 * Seven news feeds in five languages → codearia-sieve turns every article
 * into state → Jev screens each page for prompt injection, ranks all of them
 * against the niche and pulls the one number each top story rests on. What
 * comes out is a JSON file a writer (a person, Claude, anything) turns into
 * the digest — with a date, a language, an anchor and a token bill per story.
 */

import { writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const NICHE = process.argv[2] ?? 'artificial intelligence: models, agents, chips, regulation, and their effect on jobs and software';
const PER_FEED = 4;
const FEEDS = [
  'https://feeds.bbci.co.uk/news/rss.xml',
  'https://feeds.arstechnica.com/arstechnica/index',
  'https://www.theguardian.com/world/rss',
  'https://lenta.ru/rss',
  'https://www.spiegel.de/schlagzeilen/index.rss',
  'https://www.lemonde.fr/rss/une.xml',
  'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada',
];

type Content = { type: string; text?: string };
type ToolResult = { content?: Content[]; structuredContent?: unknown; isError?: boolean };

async function connect(name: string, command: string, args: string[]) {
  const transport = new StdioClientTransport({ command, args, env: process.env as Record<string, string>, stderr: 'pipe' });
  const client = new Client({ name: `example-${name}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content?.map((c) => c.text).join('\n')}`);
  return result.structuredContent ?? JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? '{}');
}

/** First N item links of an RSS or Atom feed; no XML library needed for this. */
async function feedLinks(feed: string, n: number): Promise<string[]> {
  const xml = await (await fetch(feed, { headers: { 'user-agent': 'codearia-sieve-example/0.1' } })).text();
  const links: string[] = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<link>\s*(?:<!\[CDATA\[)?([^<\]\s]+)[\s\S]*?<\/item>/g)) links.push(m[1]!);
  if (!links.length) for (const m of xml.matchAll(/<entry>[\s\S]*?<link[^>]*href="([^"]+)"/g)) links.push(m[1]!);
  return links.slice(0, n);
}

const sieve = await connect('sieve', 'node', ['dist/mcp/cli.js']);
const jev = await connect('jev', 'npx', ['-y', '@jkudish/jev-mcp']);

// 1. Fetch the feeds, then every article through sieve_page. Full mode: the
//    ranking needs a bounded excerpt of the text, the rest stays out.
const urls = (await Promise.all(FEEDS.map((f) => feedLinks(f, PER_FEED).catch(() => [])))).flat();
console.log(`${urls.length} articles from ${FEEDS.length} feeds\n`);

type Story = { id: string; url: string; title?: string; publishedAt?: string; language?: string; anchor?: string; excerpt: string; rawTokens: number; stateTokens: number; warnings: string[]; ms: number };
const stories: Story[] = [];
let rawTotal = 0;
let stateTotal = 0;
for (const [i, url] of urls.entries()) {
  const t0 = performance.now();
  try {
    const r = (await call(sieve, 'sieve_page', { url, mode: 'full' })) as any;
    const warnings = r.warnings.map((w: any) => w.code);
    const first = r.state.chunks[0];
    const excerpt = `${r.state.title ?? ''}\n\n${(first?.text ?? '').slice(0, 1800)}`;
    stories.push({ id: `s${i + 1}`, url, title: r.state.title, publishedAt: r.state.publishedAt, language: r.state.language, anchor: first?.anchor, excerpt, rawTokens: r.usage.rawTokens, stateTokens: r.usage.stateTokens, warnings, ms: Math.round(performance.now() - t0) });
    rawTotal += r.usage.rawTokens;
    stateTotal += r.usage.stateTokens;
    console.log(`s${i + 1}`.padEnd(4), String(r.usage.rawTokens).padStart(7), '→', String(r.usage.stateTokens).padStart(5), (r.state.language ?? '-').padEnd(6), (r.state.publishedAt ?? '-').padEnd(10), warnings.join(',').padEnd(16), (r.state.title ?? url).slice(0, 60));
  } catch (e) {
    console.log(`s${i + 1}`.padEnd(4), 'failed:', String(e).slice(0, 80));
  }
}
console.log(`\ntotal ${rawTotal} → ${stateTotal} tokens (${(100 - (100 * stateTotal) / rawTotal).toFixed(1)}% less)\n`);

// 2. Screen: a fetched page can carry instructions aimed at the agent that
//    reads it. Jev flags that before anyone reads the text.
const usable = stories.filter((s) => !s.warnings.some((w) => ['blocked', 'paywall', 'empty-without-js', 'robots-disallowed', 'fetch-failed'].includes(w)));
console.log(`== jev_screen: ${usable.length} pages ==`);
const screened: Record<string, any> = {};
for (const s of usable) {
  const r = (await call(jev, 'jev_screen', { text: s.excerpt, purpose: `Build a news digest about: ${NICHE}` })) as any;
  screened[s.id] = r;
  if (r.action && r.action !== 'allow' && r.action !== 'pass') console.log(`  ${s.id} ${r.action}: ${JSON.stringify(r).slice(0, 160)}`);
}
console.log('  done\n');

// 3. Rank every story against the niche in one call.
console.log('== jev_rerank ==');
const rank = (await call(jev, 'jev_rerank', {
  query: `News that matters for a reader following: ${NICHE}`,
  candidates: usable.map((s) => ({ id: s.id, text: s.excerpt })),
  top_k: 8,
})) as any;
const ranked: { id: string; score: number }[] = (rank.results ?? rank.ranked ?? []).map((r: any) => ({ id: r.id, score: r.score ?? r.relevance ?? r.probability ?? 0 }));
for (const r of ranked) {
  const s = stories.find((x) => x.id === r.id)!;
  console.log(`  ${String(r.score.toFixed(2)).padStart(5)}  ${s.id.padEnd(4)} ${(s.language ?? '-').padEnd(6)} ${(s.title ?? '').slice(0, 70)}`);
}

// 4. For the top stories, the one number each rests on, verbatim from the
//    text, with Jev choosing among regex matches.
console.log('\n== jev_extract: the key figure ==');
const top = ranked.slice(0, 5).map((r) => stories.find((s) => s.id === r.id)!);
const figures: Record<string, any> = {};
for (const s of top) {
  const r = (await call(jev, 'jev_extract', {
    document: s.excerpt,
    purpose: 'Find the single most important quantity this story reports.',
    fields: [{ id: 'key_figure', pattern: '\\d[\\d.,]*\\s?(?:%|percent|million|billion|thousand|млн|млрд|тыс|Mrd|Mio|millions?|milliards?|millones)?', description: 'The one number the story is about: a sum, a count, a percentage. Not a date, not a time of day.' }],
  })) as any;
  figures[s.id] = r.results?.[0];
  console.log(`  ${s.id.padEnd(4)} ${JSON.stringify(r.results?.[0]?.value)} (${r.results?.[0]?.status})  ${(s.title ?? '').slice(0, 60)}`);
}

const out = { niche: NICHE, at: new Date().toISOString(), tokens: { raw: rawTotal, state: stateTotal }, ranked: ranked.map((r) => ({ ...r, ...stories.find((s) => s.id === r.id), excerpt: undefined, figure: figures[r.id] })), screened: Object.fromEntries(Object.entries(screened).map(([k, v]) => [k, { action: v.action, probability: v.injection_probability ?? v.probability }])) };
writeFileSync('examples/digest.local.json', JSON.stringify(out, null, 2));
console.log('\nwritten examples/digest.local.json — hand it to the writer');

await sieve.close();
await jev.close();
