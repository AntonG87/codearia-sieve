import { parseHTML } from 'linkedom';
import { Defuddle } from 'defuddle/node';
import { Readability } from '@mozilla/readability';
import { findDates, jsonLdValue, type FoundDates } from './normalize/dates.ts';
import type { Block, BlockKind, Dropped, Warning } from './types.ts';

/** What the extraction step hands to the rest of the pipeline. */
export interface Extracted {
  /** Cleaned article HTML, the input for both markdown and blocks. */
  html: string;
  title?: string;
  /** Dates as the original markup states them, already ISO. */
  dates: FoundDates;
  language?: string;
  blocks: Block[];
  warnings: Warning[];
  /** What was removed and why: our own chrome rules always, Defuddle's when tracing. */
  dropped: Dropped[];
  /** Visible text length of the original body, for judging thin results. */
  bodyChars: number;
  /** The page says its article is not free, or shows a subscription wall. */
  /** 'stated' when the page says so in words; 'declared' when only JSON-LD flags it. */
  paywalled: false | 'declared' | 'stated';
}

export interface ExtractOptions {
  trace?: boolean;
}

/**
 * Below this many characters the primary extractor is assumed to have missed
 * the article, and the fallback gets a turn. Chosen loosely: a real article
 * rarely fits in a tweet.
 */
const MIN_CONTENT_CHARS = 280;
/** Above this much extracted text, an empty container is decoration, not the article. */
const EMPTY_CONTAINER_MAX_CHARS = 2000;
/** Below this much visible prose, a scripted page is an app shell waiting for its data. */
const EMPTY_BODY_CHARS = 500;
/** A shell is heavy: a small static page with little text is just a small page. */
const SHELL_MIN_HTML = 50_000;

/** Whether the page carries any script at all; a static page cannot be a shell. */
function scripted(document: Document): boolean {
  return document.querySelectorAll('script').length > 0;
}

/**
 * Extraction is a chain, not a library call: the best-scoring tools in the
 * trafilatura benchmark all win by combining a rule-based pass with
 * algorithmic fallbacks. Defuddle first; Readability if it came back empty.
 */
export async function extract(source: string, url: string, options: ExtractOptions = {}): Promise<Extracted> {
  const html = ensureBody(source);
  const warnings: Warning[] = [];
  const dropped: Dropped[] = [];

  // Dates and ids are read from the untouched document: the cleaners strip
  // <head>, the byline and attributes before anything downstream sees them.
  const original = parseHTML(html).document;
  const dates = findDates(original);
  const clientRendered = looksClientRendered(original);
  const paywalled = looksPaywalled(original);
  const bodyChars = visibleTextLength(original);

  let content = '';
  let title: string | undefined;
  let language: string | undefined;

  try {
    // `useAsync: false` keeps Defuddle from calling third-party APIs: the
    // output must depend on the HTML alone. Defuddle mutates the document it
    // is given, hence a fresh parse. It also logs to the console on malformed
    // schema.org data, and stdout belongs to the MCP transport — so: quiet.
    const primary = await quiet(() => Defuddle(padInline(parseHTML(html).document), url, { useAsync: false }));
    content = primary.content ?? '';
    title = primary.title || undefined;
    language = primary.language || undefined;
  } catch (error) {
    warnings.push({ code: 'fallback-extractor', detail: describe(error) });
  }

  // Too little: nothing at all, or a sliver of a big document — Defuddle
  // keeps one section of an RFC whose every paragraph ends in a pilcrow link.
  const kept = textLength(content);
  if (kept < MIN_CONTENT_CHARS || (bodyChars > BIG_BODY_CHARS && kept < bodyChars * MIN_KEPT_SHARE)) {
    const fallback = await quiet(() => new Readability(padInline(parseHTML(html).document) as never).parse());
    const got = textLength(fallback?.content ?? '');
    if (fallback && got >= kept && (kept < MIN_CONTENT_CHARS || got >= kept * 2)) {
      if (content) warnings.push({ code: 'fallback-extractor', detail: 'readability' });
      content = fallback.content ?? '';
      title ??= fallback.title || undefined;
      language ??= fallback.lang || undefined;
    }
  }

  // An app shell shows a spinner's worth of text and leaves the rest to
  // JavaScript; "Loading…" is not an article. A declared article container
  // that is empty says the same thing however much menu text surrounds it.
  // An empty article container only matters when the cleaner found nothing
  // substantial elsewhere: many themes leave an unused container in the DOM.
  // A product page whose main region holds a few hundred characters of
  // visible prose under a hundred kilobytes of script is the same shell.
  // Heavy markup, scripts, and almost no prose in the main region: the
  // fallback extractor may still scrape menus into `content`, so the main
  // region is what is measured, not the extraction.
  const rendered = textLength(content);
  const heavyShell = scripted(original) && bodyChars < EMPTY_BODY_CHARS && html.length > SHELL_MIN_HTML;
  if ((clientRendered === 'container' && rendered < EMPTY_CONTAINER_MAX_CHARS) || (clientRendered === 'body' && rendered < MIN_CONTENT_CHARS) || heavyShell) {
    warnings.push({ code: 'empty-without-js', detail: clientRendered === 'container' ? 'the article container is empty; its text is loaded by script' : `${bodyChars} visible characters on a scripted page` });
  } else if (textLength(content) === 0) {
    warnings.push({ code: 'no-main-content' });
  }

  if (options.trace) dropped.push(...(await harvestRemovals(html, url)));

  const built = toBlocks(content, buildIdIndex(original));
  dropped.push(...built.dropped);

  return { html: content, title, dates, language, blocks: built.blocks, warnings, dropped, bodyChars, paywalled };
}

