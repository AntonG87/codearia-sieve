import { DEFAULT_BUDGET } from './limits.ts';
import { defaultFetcher, fetchWarning } from './fetch.ts';
import { extract } from './extract.ts';
import { chunk } from './chunk.ts';
import { toMarkdown } from './markdown.ts';
import { defaultTokenizer } from './tokenizer.ts';
import { fromByline } from './normalize/dates.ts';
import { extractFacts, FACT_CAP } from './normalize/numbers.ts';
import type { Input, Result, SieveOptions, State, Tokenizer, Warning } from './types.ts';

export type * from './types.ts';
export { DEFAULT_BUDGET, JEV, JEV_MCP } from './limits.ts';
export { parseDate, findDates } from './normalize/dates.ts';

/** Thresholds for the `thin-content` warning; see where it is raised. */
const THIN_RAW_TOKENS = 10_000;
const THIN_STATE_CHARS = 2_400;
/**
 * Below this share of the body's visible text, a small state is a miss, not
 * a win. Set where an abstract page with a sidebar (arXiv keeps ~40%) still
 * passes and a front page (a few percent) does not.
 */
const THIN_SHARE = 0.35;
/** Below this much state, a page that declares a paywall in JSON-LD served only its teaser. */
const PAYWALL_TEASER_CHARS = 3_000;
/** …and kept less than this share of the visible text: a short article served whole is not a teaser. */
const PAYWALL_TEASER_SHARE = 0.8;

/** Bot challenges and refusals; the status alone is not enough (some send 200). */
const BLOCK_TITLE = /just a moment|attention required|access denied|request access|are you a human|human verification|verify you are|robot check|captcha|automated tool|javascript is disabled/i;
const BLOCK_STATUS = new Set([401, 403, 405, 429, 503]);

/**
 * URL or HTML in; markdown, decision-ready state and the token bill out.
 *
 * Expected outcomes never throw: a blocked, empty or unreachable page comes
 * back as a result with warnings, because an agent working through a list of
 * two hundred links needs the honest picture, not an exception.
 */
export async function sieve(input: Input, options: SieveOptions = {}): Promise<Result> {
  const started = performance.now();
  const now = options.now ?? (() => new Date());
  const tokenizer = options.tokenizer ?? defaultTokenizer;
  const budget = { ...DEFAULT_BUDGET, ...options.budget };
  const warnings: Warning[] = [];

  let html = '';
  let url = '';
  let status = 0;

  if (input.kind === 'html') {
    html = input.html;
    url = input.url ?? '';
    status = 200;
  } else {
    url = input.url;
    try {
      const fetched = await (options.fetcher ?? defaultFetcher).get(input.url);
      html = fetched.html;
      url = fetched.finalUrl;
      status = fetched.status;
    } catch (error) {
      warnings.push(fetchWarning(error));
    }
  }

  const extracted = html ? await extract(html, url, { trace: options.trace }) : undefined;

  // A challenge page is not "no main content"; name the real reason. A
  // non-200 answer that carries no article (PubMed's 203 interstitial) is a
  // refusal too, whatever the title says.
  const blocked =
    extracted &&
    (BLOCK_STATUS.has(status) ||
      BLOCK_TITLE.test(extracted.title ?? '') ||
      (status !== 200 && extracted.blocks.length === 0));
  if (blocked) {
    warnings.push({ code: 'blocked', detail: `status ${status}${extracted.title ? `, "${extracted.title}"` : ''}` });
  } else if (extracted && status >= 400) {
    // A 404 or a 500 with a themed error page still carries menus and a
    // title; whatever was extracted is not the page that was asked for.
    warnings.push({ code: 'http-error', detail: `status ${status}${extracted.title ? `, "${extracted.title}"` : ''}` });
  }
  warnings.push(...(extracted?.warnings ?? []).filter((w) => !(blocked && w.code === 'no-main-content')));

  let blocks = extracted?.blocks ?? [];
  if (options.task && options.selector && blocks.length) {
    blocks = await options.selector.keep(blocks, options.task);
  }

  const packed = chunk(blocks, budget, tokenizer);
  warnings.push(...packed.warnings);

  // Language: the markup first; failing that, the script the text is written in.
  const language = extracted?.language || guessLanguage(blocks.map((b) => b.text).join(' ').slice(0, 4000));

  const state: State = { facts: extractFacts(blocks, language), chunks: packed.chunks };
  if (state.facts.length >= FACT_CAP) {
    warnings.push({ code: 'facts-capped', detail: `the first ${FACT_CAP} facts are listed; the page has more` });
  }
  if (extracted?.title) state.title = extracted.title;
  if (language) state.language = language;

  // Markup tiers answered in `extract`; a labelled byline near the top is the
  // only prose we consult, and it is allowed to abstain.
  let dateSource = extracted?.dates.source;
  let publishedAt = extracted?.dates.publishedAt;
  if (!publishedAt && blocks.length) {
    publishedAt = fromByline(blocks.slice(0, 4).map((b) => b.text), { now: now() });
    if (publishedAt) dateSource = 'byline';
  }
  if (publishedAt) state.publishedAt = publishedAt;
  if (extracted?.dates.updatedAt) state.updatedAt = extracted.dates.updatedAt;

  const stateTokens =
    packed.chunks.reduce((sum, c) => sum + c.tokens, 0) + tokenizer.count(state.title ?? '');
  const stateChars = packed.chunks.reduce((sum, c) => sum + c.chars, 0);
  const { rawTokens, estimated } = countRaw(html, tokenizer);

  // A big page that yields a small share of its own visible text is usually
  // not an article at all — a front page, a listing, an app shell — and the
  // caller should know that the small state is a property of the page, not
  // a clean win. A short page that we returned nearly whole is fine.
  const bodyChars = extracted?.bodyChars ?? 0;

  // A teaser behind a subscription wall is not the article; say so instead of
  // "thin". A page that only declares the wall in JSON-LD but served the whole
  // text is not behind one.
  const paywall =
    !!extracted &&
    !blocked &&
    (extracted.paywalled === 'stated' ||
      (extracted.paywalled === 'declared' && stateChars < PAYWALL_TEASER_CHARS && stateChars < (extracted.bodyChars ?? 0) * PAYWALL_TEASER_SHARE));
  if (paywall) {
    warnings.push({
      code: 'paywall',
      detail: stateChars < PAYWALL_TEASER_CHARS ? 'the page marks its article as not free; only the teaser was available' : 'the page says its article is for subscribers; check that the text is complete',
    });
  }

  if (
    !blocked &&
    !paywall &&
    rawTokens >= THIN_RAW_TOKENS &&
    stateChars > 0 &&
    stateChars < THIN_STATE_CHARS &&
    stateChars < bodyChars * THIN_SHARE
  ) {
    warnings.push({ code: 'thin-content', detail: `${stateChars} of ${bodyChars} visible characters kept` });
  }

  const result: Result = {
    source: { url, fetchedAt: now().toISOString(), status },
    markdown: extracted ? toMarkdown(extracted.html) : '',
    state,
    usage: {
      rawTokens,
      stateTokens,
      ...(estimated ? { rawTokensEstimated: true } : {}),
      visibleChars: bodyChars,
      stateChars,
      chunks: packed.chunks.length,
      ms: Math.round(performance.now() - started),
    },
    warnings,
  };
  if (options.trace) {
    result.trace = { dropped: extracted?.dropped ?? [] };
    if (dateSource) result.trace.dateSource = dateSource;
  }
  return result;
}

