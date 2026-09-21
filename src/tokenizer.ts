import { countTokens } from 'gpt-tokenizer';
import type { Tokenizer } from './types.ts';

/**
 * o200k as an approximation: Jev's tokenizer is not published. The budget in
 * `limits.ts` keeps headroom for exactly this reason.
 */
export const defaultTokenizer: Tokenizer = {
  count: (text) => (text.length === 0 ? 0 : countTokens(text)),
};