/** Subscription walls in the languages of the benchmark, plus the schema.org flag. */
const PAYWALL_TEXT =
  /(subscribe to (continue|read)|subscribers only|for subscribers|sign in to continue reading|réservé aux abonnés|article réservé|abonnez-vous pour lire|nur für abonnenten|können den artikel leider nicht|mit spiegel\+|solo para suscriptores|suscríbete para seguir|только для подписчиков|доступно по подписке|подпишитесь, чтобы (читать|продолжить)|לרכישת מנוי|למנויים בלבד)/iu;

function looksPaywalled(document: Document): false | 'declared' | 'stated' {
  const title = document.querySelector('title')?.textContent ?? '';
  if (/^\(S\+\)|\bpremium\b|\bpaywall\b/i.test(title)) return 'stated';
  // Only what a reader sees in the article region counts: a hidden print
  // dialog saying "printing is for subscribers" is not a wall.
  if (PAYWALL_TEXT.test(readerText(document))) return 'stated';
  // Google's paywall markup names the walled element: hasPart.cssSelector.
  // If that element came through with its text, the wall was not applied
  // to this response; if it is missing or nearly empty, this is the teaser.
  const walled = wallSelectors(jsonLdValue(document, 'hasPart'));
  for (const selector of walled) {
    let el: Element | null = null;
    try {
      el = document.querySelector(selector);
    } catch {
      continue;
    }
    const text = (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
    // A short news brief is walled in full too: the part is most of the page.
    // But a part that ends in "Loading…" is waiting for the rest.
    const truncated = LOADING_TAIL.test(text);
    const served = !truncated && (text.length >= WALLED_PART_MIN_CHARS || text.length >= readerText(document).trim().length * WALLED_PART_MIN_SHARE);
    return served ? false : 'stated';
  }
  // Sites set the schema.org flag on every article for the search engines'
  // sake and still serve the whole text; the flag alone is a weak signal.
  const flag = jsonLdValue(document, 'isAccessibleForFree');
  if (flag === false || flag === 'false') return 'declared';
  return false;
}

/** A walled part that still carries this much text was served in full. */
const WALLED_PART_MIN_CHARS = 1500;
/** …or this share of everything a reader sees on the page: a brief is short and whole. */
const WALLED_PART_MIN_SHARE = 0.6;
/** A walled part that ends with a loading marker is the teaser, whatever its size. */
const LOADING_TAIL = /(?:loading|טוען|загрузка|chargement|cargando|wird geladen|caricamento)[.…\s]*$/iu;

/** CSS selectors of the parts JSON-LD marks as not free. */
function wallSelectors(hasPart: unknown): string[] {
  const parts = Array.isArray(hasPart) ? hasPart : hasPart ? [hasPart] : [];
  const out: string[] = [];
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    const notFree = p.isAccessibleForFree === false || p.isAccessibleForFree === 'false';
    if (notFree && typeof p.cssSelector === 'string' && p.cssSelector.trim()) out.push(p.cssSelector.trim());
  }
  return out;
}

