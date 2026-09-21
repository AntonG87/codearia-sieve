/**
 * Dates: from markup first, from prose last.
 *
 * The order mirrors what htmldate measured on a thousand pages: structured
 * sources (JSON-LD, meta tags, <time datetime>) are exact and need no
 * parsing; text heuristics come last because that is where the errors live.
 * A System One model reads "15 сентября 2026" as text and cannot order it,
 * so every value leaves here as YYYY-MM-DD.
 */

export interface ParseDateOptions {
  /** Reference point for relative wording such as "вчера". Defaults to now. */
  now?: Date;
  /**
   * How to read an all-numeric date whose day and month are both <= 12.
   * "DMY" reads 09/10/2026 as 9 October, "MDY" as 10 September. With no
   * preference an ambiguous date is abstained from, not guessed.
   */
  prefer?: 'DMY' | 'MDY';
}

const MONTHS: Record<string, number> = {
  // English, full and short.
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
  // Russian: genitive (as it appears after a day number) and nominative.
  января: 1, январь: 1, февраля: 2, февраль: 2, марта: 3, март: 3,
  апреля: 4, апрель: 4, мая: 5, май: 5, июня: 6, июнь: 6, июля: 7, июль: 7,
  августа: 8, август: 8, сентября: 9, сентябрь: 9, октября: 10, октябрь: 10,
  ноября: 11, ноябрь: 11, декабря: 12, декабрь: 12,
};

const MONTH_WORD = Object.keys(MONTHS).join('|');
const ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/;
const DAY_MONTH_YEAR = new RegExp(`(?<!\\d)(\\d{1,2})\\s+(${MONTH_WORD})\\.?,?\\s+(\\d{4})(?!\\d)`, 'i');
const MONTH_DAY_YEAR = new RegExp(`\\b(${MONTH_WORD})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})(?!\\d)`, 'i');
const NUMERIC = /(?<!\d)(\d{1,2})[./](\d{1,2})[./](\d{4})(?!\d)/;
const DAYS_AGO = /(?<!\d)(\d{1,3})\s+(?:days?|дн(?:я|ей|ь))\s+(?:ago|назад)/i;

/**
 * Returns an ISO date (YYYY-MM-DD), or undefined when the input carries no
 * date we can trust. Guessing is worse than abstaining: a wrong date silently
 * corrupts every decision made downstream.
 */
export function parseDate(input: string, options: ParseDateOptions = {}): string | undefined {
  const text = input.trim();
  if (!text) return undefined;

  const iso = ISO.exec(text);
  if (iso) return toISO(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const dmy = DAY_MONTH_YEAR.exec(text);
  if (dmy) return toISO(Number(dmy[3]), month(dmy[2]), Number(dmy[1]));

  const mdy = MONTH_DAY_YEAR.exec(text);
  if (mdy) return toISO(Number(mdy[3]), month(mdy[1]), Number(mdy[2]));

  const numeric = NUMERIC.exec(text);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = Number(numeric[3]);
    // A value over 12 settles the order by itself; otherwise ask the caller.
    if (a > 12 && b <= 12) return toISO(year, b, a);
    if (b > 12 && a <= 12) return toISO(year, a, b);
    if (a <= 12 && b <= 12) {
      if (options.prefer === 'DMY') return toISO(year, b, a);
      if (options.prefer === 'MDY') return toISO(year, a, b);
    }
    return undefined;
  }

  return relative(text, options.now ?? new Date());
}

function month(word: string | undefined): number {
  return MONTHS[(word ?? '').toLowerCase()] ?? 0;
}

/** Rejects dates that do not exist, such as 31 February. */
function toISO(year: number, month: number, day: number): string | undefined {
  if (!year || !month || !day) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  const valid =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? date.toISOString().slice(0, 10) : undefined;
}

