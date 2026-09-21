/**
 * The MCP face of Sieve: the same pipeline, reachable from any agent.
 *
 * Results go out as `structuredContent` with an output schema, so the agent
 * gets typed state rather than a string to parse. The `summary` mode holds
 * back chunk text on purpose: a full state can be tens of thousands of
 * tokens, and handing that to the agent unasked is the very waste this
 * project exists to stop.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { sieve } from '../index.ts';
import type { Input, Result, SieveOptions } from '../types.ts';

const MODES = ['summary', 'full', 'markdown'] as const;

const SourceSchema = z.object({ url: z.string(), fetchedAt: z.string(), status: z.number() });
const FactSchema = z.object({
  label: z.string(),
  value: z.union([z.number(), z.string(), z.boolean()]),
  unit: z.string().optional(),
  context: z.string().optional(),
  from: z.string().optional(),
});
const ChunkSchema = z.object({
  id: z.string(),
  /** Present in `full` mode only. */
  text: z.string().optional(),
  tokens: z.number(),
  chars: z.number(),
  anchor: z.string().optional(),
  blocks: z.array(z.string()),
});
const StateSchema = z.object({
  title: z.string().optional(),
  publishedAt: z.string().optional(),
  updatedAt: z.string().optional(),
  language: z.string().optional(),
  facts: z.array(FactSchema),
  chunks: z.array(ChunkSchema),
});
const UsageSchema = z.object({
  rawTokens: z.number(),
  stateTokens: z.number(),
  rawTokensEstimated: z.boolean().optional(),
  visibleChars: z.number(),
  stateChars: z.number(),
  chunks: z.number(),
  ms: z.number(),
});
const WarningSchema = z.object({ code: z.string(), detail: z.string().optional() });

const OutputShape = {
  source: SourceSchema,
  state: StateSchema,
  usage: UsageSchema,
  warnings: z.array(WarningSchema),
  /** Present in `markdown` mode only. */
  markdown: z.string().optional(),
  trace: z
    .object({
      dropped: z.array(z.object({ step: z.string(), reason: z.string().optional(), selector: z.string().optional(), text: z.string() })),
      dateSource: z.string().optional(),
    })
    .optional(),
};

const InputShape = {
  url: z.string().url().optional().describe('Page to fetch. Either url or html is required.'),
  html: z.string().optional().describe('Raw HTML to process instead of fetching. Pair with url for anchors.'),
  mode: z.enum(MODES).default('summary').describe(
    'summary: state without chunk text (cheap, default). full: with chunk text. markdown: readable text instead of state.',
  ),
  task: z.string().optional().describe('What you intend to decide; enables relevance selection when a selector is configured.'),
  maxTokens: z.number().int().positive().optional().describe('Chunk budget in tokens.'),
  maxChars: z.number().int().positive().optional().describe('Chunk budget in characters.'),
  trace: z.boolean().default(false).describe('Include what was discarded and where the date came from.'),
};

/** Recent results by URL, so `sieve_chunk` can serve text without a refetch. */
const recent = new Map<string, Result>();
const RECENT_LIMIT = 32;

function remember(key: string, result: Result) {
  recent.delete(key);
  recent.set(key, result);
  if (recent.size > RECENT_LIMIT) recent.delete(recent.keys().next().value as string);
}

/** Shapes a Result for the wire according to the requested mode. */
export function present(result: Result, mode: (typeof MODES)[number]) {
  const chunks = result.state.chunks.map((c) => {
    const out: z.infer<typeof ChunkSchema> = { id: c.id, tokens: c.tokens, chars: c.chars, blocks: c.blocks };
    if (c.anchor) out.anchor = c.anchor;
    if (mode === 'full') out.text = c.text;
    return out;
  });
  const out: z.infer<z.ZodObject<typeof OutputShape>> = {
    source: result.source,
    state: { ...result.state, chunks },
    usage: result.usage,
    warnings: result.warnings,
  };
  if (mode === 'markdown') out.markdown = result.markdown;
  if (result.trace) out.trace = result.trace;
  return out;
}

export function createServer(defaults: SieveOptions = {}): McpServer {
  const server = new McpServer({ name: 'codearia-sieve', version: '0.1.0' });

  server.registerTool(
    'sieve_page',
    {
      title: 'Prepare a page for decisions',
      description:
        'Turns a web page into decision-ready state: dates as ISO fields, numbers with units as facts, ' +
        'text in token-budgeted chunks with anchors back to the page, and the token bill (raw vs state). ' +
        'Start with mode=summary; fetch chunk text with sieve_chunk or mode=full only when needed.',
      inputSchema: InputShape,
      outputSchema: OutputShape,
    },
    async (args) => {
      if (!args.url && !args.html) {
        return { content: [{ type: 'text', text: 'Provide url or html.' }], isError: true };
      }
      const input: Input = args.html
        ? { kind: 'html', html: args.html, ...(args.url ? { url: args.url } : {}) }
        : { kind: 'url', url: args.url! };
      const options: SieveOptions = { ...defaults, trace: args.trace };
      if (args.task) options.task = args.task;
      if (args.maxTokens || args.maxChars) {
        options.budget = {};
        if (args.maxTokens) options.budget.maxTokens = args.maxTokens;
        if (args.maxChars) options.budget.maxChars = args.maxChars;
      }
      const result = await sieve(input, options);
      remember(args.url ?? '', result);
      const structuredContent = present(result, args.mode);
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent) }],
        structuredContent,
      };
    },
  );

  server.registerTool(
    'sieve_chunk',
    {
      title: 'Read one chunk',
      description: 'Returns the text of a chunk from a page prepared earlier with sieve_page (same url).',
      inputSchema: { url: z.string(), id: z.string().describe('Chunk id such as c3.') },
      outputSchema: { id: z.string(), text: z.string(), tokens: z.number(), anchor: z.string().optional() },
    },
    async ({ url, id }) => {
      const result = recent.get(url) ?? (await sieve({ kind: 'url', url }, defaults));
      remember(url, result);
      const chunk = result.state.chunks.find((c) => c.id === id);
      if (!chunk) {
        return { content: [{ type: 'text', text: `No chunk ${id} for ${url}.` }], isError: true };
      }
      const structuredContent: { id: string; text: string; tokens: number; anchor?: string } = {
        id: chunk.id,
        text: chunk.text,
        tokens: chunk.tokens,
      };
      if (chunk.anchor) structuredContent.anchor = chunk.anchor;
      return { content: [{ type: 'text', text: chunk.text }], structuredContent };
    },
  );

  return server;
}