/**
 * Puts a space between inline siblings that touch: `<span>20 сентября
 * 2026</span><span>10 мин</span>` would otherwise be unwrapped by the cleaner
 * into one text node reading "202610 мин", and by then the boundary is gone
 * for good. Done on the parsed document before extraction; the page's own
 * whitespace is never removed, only added where two elements meet.
 */
export function padInline(document: Document): Document {
  const PAD = new Set(['a', 'span', 'b', 'i', 'em', 'strong', 'time', 'abbr', 'cite', 'small', 'mark', 'sup', 'sub', 'label', 'font']);
  for (const el of Array.from(document.querySelectorAll(Array.from(PAD).join(',')))) {
    // Code is set with its own whitespace; syntax-highlighting spans must not
    // turn `"id"` into `" id "`.
    if (el.closest('pre, code, textarea, kbd, samp')) continue;
    const prev = el.previousSibling;
    if (prev && prev.nodeType === ELEMENT_NODE) {
      el.parentNode?.insertBefore(document.createTextNode(' '), el);
    }
  }
  return document;
}

/**
 * Runs an extractor with the console muted. Both Defuddle and Readability
 * write diagnostics to stdout/stderr on odd input; on a stdio MCP transport
 * a stray line corrupts the protocol.
 */
async function quiet<T>(fn: () => T | Promise<T>): Promise<T> {
  const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const mute = () => {};
  console.log = console.info = console.warn = console.error = console.debug = mute;
  try {
    return await fn();
  } finally {
    Object.assign(console, saved);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function textLength(fragment: string): number {
  return fragment.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length;
}

/**
 * Characters a reader would actually see — measured on the page's own main
 * region when it declares one (`main`, `[role=main]`, `#content`), else the
 * body. A Wikipedia stub has 400 characters of article inside 30 000 of
 * menus; judging "thin" against the menus would flag every short article.
 */
/**
 * Old RFCs start with `<pre>` and no `<html>` or `<body>`; the WHATWG specs
 * omit the `<body>` start tag. The parser then leaves the text outside an
 * empty body, and every extractor that starts from `document.body` finds
 * nothing. Wrap such documents once, before anything reads them.
 */
function ensureBody(html: string): string {
  if (/<body[\s>]/i.test(html)) return html;
  // Done on the text, not the tree: the parser scatters a body-less document
  // across the head, the root and the document itself.
  const headMatch = /<head[\s>][\s\S]*?<\/head>/i.exec(html);
  const head = headMatch ? headMatch[0] : '<head></head>';
  let rest = headMatch ? html.slice(0, headMatch.index) + html.slice(headMatch.index + headMatch[0].length) : html;
  rest = rest.replace(/<!doctype[^>]*>/i, '').replace(/<\/?html[^>]*>/gi, '');
  return `<!DOCTYPE html><html>${head}<body>${rest}</body></html>`;
}

/** The element to measure: the body, or the whole tree when the body came out empty. */
function pageRoot(document: Document): Element | undefined {
  const body = document.body;
  if (body && (body.textContent ?? '').trim()) return body;
  return document.documentElement ?? body ?? undefined;
}

/**
 * The main region: the largest of the usual containers, and only when it
 * holds a real share of the page. A `#content` that is a table of contents
 * (RFC 9110) must not stand in for a 400 000-character document.
 */
function mainRegion(root: Element): Element {
  let best: Element | undefined;
  let bestLen = 0;
  for (const el of Array.from(root.querySelectorAll('main, [role="main"], #content, #main, article'))) {
    const len = (el.textContent ?? '').trim().length;
    if (len > bestLen) {
      best = el;
      bestLen = len;
    }
  }
  const rootLen = (root.textContent ?? '').trim().length;
  return best && bestLen > 200 && bestLen >= rootLen * MAIN_REGION_MIN_SHARE ? best : root;
}

/** A container that holds less than this share of the page's text is not the main region. */
const MAIN_REGION_MIN_SHARE = 0.3;
/** A document this big that yields under MIN_KEPT_SHARE of itself was mis-extracted, not cleaned. */
const BIG_BODY_CHARS = 20_000;
const MIN_KEPT_SHARE = 0.2;

/** The article region's visible text with chrome and hidden elements removed. */
function readerText(document: Document): string {
  const body = pageRoot(document)?.cloneNode(true) as Element | undefined;
  if (!body) return '';
  for (const el of Array.from(body.querySelectorAll('script,style,noscript,template,svg,nav,header,footer,aside,dialog,[hidden],[aria-hidden="true"],[style*="display:none"],[style*="display: none"]'))) el.remove();
  return (mainRegion(body).textContent ?? '').replace(/\s+/g, ' ');
}

function visibleTextLength(document: Document): number {
  // Work on a copy: the original document still feeds the id index.
  const body = pageRoot(document)?.cloneNode(true) as Element | undefined;
  if (!body) return 0;
  for (const el of Array.from(body.querySelectorAll('script,style,noscript,template,svg,nav,header,footer,aside'))) el.remove();
  const region = mainRegion(body);
  // Prose only: menus, navboxes and category rows are made of links, and a
  // stub article surrounded by them must not be judged against them.
  for (const a of Array.from(region.querySelectorAll('a'))) a.remove();
  return (region.textContent ?? '').replace(/\s+/g, ' ').trim().length;
}

/** Containers that sites use for the article body; if one is declared and empty, the text comes by script. */
const ARTICLE_BODY =
  'article, [itemprop="articleBody"], [class*="article__body"], [class*="article-body"], [class*="articleBody"], [class*="post-content"], [class*="entry-content"], [class*="article__text"]';

/**
 * A page written for a browser, not for us: either the whole body is a
 * mount point, or the page declares an article container and leaves it
 * empty for JavaScript to fill (ria.ru keeps 131 characters in it).
 */
function looksClientRendered(document: Document): 'body' | 'container' | false {
  const body = pageRoot(document);
  if (!body) return false;
  // Scripts may all sit in <head>; count the whole document.
  const scripts = document.querySelectorAll('script').length;
  if (scripts === 0) return false;
  const text = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < 200) return 'body';
  const containers = Array.from(body.querySelectorAll(ARTICLE_BODY));
  if (!containers.length) return false;
  const longest = Math.max(...containers.map((c) => (c.textContent ?? '').replace(/\s+/g, ' ').trim().length));
  return longest < 300 ? 'container' : false;
}

/**
 * Defuddle only reports what it removed in debug mode, and debug mode both
 * logs to the console and changes its own behaviour. So the trace comes from
 * a second, silenced pass, and the result the caller gets is always from the
 * normal one: tracing must never alter output.
 */
async function harvestRemovals(html: string, url: string): Promise<Dropped[]> {
  try {
    const pass = await quiet(() => Defuddle(padInline(parseHTML(html).document), url, { useAsync: false, debug: true }));
    return (pass.debug?.removals ?? []).map((removal) => {
      const entry: Dropped = { step: removal.step, text: excerpt(removal.text) };
      if (removal.reason) entry.reason = removal.reason;
      if (removal.selector) entry.selector = removal.selector;
      return entry;
    });
  } catch {
    return [];
  }
}

function excerpt(text: string): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 120 ? `${clean.slice(0, 117)}…` : clean;
}

