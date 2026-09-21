/**
 * Shared plumbing for lab scenarios: both MCP servers behind the official
 * client, feed parsing, small statistics, and result files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

type Content = { type: string; text?: string };
type ToolResult = { content?: Content[]; structuredContent?: unknown; isError?: boolean };

export async function connect(name: string, command: string, args: string[]): Promise<Client> {
  const transport = new StdioClientTransport({ command, args, env: process.env as Record<string, string>, stderr: 'pipe' });
  const client = new Client({ name: `lab-${name}`, version: '0.1.0' });
  await client.connect(transport);
  return client;
}

export async function call(client: Client, name: string, args: Record<string, unknown>): Promise<any> {
  const result = (await client.callTool({ name, arguments: args })) as ToolResult;
  if (result.isError) throw new Error(`${name}: ${result.content?.map((c) => c.text).join('\n')}`);
  return result.structuredContent ?? JSON.parse(result.content?.find((c) => c.type === 'text')?.text ?? '{}');
}

export async function servers() {
  const sieve = await connect('sieve', 'node', ['dist/mcp/cli.js']);
  const jev = await connect('jev', 'npx', ['-y', '@jkudish/jev-mcp']);
  return { sieve, jev, close: async () => { await sieve.close(); await jev.close(); } };
}

/** First N item links of an RSS or Atom feed. */
export async function feedLinks(feed: string, n: number): Promise<string[]> {
  const xml = await (await fetch(feed, { headers: { 'user-agent': 'codearia-sieve-lab/0.1' } })).text();
  const links: string[] = [];
  for (const m of xml.matchAll(/<item>[\s\S]*?<link>\s*(?:<!\[CDATA\[)?([^<\]\s]+)[\s\S]*?<\/item>/g)) links.push(m[1]!);
  if (!links.length) for (const m of xml.matchAll(/<entry>[\s\S]*?<link[^>]*href="([^"]+)"/g)) links.push(m[1]!);
  return links.slice(0, n).map((l) => l.replace(/&amp;/g, '&'));
}

export const BAD = new Set(['blocked', 'paywall', 'empty-without-js', 'robots-disallowed', 'fetch-failed', 'tool-error']);

export const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};
export const share = <T>(xs: T[], f: (x: T) => boolean): number => (xs.length ? xs.filter(f).length / xs.length : 0);
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const lin = (x: number, zero: number, full: number) => clamp01((x - zero) / (full - zero));

export function save(dir: string, name: string, data: unknown) {
  mkdirSync(`${dir}/results`, { recursive: true });
  const path = `${dir}/results/${name}`;
  writeFileSync(path, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  return path;
}

export function csv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? '' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join('\n') + '\n';
}

/** Runs sieve_page and folds the result into one flat row plus the text. */
export async function page(sieve: Client, url: string, mode: 'summary' | 'full' | 'markdown' = 'markdown') {
  const t0 = performance.now();
  try {
    const r = await call(sieve, 'sieve_page', { url, mode, trace: true });
    const md: string = r.markdown ?? '';
    const text: string = mode === 'full' ? r.state.chunks.map((c: any) => c.text).join('\n\n') : md;
    return {
      row: {
        url, status: r.source?.status, title: r.state.title, publishedAt: r.state.publishedAt, updatedAt: r.state.updatedAt, language: r.state.language,
        dateSource: r.trace?.dateSource, rawTokens: r.usage.rawTokens, stateTokens: r.usage.stateTokens, visibleChars: r.usage.visibleChars,
        stateChars: r.usage.stateChars, chunks: r.state.chunks.length, facts: r.state.facts.length,
        headings: (md.match(/^#{1,6}\s/gm) ?? []).length, codeBlocks: (md.match(/^```/gm) ?? []).length / 2,
        warnings: r.warnings.map((w: any) => w.code).join('|'), ms: Math.round(performance.now() - t0),
      },
      state: r.state, warnings: r.warnings as { code: string; detail?: string }[], text, dropped: r.trace?.dropped ?? [],
    };
  } catch (e) {
    return {
      row: { url, warnings: 'tool-error', ms: Math.round(performance.now() - t0), rawTokens: 0, stateTokens: 0, chunks: 0, facts: 0, headings: 0, codeBlocks: 0, error: String(e).slice(0, 120) },
      state: undefined, warnings: [{ code: 'tool-error', detail: String(e) }], text: '', dropped: [],
    };
  }
}

export const pad = (s: unknown, n: number) => String(s ?? '-').slice(0, n).padEnd(n);
export const num = (s: unknown, n: number) => String(s ?? '-').padStart(n);
