/**
 * A weekly pricing watch, the way a small team would run it: four vendors'
 * pricing pages go through codearia-sieve, the facts go to a decision model
 * with one bounded question, and the answer comes back with probabilities
 * and anchors to check.
 *
 *   node --env-file=.env.local --experimental-strip-types examples/pricing-watch.ts
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

// 1. Sieve: summary mode is enough — facts come with the state, chunk text
//    stays on the server until someone asks for it.
console.log('== sieve_page ==');
const evidence: string[] = [];
let rawTotal = 0;
let stateTotal = 0;
for (const [vendor, url] of Object.entries(VENDORS)) {
  const r = (await call(sieve, 'sieve_page', { url, mode: 'summary' })) as any;
  rawTotal += r.usage.rawTokens;
  stateTotal += r.usage.stateTokens;
  const warn = r.warnings.map((w: any) => w.code).join(', ') || '-';
  const money = r.state.facts.filter((f: any) => /USD|GB|TB/.test(f.unit ?? ''));
  console.log(`${vendor.padEnd(8)} ${String(r.usage.rawTokens).padStart(7)} → ${String(r.usage.stateTokens).padStart(5)} tokens  facts ${String(r.state.facts.length).padStart(2)}  warnings ${warn}`);
  for (const f of money.slice(0, 12)) console.log(`         ${f.label} = ${f.value} ${f.unit}   [${f.from}] ${f.context.slice(0, 90)}`);
  const lines = money.map((f: any) => `- ${f.label} = ${f.value} ${f.unit} (block ${f.from}: "${f.context.slice(0, 120)}")`);
  evidence.push(`## ${vendor} — ${url}\n${lines.join('\n') || '- no priced facts found; warnings: ' + warn}`);
}
console.log(`\ntotal ${rawTotal} → ${stateTotal} tokens (${(100 - (100 * stateTotal) / rawTotal).toFixed(1)}% less)`);

// 2. Jev decides. Evidence is the facts, not the pages: numbers with units,
//    each naming the block it came from.
console.log('\n== jev_decide ==');
const decision = (await call(jev, 'jev_decide', {
  decision: QUESTION,
  evidence: evidence.join('\n\n').slice(0, 12000),
  priorities: 'Lowest monthly price wins. The plan must state at least 100 GB (or 0.1 TB) of bandwidth or data transfer per month. Free plans do not count. If the evidence for a vendor does not state bandwidth, that vendor cannot win.',
  candidates: Object.keys(VENDORS).map((id) => ({ id, description: `${id}'s cheapest paid plan` })),
  requirements: [
    'The chosen plan has a stated monthly price in USD.',
    'The chosen plan states at least 100 GB of bandwidth per month.',
  ],
})) as any;
console.log(JSON.stringify(decision, null, 1).slice(0, 4000));

await sieve.close();
await jev.close();
