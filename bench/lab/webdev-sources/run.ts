/**
 * Lab scenario: rate ten web-development news sources.
 *
 * Five fresh articles per source go through the sieve MCP server exactly as an
 * agent would call it; Jev ranks them against the niche and classifies the
 * article type; the rules in rules.json turn the measurements into one score
 * per source. Output is JSON + CSV a Java job can consume unchanged.
 *
 *   node --env-file=.env.local --experimental-strip-types bench/lab/webdev-sources/run.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const DIR = 'bench/lab/webdev-sources';
const rules = JSON.parse(readFileSync(`${DIR}/rules.json`, 'utf8'));
const NOW = new Date();

const SOURCES: Record<string, string> = {
  'smashingmagazine.com': 'https://www.smashingmagazine.com/feed/',
  'css-tricks.com': 'https://css-tricks.com/feed/',
  'web.dev': 'https://web.dev/static/blog/feed.xml',
  'developer.chrome.com': 'https://developer.chrome.com/static/blog/feed.xml',
  'developer.mozilla.org': 'https://developer.mozilla.org/en-US/blog/rss.xml',
  'freecodecamp.org': 'https://www.freecodecamp.org/news/rss/',
  'blog.logrocket.com': 'https://blog.logrocket.com/feed/',
  'dev.to': 'https://dev.to/feed',
  'sitepoint.com': 'https://www.sitepoint.com/feed/',
  'habr.com/webdev': 'https://habr.com/ru/rss/hub/webdev/all/?fl=ru',
};

type Content = { type: string; text?: string };
type ToolResult = { content?: Content[]; structuredContent?: unknown; isError?: boolean };

async function connect(name: string, command: string, args: string[]) {
  const transport = new StdioClientTransport({ command, args, env: process.env as Record<string, string>, stderr: 'pipe' });
  const client = new Client({ name: `lab-${name}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content?.map((c) => c.text).join('\n')}`);
  return result.structuredContent ?? JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? '{}');
}

async function feedLinks(feed: string, n: number): Promise<string[]> {
  const xml = await (await fetch(feed, { headers: { 'user-agent': 'codearia-sieve-lab/0.1' } })).text();
  const links: string[] = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<link>\s*(?:<!\[CDATA\[)?([^<\]\s]+)[\s\S]*?<\/item>/g)) links.push(m[1]!);
  if (!links.length) for (const m of xml.matchAll(/<entry>[\s\S]*?<link[^>]*href="([^"]+)"/g)) links.push(m[1]!);
  // Feeds escape the ampersand inside <link>; decode before the URL is used.
  return links.slice(0, n).map((l) => l.replace(/&amp;/g, '&'));
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lin = (x: number, zero: number, full: number) => clamp01((x - zero) / (full - zero));

interface Article {
  source: string; url: string; title?: string; publishedAt?: string; ageDays?: number; language?: string;
  rawTokens: number; stateTokens: number; visibleChars: number; stateChars: number; chunks: number; facts: number;
  headings: number; codeBlocks: number; warnings: string[]; ms: number; excerpt: string;
  relevance?: number; type?: string; typeConfidence?: number; typeDecision?: string;
}

const sieve = await connect('sieve', 'node', ['dist/mcp/cli.js']);
const jev = await connect('jev', 'npx', ['-y', '@jkudish/jev-mcp']);

// 1. Every article through the sieve server, markdown mode: the state plus
//    the markdown, so structure (headings, code) can be counted too.
const articles: Article[] = [];
for (const [source, feed] of Object.entries(SOURCES)) {
  let links: string[] = [];
  try { links = await feedLinks(feed, rules.articlesPerSource); } catch (e) { console.log(`${source}: feed failed ${String(e).slice(0, 80)}`); }
  if (!links.length) console.log(`${source}: no items parsed from the feed`);
  for (const url of links) {
    const t0 = performance.now();
    try {
      const r = (await call(sieve, 'sieve_page', { url, mode: 'markdown' })) as any;
      const md: string = r.markdown ?? '';
      const first = r.state.chunks[0];
      const a: Article = {
        source, url, title: r.state.title, publishedAt: r.state.publishedAt, language: r.state.language,
        rawTokens: r.usage.rawTokens, stateTokens: r.usage.stateTokens, visibleChars: r.usage.visibleChars, stateChars: r.usage.stateChars,
        chunks: r.state.chunks.length, facts: r.state.facts.length,
        headings: (md.match(/^#{1,6}\s/gm) ?? []).length, codeBlocks: (md.match(/^```/gm) ?? []).length / 2,
        warnings: r.warnings.map((w: any) => w.code), ms: Math.round(performance.now() - t0),
        excerpt: `${r.state.title ?? ''}\n\n${md.slice(0, 1800)}`,
      };
      if (a.publishedAt) a.ageDays = Math.round((NOW.getTime() - new Date(a.publishedAt).getTime()) / 86400000);
      articles.push(a);
      console.log(source.padEnd(22), String(a.rawTokens).padStart(7), '→', String(a.stateTokens).padStart(5), (a.publishedAt ?? '-').padEnd(10), String(a.ageDays ?? '-').padStart(4) + 'd', `h${a.headings} c${a.codeBlocks}`.padEnd(7), (a.warnings.join(',') || '-').padEnd(18), (a.title ?? url).slice(0, 50));
    } catch (e) {
      console.log(source.padEnd(22), 'FAILED', url, String(e).slice(0, 100));
      articles.push({ source, url, rawTokens: 0, stateTokens: 0, visibleChars: 0, stateChars: 0, chunks: 0, facts: 0, headings: 0, codeBlocks: 0, warnings: ['tool-error'], ms: Math.round(performance.now() - t0), excerpt: '' });
    }
  }
}

// 2. Jev: relevance to the niche (all at once) and article type (batches of 64).
const BAD = new Set(['blocked', 'paywall', 'empty-without-js', 'robots-disallowed', 'fetch-failed', 'tool-error']);
const usable = articles.filter((a) => !a.warnings.some((w) => BAD.has(w)) && a.excerpt);
const ids = new Map(usable.map((a, i) => [`a${i}`, a]));

const rank = (await call(jev, 'jev_rerank', {
  query: `Articles a working web developer should read about: ${rules.niche}`,
  candidates: [...ids].map(([id, a]) => ({ id, text: a.excerpt })),
})) as any;
for (const r of rank.ranked ?? []) { const a = ids.get(r.id); if (a) a.relevance = r.relevance ?? 0; }

const entries = [...ids];
for (let i = 0; i < entries.length; i += 64) {
  const batch = entries.slice(i, i + 64);
  const cls = (await call(jev, 'jev_classify', {
    purpose: 'Classify web-development articles by type to judge how substantive a source is.',
    items: batch.map(([id, a]) => ({ id, text: a.excerpt })),
    classes: rules.classes,
  })) as any;
  for (const r of cls.results ?? []) { const a = ids.get(r.id); if (a) { a.type = r.classification; a.typeConfidence = r.confidence; a.typeDecision = r.decision; } }
}

// 3. Rules → one score per source.
const SUBSTANTIVE = new Set(['tutorial', 'news', 'analysis']);
const scores = Object.keys(SOURCES).map((source) => {
  const all = articles.filter((a) => a.source === source);
  const ok = all.filter((a) => !a.warnings.some((w) => BAD.has(w)));
  const share = (xs: any[], f: (a: any) => boolean) => (xs.length ? xs.filter(f).length / xs.length : 0);
  const m = {
    reachable: share(all, (a) => !a.warnings.some((w) => BAD.has(w))),
    dated: share(ok, (a) => !!a.publishedAt),
    fresh: median(ok.filter((a) => a.ageDays !== undefined).map((a) => a.ageDays!)),
    depth: median(ok.map((a) => a.stateTokens)),
    structured: median(ok.map((a) => a.headings + a.codeBlocks)),
    relevant: ok.length ? ok.reduce((s, a) => s + (a.relevance ?? 0), 0) / ok.length : 0,
    substantive: share(ok.filter((a) => a.type), (a) => SUBSTANTIVE.has(a.type)),
  };
  const pts = {
    reachable: m.reachable,
    dated: m.dated,
    fresh: Number.isNaN(m.fresh) ? 0 : 1 - lin(m.fresh, 7, 60),
    depth: Number.isNaN(m.depth) ? 0 : m.depth < 800 ? lin(m.depth, 200, 800) : m.depth <= 8000 ? 1 : 1 - lin(m.depth, 8000, 20000),
    structured: Number.isNaN(m.structured) ? 0 : lin(m.structured, 0, 6),
    relevant: m.relevant,
    substantive: m.substantive,
  };
  const score = rules.rules.reduce((s: number, r: any) => s + r.weight * (pts as any)[r.id], 0);
  return { source, articles: all.length, usable: ok.length, score: Math.round(score), measures: m, points: pts };
}).sort((a, b) => b.score - a.score);

// 4. Write everything down.
mkdirSync(`${DIR}/results`, { recursive: true });
writeFileSync(`${DIR}/results/articles.json`, JSON.stringify(articles.map(({ excerpt, ...a }) => a), null, 2));
writeFileSync(`${DIR}/results/sources.json`, JSON.stringify({ at: NOW.toISOString(), rules: rules.rules, scores }, null, 2));
const csv = ['source,score,articles,usable,reachable,dated,fresh_days,depth_tokens,structured,relevant,substantive',
  ...scores.map((s) => [s.source, s.score, s.articles, s.usable, s.measures.reachable.toFixed(2), s.measures.dated.toFixed(2), s.measures.fresh, s.measures.depth, s.measures.structured, s.measures.relevant.toFixed(2), s.measures.substantive.toFixed(2)].join(','))].join('\n');
writeFileSync(`${DIR}/results/sources.csv`, csv + '\n');

console.log('\n== sources ==');
console.log(csv);
console.log('\n== article types ==');
for (const a of usable) console.log(`${a.source.padEnd(22)} ${String(a.relevance?.toFixed(2)).padStart(5)} ${(a.type ?? '-').padEnd(10)} ${(a.typeDecision ?? '').padEnd(7)} ${(a.title ?? '').slice(0, 60)}`);
console.log(`\ntotal raw ${articles.reduce((s, a) => s + a.rawTokens, 0)} → state ${articles.reduce((s, a) => s + a.stateTokens, 0)} tokens; ${usable.length}/${articles.length} usable`);

await sieve.close();
await jev.close();
