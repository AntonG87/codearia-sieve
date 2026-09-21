import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/mcp/server.ts';

const FIXTURE = new URL('./fixtures/pricing.html', import.meta.url);
const URL_ = 'https://docs.example/jev/pricing';

async function connect() {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createServer({ now: () => new Date('2026-09-21T12:00:00Z') });
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return { client, server };
}

type Structured = { state: { chunks: { id: string; text?: string; tokens: number }[]; facts: unknown[] }; usage: { rawTokens: number; stateTokens: number }; markdown?: string };

test('lists both tools with schemas', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['sieve_chunk', 'sieve_page']);
  const page = tools.find((t) => t.name === 'sieve_page');
  assert.ok(page?.inputSchema);
  assert.ok(page?.outputSchema, 'outputSchema lets the client validate structuredContent');
});

test('summary mode returns typed state without chunk text', async () => {
  const { client } = await connect();
  const html = await readFile(FIXTURE, 'utf8');
  const res = await client.callTool({ name: 'sieve_page', arguments: { html, url: URL_ } });
  assert.notEqual(res.isError, true);
  const s = res.structuredContent as Structured;
  assert.ok(s.state.chunks.length >= 1);
  assert.equal(s.state.chunks[0]?.text, undefined, 'summary must not carry chunk text');
  assert.ok(s.state.facts.length > 0);
  assert.ok(s.usage.rawTokens > s.usage.stateTokens);
  assert.equal(s.markdown, undefined);
});

test('full mode carries chunk text; markdown mode carries markdown', async () => {
  const { client } = await connect();
  const html = await readFile(FIXTURE, 'utf8');
  const full = (await client.callTool({ name: 'sieve_page', arguments: { html, url: URL_, mode: 'full' } })).structuredContent as Structured;
  assert.match(full.state.chunks[0]?.text ?? '', /input token/);
  const md = (await client.callTool({ name: 'sieve_page', arguments: { html, url: URL_, mode: 'markdown' } })).structuredContent as Structured;
  assert.match(md.markdown ?? '', /^## Pricing/);
});

test('sieve_chunk serves text for a page prepared earlier, without refetching', async () => {
  const { client } = await connect();
  const html = await readFile(FIXTURE, 'utf8');
  await client.callTool({ name: 'sieve_page', arguments: { html, url: URL_ } });
  const res = await client.callTool({ name: 'sieve_chunk', arguments: { url: URL_, id: 'c1' } });
  const s = res.structuredContent as { id: string; text: string; tokens: number };
  assert.equal(s.id, 'c1');
  assert.match(s.text, /Pricing/);
});

test('missing input is a tool error, not a protocol error', async () => {
  const { client } = await connect();
  const res = await client.callTool({ name: 'sieve_page', arguments: {} });
  assert.equal(res.isError, true);
});
