/**
 * The chain from the README, end to end: codearia-sieve prepares pages,
 * Jev (through jev-mcp) judges them. Both run as MCP servers and are driven
 * with the official client, exactly the way an agent would call them.
 *
 *   node --env-file=.env.local --experimental-strip-types examples/jev.ts
 *
 * Needs TYPESAFE_API_KEY for jev-mcp and a built dist/ for the sieve server.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const PAGES = [
  'https://docs.typesafe.ai/models',
  'https://developer.mozilla.org/en-US/docs/Web/API/fetch',
  'https://en.wikipedia.org/wiki/Web_scraping',
  'https://nodejs.org/en/blog/release/v22.14.0',
  'https://ru.wikipedia.org/wiki/%D0%9F%D0%B0%D1%80%D1%81%D0%B8%D0%BD%D0%B3',
  'https://vercel.com/pricing',
];

const CLASSES = [
  { id: 'docs', description: 'Reference or tutorial documentation for a programming API, language or library. Not: release announcements.' },
  { id: 'release', description: 'A release note or changelog announcing a specific software version, with a version number and a list of changes.' },
  { id: 'encyclopedia', description: 'A general encyclopedia article about a topic, neutral tone, with history and definitions. Wikipedia-style.' },
  { id: 'pricing', description: 'A page whose main content is prices, plans or rate cards for a product or service.' },
  { id: 'news', description: 'A journalistic news story about a recent event.' },
];

type Content = { type: string; text?: string };
type ToolResult = { content?: Content[]; structuredContent?: unknown; isError?: boolean };

async function connect(name: string, command: string, args: string[], env: Record<string, string> = {}) {
  const transport = new StdioClientTransport({ command, args, env: { ...(process.env as Record<string, string>), ...env }, stderr: 'pipe' });
  const client = new Client({ name: `example-${name}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content?.map((c) => c.text).join('\n')}`);
  return result.structuredContent ?? JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? '{}');
}

const ms = (t0: number) => `${Math.round(performance.now() - t0)} ms`;

const sieve = await connect('sieve', 'node', ['dist/mcp/cli.js']);
const jev = await connect('jev', 'npx', ['-y', '@jkudish/jev-mcp']);

// 1. Sieve: every page becomes state. Full mode so we have chunk text to judge.
console.log('\n== 1. sieve_page ==');
const pages: { url: string; state: any; usage: any; warnings: any[] }[] = [];
for (const url of PAGES) {
  const t0 = performance.now();
  const r = (await call(sieve, 'sieve_page', { url, mode: 'full' })) as any;
  pages.push({ url, state: r.state, usage: r.usage, warnings: r.warnings });
  const w = r.warnings.map((x: any) => x.code).join(',') || '-';
  console.log(
    `${url}\n   ${r.usage.rawTokens} → ${r.usage.stateTokens} tokens, ${r.state.chunks.length} chunk(s), ` +
      `${r.state.facts.length} fact(s), date ${r.state.publishedAt ?? '-'}, lang ${r.state.language ?? '-'}, warnings ${w}, ${ms(t0)}`,
  );
}

// 2. Jev classifies the pages. jev_classify truncates at 2 000 chars, so we send
//    a bounded excerpt: the title and the head of the first chunk.
console.log('\n== 2. jev_classify ==');
{
  const t0 = performance.now();
  const items = pages.map((p, i) => ({
    id: `p${i + 1}`,
    text: `${p.state.title ?? ''}\n\n${(p.state.chunks[0]?.text ?? '').slice(0, 1800)}`,
  }));
  const r = (await call(jev, 'jev_classify', {
    purpose: 'Route fetched web pages to the right downstream handler by page type.',
    items,
    classes: CLASSES,
  })) as any;
  console.log(JSON.stringify(r, null, 1).slice(0, 3000));
  console.log(`   ${ms(t0)}`);
}

// 3. Jev verifies the facts Sieve extracted, against the chunk each fact came
//    from. A judge checking the parser: every fact is a claim with an anchor.
console.log('\n== 3. jev_verify: facts from sieve as claims ==');
for (const p of pages) {
  const facts = p.state.facts.slice(0, 6);
  if (!facts.length) continue;
  const claims = facts.map((f: any) => `The page states ${f.label.replace(/_/g, ' ')} = ${f.value} ${f.unit ?? ''}`.trim());
  const evidence = p.state.chunks.map((c: any) => ({ id: c.id, text: c.text }));
  const t0 = performance.now();
  const r = (await call(jev, 'jev_verify', { claims, evidence })) as any;
  console.log(`${p.url}`);
  console.log(JSON.stringify(r, null, 1).slice(0, 2500));
  console.log(`   ${ms(t0)}`);
}

// 4. Jev extracts the publication date itself; compare with what Sieve read
//    from the markup without a model.
console.log('\n== 4. jev_extract: publication date, Jev vs Sieve ==');
for (const p of pages) {
  const doc = p.state.chunks[0]?.text ?? '';
  if (!doc) continue;
  const t0 = performance.now();
  const r = (await call(jev, 'jev_extract', {
    document: doc.slice(0, 50000),
    purpose: 'Find when this page was published or last updated.',
    fields: [
      {
        id: 'published',
        pattern: '\\b(?:\\d{1,2}\\s+\\p{L}+\\s+\\d{4}|\\p{L}+\\s+\\d{1,2},?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})\\b',
        flags: 'u',
        description: 'The date the article was published or last updated. Prefer an explicit byline date over dates mentioned in the body.',
      },
    ],
  })) as any;
  console.log(`${p.url}\n   sieve: ${p.state.publishedAt ?? '-'} | jev: ${JSON.stringify(r).slice(0, 400)} | ${ms(t0)}`);
}

await sieve.close();
await jev.close();