function relative(text: string, now: Date): string | undefined {
  const lower = text.toLowerCase();
  const shift = (days: number) => {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  // `\b` is ASCII-only in JS regexes, so Cyrillic words need explicit
  // letter lookarounds.
  if (/(?<!\p{L})(сегодня|today)(?!\p{L})/u.test(lower)) return shift(0);
  if (/(?<!\p{L})(вчера|yesterday)(?!\p{L})/u.test(lower)) return shift(1);
  if (/(?<!\p{L})позавчера(?!\p{L})/u.test(lower)) return shift(2);
  const ago = DAYS_AGO.exec(lower);
  if (ago) return shift(Number(ago[1]));
  return undefined;
}

// --- Markup tiers ---------------------------------------------------------

export interface FoundDates {
  publishedAt?: string;
  updatedAt?: string;
  /** Which tier answered, for the trace: "json-ld", "meta", "time". */
  source?: string;
}

const PUBLISHED_META = [
  'article:published_time', 'og:published_time', 'datePublished', 'date',
  'dc.date', 'dc.date.issued', 'dcterms.created', 'citation_publication_date',
  'citation_date', 'sailthru.date', 'pubdate', 'publish_date', 'parsely-pub-date',
];
const MODIFIED_META = [
  'article:modified_time', 'og:updated_time', 'dateModified', 'last-modified',
  'dc.date.modified', 'dcterms.modified',
];

/**
 * Looks for the page's dates where they are stated outright. Each tier is a
 * list of candidates tried in order, the first valid one wins, the same shape
 * Defuddle uses for its metadata getters.
 */
export function findDates(document: Document): FoundDates {
  const tiers: { source: string; published: () => string | undefined; updated: () => string | undefined }[] = [
    {
      source: 'json-ld',
      published: () => fromJsonLd(document, 'datePublished'),
      updated: () => fromJsonLd(document, 'dateModified'),
    },
    {
      source: 'meta',
      published: () => fromMeta(document, PUBLISHED_META),
      updated: () => fromMeta(document, MODIFIED_META),
    },
    {
      source: 'time',
      published: () => fromTime(document, 'datePublished'),
      updated: () => fromTime(document, 'dateModified'),
    },
  ];

  const found: FoundDates = {};
  for (const tier of tiers) {
    if (!found.publishedAt) {
      const value = tier.published();
      const date = value && parseDate(value);
      if (date) {
        found.publishedAt = date;
        found.source = tier.source;
      }
    }
    if (!found.updatedAt) {
      const value = tier.updated();
      const date = value && parseDate(value);
      if (date) found.updatedAt = date;
    }
    if (found.publishedAt && found.updatedAt) break;
  }
  return found;
}

/** Any JSON-LD value by key, for signals beyond dates (e.g. isAccessibleForFree). */
export function jsonLdValue(document: Document, key: string): unknown {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const data = parseJsonLd(script.textContent ?? '');
    if (data === undefined) continue;
    const hit = findAny(data, key);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function findAny(node: unknown, key: string, depth = 0): unknown {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findAny(item, key, depth + 1);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  if (key in record) return record[key];
  for (const value of Object.values(record)) {
    const hit = findAny(value, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

function fromJsonLd(document: Document, key: string): string | undefined {
  for (const script of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    const data = parseJsonLd(script.textContent ?? '');
    if (data === undefined) continue;
    const hit = findKey(data, key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Real-world JSON-LD is often not quite JSON: a trailing semicolon, an HTML
 * comment wrapper, two objects back to back. A date lost to a stray `;` is a
 * date lost for nothing, so the parse is tolerant before it gives up.
 */
export function parseJsonLd(raw: string): unknown {
  const text = raw.replace(/^\s*<!--/, '').replace(/-->\s*$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // Cut whatever follows the last closing brace or bracket and retry.
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (end > 0) {
      try {
        return JSON.parse(text.slice(0, end + 1));
      } catch {
        // fall through
      }
    }
    // Several top-level objects in one script: wrap them into an array.
    try {
      return JSON.parse(`[${text.replace(/}\s*;?\s*{/g, '},{').replace(/;\s*$/, '')}]`);
    } catch {
      return undefined;
    }
  }
}

/** Depth-first search through JSON-LD, which nests freely and uses @graph. */
function findKey(node: unknown, key: string, depth = 0): string | undefined {
  if (depth > 6 || node === null || typeof node !== 'object') return undefined;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findKey(item, key, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const own = record[key];
  if (typeof own === 'string' && own) return own;
  for (const value of Object.values(record)) {
    const hit = findKey(value, key, depth + 1);
    if (hit) return hit;
  }
  return undefined;
}

function fromMeta(document: Document, names: string[]): string | undefined {
  for (const name of names) {
    const el =
      document.querySelector(`meta[property="${name}" i]`) ??
      document.querySelector(`meta[name="${name}" i]`) ??
      document.querySelector(`meta[itemprop="${name}" i]`);
    const content = el?.getAttribute('content')?.trim();
    if (content) return content;
  }
  return undefined;
}

function fromTime(document: Document, itemprop: string): string | undefined {
  const specific = document.querySelector(`time[itemprop="${itemprop}" i][datetime]`);
  if (specific) return specific.getAttribute('datetime') ?? undefined;
  if (itemprop !== 'datePublished') return undefined;
  const pub = document.querySelector('time[pubdate][datetime]') ?? document.querySelector('time[datetime]');
  return pub?.getAttribute('datetime') ?? undefined;
}

/** Words that mark a byline; prose is only consulted where one of these appears. */
const BYLINE = /(?<!\p{L})(published|posted|updated|опубликовано|обновлено|дата)(?!\p{L})/iu;

/**
 * Last resort: a short line near the top that announces itself as a byline.
 * Anything longer or unlabelled is left alone — a paragraph can mention any
 * date at all, and using it would be a guess.
 */
export function fromByline(lines: string[], options: ParseDateOptions = {}): string | undefined {
  for (const line of lines) {
    if (line.length > 160) continue;
    // A line that opens with an ISO date announces itself without a word:
    // release notes and changelogs are written "2025-02-11, Version 22.14.0".
    const iso = /^(\d{4}-\d{2}-\d{2})(?!\d)/.exec(line);
    if (iso) {
      const date = parseDate(iso[1]!, options);
      if (date) return date;
    }
    if (!BYLINE.test(line)) continue;
    const date = parseDate(line, options);
    if (date) return date;
  }
  return undefined;
}
