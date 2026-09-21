/**
 * Numbers that belong to other people's products and move without notice.
 * They live here, not inside the steps that use them.
 */

/** Jev, per docs.typesafe.ai/models, checked 2026-09-21. */
export const JEV = {
  /** State plus the single longest question. */
  stateTokens: 32_000,
  /** State plus every question in the request. */
  requestTokens: 64_000,
} as const;

/** jkudish/jev-mcp input caps, per its README, checked 2026-09-21. */
export const JEV_MCP = {
  /** Largest text field a single tool accepts. */
  fieldChars: 50_000,
  /** Aggregate budget for reranking calls. */
  rerankChars: 100_000,
  candidates: 250,
} as const;

/**
 * Default chunk budget: two-dimensional on purpose. A chunk must fit the
 * model's state in tokens AND the wrapper's field in characters, and Cyrillic
 * can pass one while failing the other. The token figure leaves room for the
 * questions and for the fact that Jev's tokenizer is not public: we count
 * with o200k and keep roughly 15% headroom.
 */
export const DEFAULT_BUDGET = {
  maxTokens: 20_000,
  maxChars: JEV_MCP.fieldChars,
} as const;