/**
 * Text → id for every element in the original page that had an id. The
 * cleaners strip ids on their way through, so this is how a block finds its
 * way back to a real fragment link.
 */
export function buildIdIndex(document: Document): Map<string, string> {
  const index = new Map<string, string>();
  for (const el of Array.from(document.querySelectorAll('[id]'))) {
    const text = normalize(textOf(el));
    if (text && text.length <= 400 && !index.has(text)) index.set(text, el.id);
  }
  return index;
}

// --- Text of an element -----------------------------------------------------

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/** Tags that never contribute readable text. */
const SILENT = new Set(['script', 'style', 'noscript', 'template', 'svg', 'iframe']);

/** A superscript that is only a footnote marker: "[65]", "49", "†". */
const FOOTNOTE = /^\s*\[?[\d,\s–-]+\]?\s*$|^\s*[*†‡]+\s*$/;

/**
 * Reads an element's text the way a reader sees it: a space where two
 * elements meet (so `<span>20 сентября</span><span>10 мин</span>` does not
 * become "202610 мин"), a newline for <br>, and no footnote markers.
 */
export function textOf(el: Element): string {
  let out = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === TEXT_NODE) {
      out += node.textContent ?? '';
    } else if (node.nodeType === ELEMENT_NODE) {
      const child = node as Element;
      const tag = child.tagName.toLowerCase();
      if (SILENT.has(tag)) continue;
      if (tag === 'br') {
        out += '\n';
        continue;
      }
      // Footnote markers: "<sup>[65]</sup>", "<a>[12]</a>", "<sup>49</sup>".
      if ((tag === 'sup' || tag === 'a') && FOOTNOTE.test(child.textContent ?? '')) continue;
      out += ` ${textOf(child)} `;
    }
  }
  return out;
}