/** Above this size the raw token count is sampled, not counted in full. */
const RAW_COUNT_FULL_LIMIT = 1_000_000;
const RAW_SAMPLES = 8;
const RAW_SAMPLE_CHARS = 64_000;

/**
 * The raw token count is honest but expensive: tokenizing four megabytes of
 * Wikipedia markup is most of a ten-second run. Past a size limit the count
 * comes from evenly spaced samples, scaled to the whole — and the result is
 * flagged as an estimate, because a number that pretends to be exact is worse
 * than one that says it is close.
 */
export function countRaw(html: string, tokenizer: Tokenizer): { rawTokens: number; estimated: boolean } {
  if (html.length <= RAW_COUNT_FULL_LIMIT) return { rawTokens: tokenizer.count(html), estimated: false };
  const step = Math.floor((html.length - RAW_SAMPLE_CHARS) / (RAW_SAMPLES - 1));
  let sampledChars = 0;
  let sampledTokens = 0;
  for (let i = 0; i < RAW_SAMPLES; i++) {
    const slice = html.slice(i * step, i * step + RAW_SAMPLE_CHARS);
    sampledChars += slice.length;
    sampledTokens += tokenizer.count(slice);
  }
  return { rawTokens: Math.round((sampledTokens / sampledChars) * html.length), estimated: true };
}

/**
 * When the page does not declare a language, the script it is written in is
 * a good enough answer for choosing number-separator rules. Counted on the
 * first few thousand characters; deterministic.
 */
export function guessLanguage(text: string): string | undefined {
  if (!text) return undefined;
  const cyr = (text.match(/\p{Script=Cyrillic}/gu) ?? []).length;
  const heb = (text.match(/\p{Script=Hebrew}/gu) ?? []).length;
  const lat = (text.match(/\p{Script=Latin}/gu) ?? []).length;
  const total = cyr + heb + lat;
  if (total < 40) return undefined;
  if (cyr / total > 0.5) return 'ru';
  if (heb / total > 0.5) return 'he';
  if (lat / total > 0.5) return 'en';
  return undefined;
}
