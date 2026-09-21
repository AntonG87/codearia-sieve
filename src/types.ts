/**
 * The contract every pipeline step agrees on.
 *
 * Steps do not share anything else: each one takes these shapes and returns
 * these shapes, which is what lets any single step be swapped or tested alone.
 */

/** What the caller hands in. The tag decides whether we go to the network. */
export type Input =
  | { kind: 'url'; url: string }
  | { kind: 'html'; html: string; url?: string };

/** Where the material came from. */
export interface Source {
  url: string;
  /** ISO 8601 timestamp of the fetch. */
  fetchedAt: string;
  status: number;
}

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'code'
  | 'quote';

/**
 * One structural piece of the page, before any token budget is applied.
 * Blocks are what the cleaning and selection steps reason about.
 */
export interface Block {
  id: string;
  kind: BlockKind;
  text: string;
  /** Where to look on the page to verify this block; see `anchor.ts`. */
  anchor?: string;
  /** Heading depth; set for `heading` blocks only. */
  level?: number;
}

/**
 * A value lifted out of prose so the decision model never has to parse it.
 * This exists because System One models neither count nor order dates.
 */
export interface Fact {
  /** A short handle: the sentence's first meaningful words, no digits. */
  label: string;
  value: number | string | boolean;
  /** Unit of measure: "USD", "token", "ms", "USD_per_million". */
  unit?: string;
  /** The sentence the value was read from — what the label abbreviates. */
  context?: string;
  /** Block the value was read from, so a decision stays traceable. */
  from?: string;
}

/** Material sized to fit a model's state budget. */
export interface Chunk {
  id: string;
  text: string;
  tokens: number;
  chars: number;
  /** Where to look on the page to verify a decision made from this chunk. */
  anchor?: string;
  /** Ids of the blocks this chunk was built from. */
  blocks: string[];
}

/** The half of the response that exists for deciding rather than reading. */
export interface State {
  title?: string;
  /** ISO date, taken from markup first and prose last. */
  publishedAt?: string;
  updatedAt?: string;
  language?: string;
  facts: Fact[];
  chunks: Chunk[];
}

export interface Usage {
  /** What the raw page would have cost the caller. */
  rawTokens: number;
  /** What the prepared state costs instead. This pair is the whole pitch. */
  stateTokens: number;
  /**
   * True when `rawTokens` was extrapolated from samples of a very large
   * page instead of counted in full; the figure is then within a few
   * percent, and the flag says so rather than pretending.
   */
  rawTokensEstimated?: boolean;
  /** Characters a reader would see on the page, scripts and styles aside. */
  visibleChars: number;
  /** Characters that made it into the chunks. */
  stateChars: number;
  chunks: number;
  ms: number;
}

/**
 * Expected outcomes that are not bugs. A page behind robots.txt or a page
 * that is empty without JavaScript is information, not an exception.
 */
export interface Warning {
  code:
    | 'robots-disallowed'
    | 'fetch-failed'
    /** The site answered with a bot challenge or a refusal, not a page. */
    | 'blocked'
    /** The article is behind a subscription; what came back is the teaser. */
    | 'paywall'
    | 'empty-without-js'
    | 'no-main-content'
    /** Lots of markup, little article: a front page, a listing, or an app shell. */
    | 'thin-content'
    | 'fallback-extractor'
    | 'block-split';
  detail?: string;
}

/** One thing the cleaning step threw away, and why. */
export interface Dropped {
  step: string;
  reason?: string;
  selector?: string;
  /** A short excerpt, enough to recognise what went. */
  text: string;
}

/**
 * The audit trail. Off by default because it is large; on when someone needs
 * to argue with the result. A decision is only provable if the discards are.
 */
export interface Trace {
  dropped: Dropped[];
  /** Which tier produced `publishedAt`: "json-ld", "meta", "time", "byline". */
  dateSource?: string;
}

export interface Result {
  source: Source;
  /** For reading: by a human or a generative model. */
  markdown: string;
  /** For deciding: by a classifier that cannot afford to read. */
  state: State;
  usage: Usage;
  warnings: Warning[];
  trace?: Trace;
}

/** Everything the fetch step needs to report about a page. */
export interface FetchResult {
  html: string;
  status: number;
  finalUrl: string;
}

/** Network access lives behind this so tests and offline runs never touch it. */
export interface Fetcher {
  get(url: string): Promise<FetchResult>;
}

/**
 * Judges whether a block serves the task at hand.
 *
 * Rules are the default implementation; a model-backed one plugs in here.
 * Keeping this behind an interface is what stops a vendor waitlist from
 * blocking the project.
 */
export interface Selector {
  keep(blocks: Block[], task: string): Promise<Block[]>;
}

/** Counting is swappable because every model family counts differently. */
export interface Tokenizer {
  count(text: string): number;
}

/** A chunk must satisfy both limits at once; see `limits.ts` for why. */
export interface Budget {
  maxTokens: number;
  maxChars: number;
}

export interface SieveOptions {
  /** What the caller wants to decide. Selection only runs when this is set. */
  task?: string;
  budget?: Partial<Budget>;
  fetcher?: Fetcher;
  selector?: Selector;
  tokenizer?: Tokenizer;
  /** Injected so two runs over the same input produce identical output. */
  now?: () => Date;
  /** Record what was discarded and where the dates came from. */
  trace?: boolean;
}