// --- Blocks -------------------------------------------------------------------

const HEADING = /^h([1-6])$/;

/** Elements whose children we descend into rather than reading as one block. */
const CONTAINERS = new Set([
  'div', 'section', 'article', 'main', 'body', 'header', 'figure', 'figcaption', 'details', 'summary',
  'center', 'font', 'span', 'li', 'dd', 'dt', 'dl', 'form', 'fieldset', 'label',
  // A cleaner may hand back a lone table cell holding the whole essay.
  'td', 'th', 'tr', 'tbody', 'thead', 'tfoot',
]);

/** Elements we never read: navigation and decoration that slipped past the cleaner. */
const SKIP = new Set(['script', 'style', 'noscript', 'svg', 'nav', 'aside', 'footer', 'template', 'iframe', 'button', 'input', 'select']);

/** A list this long is an index or a bibliography; one block would blow the budget. */
const LIST_ITEMS_PER_BLOCK = 60;

export interface Built {
  blocks: Block[];
  dropped: Dropped[];
}

/**
 * Walks the cleaned article and flattens it into blocks. The walk is in
 * document order and ids are positional, which is what makes two runs over
 * the same HTML produce the same ids. Loose text and inline runs inside a
 * container become paragraphs of their own — old pages set whole essays
 * that way, with <br><br> instead of <p>.
 */
export function toBlocks(articleHtml: string, ids: Map<string, string> = new Map()): Built {
  // linkedom needs a full document; a bare <body> fragment parses into an
  // empty `document.body`.
  const { document } = parseHTML(`<!doctype html><html><body>${articleHtml}</body></html>`);
  const root = document.querySelector('body') ?? document.documentElement;
  const blocks: Block[] = [];
  const headings: { level: number; text: string; id?: string }[] = [];

  // The element's own id if the cleaner left it, else the id the same text
  // carried in the original page.
  const idOf = (el: Element | undefined, text: string) => el?.id || ids.get(text);

  const push = (kind: BlockKind, text: string, el: Element | undefined, level?: number) => {
    const clean = normalize(text);
    if (!clean) return;
    const block: Block = { id: `b${blocks.length + 1}`, kind, text: clean };
    if (level !== undefined) block.level = level;
    const anchor = anchorFor(idOf(el, clean), headings);
    if (anchor) block.anchor = anchor;
    blocks.push(block);
  };

  const walk = (node: Element) => {
    // Loose text and inline elements accumulate here until a block-level
    // child or a blank line closes the paragraph.
    let pending = '';
    const flush = () => {
      for (const para of pending.split(/\n\s*\n/)) push('paragraph', para, undefined);
      pending = '';
    };

    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        pending += child.textContent ?? '';
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toLowerCase();
      if (SKIP.has(tag)) continue;

      if (tag === 'br') {
        pending += '\n';
        continue;
      }
      if (isInline(tag)) {
        pending += ` ${textOf(el)} `;
        continue;
      }

      flush();
      const heading = HEADING.exec(tag);
      if (heading) {
        const level = Number(heading[1]);
        const text = normalize(textOf(el));
        // Keep the heading trail current before anchoring the heading itself.
        while (headings.length && headings[headings.length - 1]!.level >= level) headings.pop();
        headings.push({ level, text, id: idOf(el, text) });
        push('heading', text, el, level);
      } else if (tag === 'p') {
        // A <p> that holds a whole essay separated by <br><br> is several
        // paragraphs; one block that size would only get split mid-thought.
        for (const para of textOf(el).split(/\n\s*\n/)) push('paragraph', para, el);
      } else if (tag === 'ul' || tag === 'ol') {
        const items = Array.from(el.children)
          .filter((li) => li.tagName.toLowerCase() === 'li')
          .map((li) => `- ${normalize(textOf(li))}`);
        for (let i = 0; i < items.length; i += LIST_ITEMS_PER_BLOCK) {
          push('list', items.slice(i, i + LIST_ITEMS_PER_BLOCK).join('\n'), el);
        }
      } else if (tag === 'table') {
        push('table', tableText(el), el);
      } else if (tag === 'pre') {
        push('code', el.textContent ?? '', el);
      } else if (tag === 'blockquote') {
        push('quote', textOf(el), el);
      } else if (CONTAINERS.has(tag)) {
        walk(el);
      } else {
        // Unknown block-level element: read it as paragraphs.
        for (const para of textOf(el).split(/\n\s*\n/)) push('paragraph', para, el);
      }
    }
    flush();
  };

  walk(root);
  return dropChrome(blocks);
}

