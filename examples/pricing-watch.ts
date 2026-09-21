/**
 * A weekly pricing watch, the way a small team would run it: four vendors'
 * pricing pages go through codearia-sieve, a decision model reads each
 * vendor's chunk with one typed question, and a second question picks the
 * winner — with probabilities and anchors to check.
 *
 *   node --env-file=.env.local --experimental-strip-types examples/pricing-watch.ts
 *
 * Why the chunk and not only the facts: a pricing grid is not a table. A
 * fact knows the block it came from, not the plan column it sits under, so
 * the plan-to-price pairing is left to the judge, which reads a 1 000-token
 * chunk well. The facts still prove the numbers.
 *
 * The judge here is Jev through jev-mcp; the state is plain JSON, so any
 * model that takes a typed question can sit in its place.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const VENDORS: Record<string, string> = {
  vercel: 'https://vercel.com/pricing',
  netlify: 'https://www.netlify.com/pricing/',
  render: 'https://render.com/pricing',
  railway: 'https://railway.com/pricing',
};

const QUESTION = 'Which vendor offers the cheapest paid plan that includes at least 100 GB of bandwidth per month?';

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

const sieve = await connect('sieve', 'node', ['dist/mcp/cli.js']);
const jev = await connect('jev', 'npx', ['-y', '@jkudish/jev-mcp']);

// 1. Sieve: one chunk per vendor, plus the facts that prove the numbers.
console.log('== sieve_page ==');
const pages: Record<string, { text: string; anchor?: string; facts: any[] }> = {};
let rawTotal = 0;
let stateTotal = 0;
for (const [vendor, url] of Object.entries(VENDORS)) {
  const r = (await call(sieve, 'sieve_page', { url, mode: 'full' })) as any;
  rawTotal += r.usage.rawTokens;
  stateTotal += r.usage.stateTokens;
  const warn = r.warnings.map((w: any) => w.code).join(', ') || '-';
  pages[vendor] = { text: r.state.chunks.map((c: any) => c.text).join('\n\n'), anchor: r.state.chunks[0]?.anchor, facts: r.state.facts };
  console.log(`${vendor.padEnd(8)} ${String(r.usage.rawTokens).padStart(7)} → ${String(r.usage.stateTokens).padStart(5)} tokens  facts ${String(r.state.facts.length).padStart(3)}  warnings ${warn}`);
}
console.log(`total ${rawTotal} → ${stateTotal} tokens (${(100 - (100 * stateTotal) / rawTotal).toFixed(1)}% less)`);

// 2. One typed question per vendor: the cheapest paid plan and its bandwidth,
//    verbatim from the chunk. Regex proposes, Jev picks.
console.log('\n== jev_extract per vendor ==');
const evidence: string[] = [];
for (const [vendor, page] of Object.entries(pages)) {
  const r = (await call(jev, 'jev_extract', {
    document: page.text.slice(0, 50000),
    purpose: `Pricing comparison. Question: ${QUESTION}`,
    fields: [
      { id: 'cheapest_paid_plan_price', pattern: '\\$\\s?\\d[\\d,.]*\\s?(?:/\\s?mo(?:nth)?|per month|/month)?', description: 'The monthly price of the cheapest plan that costs more than $0. Not usage credits, not per-seat add-ons, not the free plan.' },
      { id: 'bandwidth_on_that_plan', pattern: '\\d[\\d,.]*\\s?(?:GB|TB)(?:\\s?(?:/|per)\\s?month)?', description: 'The bandwidth or data transfer included per month in that same cheapest paid plan. Not RAM, not storage, not build minutes.' },
    ],
  })) as any;
  const got = Object.fromEntries((r.results ?? []).map((x: any) => [x.id, { value: x.value, status: x.status, confidence: x.confidence }]));
  console.log(`${vendor.padEnd(8)} price ${JSON.stringify(got.cheapest_paid_plan_price?.value)} (${got.cheapest_paid_plan_price?.status})  bandwidth ${JSON.stringify(got.bandwidth_on_that_plan?.value)} (${got.bandwidth_on_that_plan?.status})`);
  const provable = page.facts.filter((f: any) => /USD_per_month|GB|TB/.test(f.unit ?? '')).slice(0, 8).map((f: any) => `${f.value} ${f.unit} (block ${f.from})`).join('; ');
  evidence.push(`${vendor}: cheapest paid plan ${got.cheapest_paid_plan_price?.value ?? 'not stated'} [${got.cheapest_paid_plan_price?.status}], bandwidth on it ${got.bandwidth_on_that_plan?.value ?? 'not stated'} [${got.bandwidth_on_that_plan?.status}]. Numbers on the page: ${provable}. Check at: ${VENDORS[vendor]} → "${page.anchor ?? ''}"`);
}

// 3. The decision, on extracted values rather than pages.
console.log('\n== jev_decide ==');
const decision = (await call(jev, 'jev_decide', {
  decision: QUESTION,
  evidence: evidence.join('\n').slice(0, 12000),
  priorities: 'Lowest monthly price wins among plans whose stated bandwidth is at least 100 GB (0.1 TB) per month. Free plans do not count. A vendor whose bandwidth is not stated cannot win.',
  candidates: Object.keys(VENDORS).map((id) => ({ id, description: `${id}'s cheapest paid plan` })),
  requirements: ['The plan has a stated monthly price in USD above zero.', 'The plan states at least 100 GB of bandwidth per month.'],
})) as any;
console.log(`selected: ${decision.recommendation?.selected}  confidence ${decision.recommendation?.confidence}`);
console.log(`probabilities: ${JSON.stringify(decision.recommendation?.probabilities)}`);
for (const c of decision.checks ?? []) console.log(`  ${c.candidate.padEnd(8)} req ${c.requirement}: ${c.answer}`);
console.log('\nevidence handed to the judge:\n' + evidence.map((e) => '  ' + e).join('\n'));

await sieve.close();
await jev.close();
