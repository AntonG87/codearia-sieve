import type { Block, Budget, Chunk, Tokenizer, Warning } from './types.ts';

/** A heading arriving when the chunk is this full closes it, so sections start chunks. */
const HEADING_CLOSE_SHARE = 0.5;

export interface Chunked {
  chunks: Chunk[];
  warnings: Warning[];
}

/**
 * Packs blocks into chunks that fit the budget in both tokens and characters.
 *
 * Greedy and in document order: a chunk closes when the next block would push
 * it over either limit. A single block that is too large on its own is split
 * on paragraph, then sentence, boundaries, and the split is reported as a
 * warning because it is the one place where a chunk can stop mid-thought.
 */
export function chunk(blocks: Block[], budget: Budget, tokenizer: Tokenizer): Chunked {
  const warnings: Warning[] = [];
  const chunks: Chunk[] = [];

  let text = '';
  let tokens = 0;
  let ids: string[] = [];
  let anchor: string | undefined;
  let headings: string[] = [];

  const close = () => {
    if (!text) return;
    const done: Chunk = {
      id: `c${chunks.length + 1}`,
      text,
      tokens,
      chars: text.length,
      blocks: ids,
    };
    if (anchor) done.anchor = anchor;
    if (headings.length) done.headings = headings;
    chunks.push(done);
    text = '';
    tokens = 0;
    ids = [];
    anchor = undefined;
    headings = [];
  };

  const add = (piece: string, pieceTokens: number, block: Block) => {
    const joined = text ? `${text}\n\n${piece}` : piece;
    const fits = tokens + pieceTokens <= budget.maxTokens && joined.length <= budget.maxChars;
    // A section that would not fit whole starts its own chunk: closing a
    // half-full chunk at a heading keeps the anchor honest about what follows.
    // Either limit counts: English hits the character ceiling long before the token one.
    const fullness = Math.max(tokens / budget.maxTokens, text.length / budget.maxChars);
    const sectionStart = block.kind === 'heading' && fullness >= HEADING_CLOSE_SHARE;
    if (!fits || sectionStart) close();
    text = text ? `${text}\n\n${piece}` : piece;
    tokens += pieceTokens;
    if (!ids.includes(block.id)) ids.push(block.id);
    anchor ??= block.anchor;
    if (block.kind === 'heading' && !headings.includes(block.text)) headings.push(block.text);
  };

  for (const block of blocks) {
    const own = tokenizer.count(block.text);
    if (own <= budget.maxTokens && block.text.length <= budget.maxChars) {
      add(block.text, own, block);
      continue;
    }
    warnings.push({ code: 'block-split', detail: `${block.id} (${own} tokens)` });
    for (const piece of split(block.text, budget, tokenizer)) {
      add(piece, tokenizer.count(piece), block);
    }
  }
  close();

  return { chunks, warnings };
}

/** Splits oversized text on paragraphs, then sentences, never mid-word. */
function split(text: string, budget: Budget, tokenizer: Tokenizer): string[] {
  const fits = (s: string) => tokenizer.count(s) <= budget.maxTokens && s.length <= budget.maxChars;
  const out: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer) out.push(buffer);
    buffer = '';
  };

  // A table or a list is cut between its lines, never inside one; prose
  // between sentences.
  const byLine = text.split('\n').length >= 3;
  const joiner = byLine ? '\n' : ' ';
  for (const unit of units(text, byLine)) {
    const candidate = buffer ? `${buffer}${joiner}${unit}` : unit;
    if (fits(candidate)) {
      buffer = candidate;
    } else {
      flush();
      // A single sentence over budget is pathological; hard-cut it rather than loop.
      buffer = fits(unit) ? unit : unit.slice(0, budget.maxChars);
    }
  }
  flush();
  return out;
}

function units(text: string, byLine = false): string[] {
  const sentences = (s: string) => s.split(/(?<=[.!?…])\s+(?=\S)/);
  const parts = byLine
    ? // Lines stay whole unless one is itself a paragraph's worth of text.
      text.split('\n').flatMap((line) => (line.length > LONG_LINE_CHARS ? sentences(line) : [line]))
    : text.split(/\n{2,}/).flatMap(sentences);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** A line longer than this is prose wearing a line break and may be cut between sentences. */
const LONG_LINE_CHARS = 4_000;