const INLINE = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'cite', 'code', 'data', 'dfn', 'em', 'i', 'kbd', 'mark', 'q', 's',
  'samp', 'small', 'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr', 'img', 'picture', 'source',
]);

function isInline(tag: string): boolean {
  return INLINE.has(tag);
}

/**
 * Rows as "Header: cell | Header: cell" when the table has a header row, so a
 * number keeps the column it was measured in; plain "cell | cell" otherwise.
 */
function tableText(table: Element): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  const headerCells = rows[0] ? Array.from(rows[0].querySelectorAll('th')) : [];
  const headers = headerCells.length ? headerCells.map((c) => normalize(textOf(c))) : [];
  const lines: string[] = [];
  for (const [i, tr] of rows.entries()) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((c) => normalize(textOf(c)));
    if (i === 0 && headers.length) {
      lines.push(headers.join(' | '));
      continue;
    }
    if (headers.length && cells.length === headers.length) {
      lines.push(cells.map((c, j) => `${headers[j]}: ${c}`).join(' | '));
    } else {
      lines.push(cells.join(' | '));
    }
  }
  return lines.join('\n');
}

/** Words that mark a byline: reading time, publication verbs. */
const BYLINE = /(мин(?:ут)?\.? чтения|min(?:ute)?s? read|опубликовано|published|posted on|updated on|обновлено)/iu;
/** A trailing call to action, not part of the article. */
const CTA = /^(читайте (также|наш|ещё)|read (more|next|also)|подписывайтесь|subscribe|share this|поделиться)/iu;

/**
 * Page chrome that survives the cleaners: the byline line under the title,
 * a row of topic tags, a closing "read more". Cheap rules, applied only near
 * the edges of the article, each removal recorded for the trace.
 */
export function dropChrome(blocks: Block[]): Built {
  const dropped: Dropped[] = [];
  const keep: Block[] = [];
  const top = 6;

  blocks.forEach((b, i) => {
    const nearTop = i < top;
    const nearEnd = i >= blocks.length - 2;
    const words = b.text.split(/\s+/).length;
    const noPunct = !/[.!?:;,]/.test(b.text);

    if (nearTop && b.kind === 'paragraph' && b.text.length < 240 && BYLINE.test(b.text)) {
      dropped.push({ step: 'sieve:byline', reason: 'byline near the top', text: excerpt(b.text) });
      return;
    }
    if (nearTop && i > 0 && b.kind === 'paragraph' && b.text.length < 90 && noPunct && words >= 2 && words <= 8 && /\p{Lu}/u.test(b.text)) {
      dropped.push({ step: 'sieve:tags', reason: 'tag row near the top', text: excerpt(b.text) });
      return;
    }
    if (nearEnd && b.kind === 'paragraph' && b.text.length < 200 && CTA.test(b.text)) {
      dropped.push({ step: 'sieve:cta', reason: 'trailing call to action', text: excerpt(b.text) });
      return;
    }
    keep.push(b);
  });

  // Ids stay positional after removals.
  const blocksRenumbered = keep.map((b, i) => ({ ...b, id: `b${i + 1}` }));
  return { blocks: blocksRenumbered, dropped };
}

/**
 * Collapses whitespace and undoes the spaces that element boundaries put
 * next to punctuation ("word ." → "word.", "( lit." → "(lit.").
 */
function normalize(text: string): string {
  // Line breaks carry structure — a table row, a list item, a line of code —
  // so they survive; every other run of whitespace becomes one space.
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[^\S\n]+([.,;:!?%)\]»])/g, '$1')
    .replace(/([(\[«])[^\S\n]+/g, '$1')
    .trim();
}

/**
 * Anchor resolution, most reliable first: the element's own id, then the id
 * of the nearest heading above, then the heading trail as readable text.
 * A content hash would always exist, but nobody can follow it, so we do not
 * pretend it is an anchor.
 */
function anchorFor(ownId: string | undefined, trail: { level: number; text: string; id?: string }[]): string | undefined {
  if (ownId) return `#${ownId}`;
  for (let i = trail.length - 1; i >= 0; i--) {
    const id = trail[i]?.id;
    if (id) return `#${id}`;
  }
  if (trail.length) return trail.map((h) => h.text).join(' > ');
  return undefined;
}
