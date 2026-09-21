/**
 * Numbers: lifted out of prose with their unit, or left alone.
 *
 * A quantity only becomes a fact when the text says what it measures: a
 * currency sign, a percent, a unit word. A bare number is not a fact, it is a
 * guess, and the decision model downstream cannot tell the difference.
 *
 * Separators depend on the language. "0,114" is a fraction in Russian and
 * "1,200" is a thousand in English; reading one with the other's rule turns
 * 0.114 seconds into 114 — a thousandfold error presented as a fact. So the
 * page's language chooses the rule, and when it is unknown we only accept
 * what is unambiguous.
 */

import type { Block, Fact } from '../types.ts';

const CURRENCY_SIGNS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₪': 'ILS', '₽': 'RUB', '¥': 'JPY' };
// `\b` is ASCII-only in JS regexes; the lookahead is the Unicode-aware boundary.
const CURRENCY_CODES = /^(USD|EUR|GBP|ILS|RUB|JPY|CHF|UAH|KZT)(?!\p{L})/iu;

/** Unit words, longest first so "requests" wins over "req". */
const UNITS: [RegExp, string][] = [
  [/^(?:tokens?|токен(?:ов|а)?)(?!\p{L})/iu, 'token'],
  [/^(?:requests?|запрос(?:ов|а)?|req)(?!\p{L})/iu, 'request'],
  [/^(?:milliseconds?|ms|мс)(?!\p{L})/iu, 'ms'],
  // Cyrillic "с." with a period is a page count in a citation ("— 256 с."), not seconds.
  [/^(?:seconds?|sec|s|сек(?:унд[аы]?)?|с(?!\.))(?!\p{L})/iu, 's'],
  [/^(?:minutes?|min|мин(?:ут[аы]?)?)(?!\p{L})/iu, 'min'],
  [/^(?:hours?|h|час(?:ов|а)?)(?!\p{L})/iu, 'h'],
  [/^(?:days?|дн(?:ей|я)|день)(?!\p{L})/iu, 'day'],
  [/^(?:TB|ТБ)(?!\p{L})/u, 'TB'],
  [/^(?:GB|ГБ)(?!\p{L})/u, 'GB'],
  [/^(?:MB|МБ)(?!\p{L})/u, 'MB'],
  [/^(?:KB|kB|КБ)(?!\p{L})/u, 'KB'],
  [/^(?:px|пикс(?:ел(?:ей|я)?)?)(?!\p{L})/iu, 'px'],
  [/^(?:pages?|страниц[аы]?)(?!\p{L})/iu, 'page'],
  [/^(?:words?|слов[оа]?)(?!\p{L})/iu, 'word'],
  [/^(?:users?|пользовател(?:ей|я|ь))(?!\p{L})/iu, 'user'],
  [/^(?:views?|просмотр(?:ов|а)?)(?!\p{L})/iu, 'view'],
];

/** "per million", "/ M", "за миллиард" → appended to the unit as a rate. */
const RATES: [RegExp, string][] = [
  [/^(?:per|\/|за|в|на)\s*(?:million|M|mln|млн|миллион(?:а|ов)?)(?!\p{L})/iu, 'per_million'],
  [/^(?:per|\/|за|в|на)\s*(?:billion|B|bn|млрд|миллиард(?:а|ов)?)(?!\p{L})/iu, 'per_billion'],
  [/^(?:per|\/|за|в|на)\s*(?:thousand|K|тыс\.?|тысяч[уи]?)(?!\p{L})/iu, 'per_thousand'],
  [/^(?:per|\/|в|за)\s*(?:second|sec|s|секунду|с)(?!\p{L})/iu, 'per_s'],
  [/^(?:per|\/|в|за)\s*(?:minute|min|минуту|мин)(?!\p{L})/iu, 'per_min'],
  [/^(?:per|\/|в|за)\s*(?:hour|h|час)(?!\p{L})/iu, 'per_h'],
  [/^(?:per|\/|в|за)\s*(?:month|mo|месяц)(?!\p{L})/iu, 'per_month'],
  [/^(?:per|\/|в|за)\s*(?:year|yr|год)(?!\p{L})/iu, 'per_year'],
];

/** Rate phrases as they appear in table headers, anywhere in the cell before the number. */
const HEADER_RATES: [RegExp, string][] = [
  [/(?:per|\/|за|на)\s*(?:billion|B|bn|Btok|млрд|миллиард)(?!\p{L})/iu, 'per_billion'],
  [/(?:per|\/|за|на)\s*(?:million|M|mln|Mtok|млн|миллион)(?!\p{L})/iu, 'per_million'],
  [/(?:per|\/|за|на)\s*(?:thousand|K|Ktok|тыс|тысяч)(?!\p{L})/iu, 'per_thousand'],
  [/(?:per|\/|в)\s*(?:second|sec|секунду)(?!\p{L})/iu, 'per_s'],
  [/(?:per|\/|в)\s*(?:minute|min|минуту)(?!\p{L})/iu, 'per_min'],
  [/(?:per|\/|в)\s*(?:hour|час)(?!\p{L})/iu, 'per_h'],
  [/(?:per|\/|в)\s*(?:month|mo|месяц)(?!\p{L})/iu, 'per_month'],
  [/(?:per|\/|в)\s*(?:year|yr|год)(?!\p{L})/iu, 'per_year'],
];

/** Word multipliers that follow a number: "250 thousand", "3 млн", "188 тысяч". */
const SCALES: [RegExp, number][] = [
  [/^(?:thousand|тыс\.?|тысяч[иа]?)(?!\p{L})/iu, 1e3],
  [/^(?:million|mln|млн\.?|миллион(?:а|ов)?)(?!\p{L})/iu, 1e6],
  [/^(?:billion|bn|млрд\.?|миллиард(?:а|ов)?)(?!\p{L})/iu, 1e9],
];

/**
 * A number token: digits with optional separators inside. How the separators
 * are read is decided afterwards, per language.
 */
const NUMBER = /(?<![\w.,])([-+]?)(\d(?:[\d ,. ]*\d)?)(?![\d])/g;

/** A lower bound written right before the number: "3–329 секунд", "70-500 ms". */
const RANGE_LOW = /(\d+(?:[.,]\d+)?)\s*[–—-]\s*$/;

const MAX_FACTS = 200;
const CONTEXT_CHARS = 220;

export type NumberLocale = 'ru' | 'en' | 'unknown';

/** Language tag → separator convention. Only the prefix matters. */
export function localeFor(language?: string): NumberLocale {
  const tag = (language ?? '').toLowerCase();
  if (/^(ru|uk|be|kk|de|fr|es|it|pl|cs|tr|he)/.test(tag)) return 'ru';
  if (/^(en|ja|zh|ko)/.test(tag)) return 'en';
  return 'unknown';
}

/**
 * Reads a number token under a separator convention. Returns undefined when
 * the token is ambiguous and the language does not settle it.
 *
 *   ru: "1 200" and "1.200" are thousands, "0,114" is a fraction
 *   en: "1,200" is thousands, "0.114" is a fraction
 */
export function readNumber(token: string, locale: NumberLocale): number | undefined {
  const t = token.replace(/ /g, ' ').trim();
  if (!/^\d/.test(t)) return undefined;
  const spaces = (t.match(/ /g) ?? []).length;
  if (spaces > 0 && !/^\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(t)) return undefined;
  const compact = t.replace(/ /g, '');
  const seps = compact.match(/[.,]/g) ?? [];

  if (seps.length === 0) return Number(compact);

  if (seps.length === 1) {
    const sep = seps[0]!;
    const [head = '', tail = ''] = compact.split(sep);
    if (!/^\d+$/.test(head) || !/^\d+$/.test(tail)) return undefined;
    const looksGrouped = tail.length === 3 && head.length <= 3 && head !== '0' && spaces === 0;
    if (locale === 'ru') {
      if (sep === ',') return Number(`${head}.${tail}`);
      return looksGrouped ? Number(head + tail) : Number(`${head}.${tail}`);
    }
    if (locale === 'en') {
      if (sep === '.') return Number(`${head}.${tail}`);
      return looksGrouped ? Number(head + tail) : undefined;
    }
    // Unknown language: accept only what cannot be misread.
    if (head === '0' || tail.length !== 3) return Number(`${head}.${tail}`);
    return undefined;
  }

  // Several separators. All the same kind with 3-digit groups → thousands
  // ("1,234,567"); otherwise the last one is the decimal mark.
  const parts = compact.split(/[.,]/);
  const allGroups = parts.slice(1).every((g) => g.length === 3) && new Set(seps).size === 1;
  if (allGroups) return Number(parts.join(''));
  const last = Math.max(compact.lastIndexOf(','), compact.lastIndexOf('.'));
  const groups = compact.slice(0, last).replace(/[.,]/g, '');
  const frac = compact.slice(last + 1);
  if (!/^\d+$/.test(groups) || !/^\d+$/.test(frac)) return undefined;
  return Number(`${groups}.${frac}`);
}

/** Pulls every unit-bearing quantity out of the blocks, in document order. */
export function extractFacts(blocks: Block[], language?: string): Fact[] {
  const locale = localeFor(language);
  const facts: Fact[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    if (block.kind === 'code') continue;
    for (const hit of scan(block.text, locale, block.kind === 'table')) {
      const key = `${hit.value}|${hit.unit}|${hit.context}`;
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({ label: hit.label, value: hit.value, unit: hit.unit, context: hit.context, from: block.id });
      if (facts.length >= MAX_FACTS) return facts;
    }
  }
  return facts;
}

interface Hit {
  value: number;
  unit: string;
  label: string;
  context: string;
}

function scan(text: string, locale: NumberLocale, inTable = false): Hit[] {
  const hits: Hit[] = [];
  NUMBER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER.exec(text))) {
    const start = m.index;
    const end = start + m[0].length;
    const sign = m[1] === '-' ? -1 : 1;
    const read = readNumber(m[2] ?? '', locale);
    if (read === undefined) continue;
    let value = read * sign;

    const before = text.slice(Math.max(0, start - 12), start);
    const rawAfter = text.slice(end);
    // "70s", "1930s": a plural or a decade, never seventy seconds. A
    // one-letter unit glued to the number is not a unit.
    if (/^[sSсh](?!\p{L})/u.test(rawAfter)) continue;
    let after = rawAfter.replace(/^\s+/, '');
    let unit: string | undefined;

    for (const [re, factor] of SCALES) {
      const s = re.exec(after);
      if (s) {
        value *= factor;
        after = after.slice(s[0].length).replace(/^\s+/, '');
        break;
      }
    }

    const signMatch = /([$€£₪₽¥])\s?$/.exec(before);
    if (signMatch) unit = CURRENCY_SIGNS[signMatch[1] ?? ''];
    if (!unit) {
      const code = CURRENCY_CODES.exec(after);
      if (code) {
        unit = code[1]!.toUpperCase();
        after = after.slice(code[0].length).replace(/^\s+/, '');
      }
    }
    if (!unit && /^%/.test(after)) {
      unit = '%';
      after = after.slice(1).replace(/^\s+/, '');
    }
    if (!unit) {
      for (const [re, name] of UNITS) {
        const u = re.exec(after);
        if (u) {
          unit = name;
          after = after.slice(u[0].length).replace(/^\s+/, '');
          break;
        }
      }
    }

    // Without a unit the number is not a fact. Years never are.
    if (!unit) continue;

    for (const [re, rate] of RATES) {
      if (re.test(after)) {
        unit = `${unit}_${rate}`;
        break;
      }
    }
    // In a table the rate often sits in the column header, which the block
    // text carries as "Price per Btok: $42". Look back within the same cell —
    // tables only; in prose the words before a number belong to other numbers.
    if (inTable && !/_per_/.test(unit)) {
      // The cell first ("Price per Btok: $42"), then the whole row, where a
      // row header such as "Price (per Btok)" names the rate for its cells.
      const rowStart = text.lastIndexOf('\n', start) + 1;
      const cellStart = Math.max(text.lastIndexOf('|', start) + 1, rowStart);
      for (const scope of [text.slice(cellStart, start), text.slice(rowStart, start)]) {
        const found = ratesIn(scope);
        if (found.length === 1) {
          unit = `${unit}_${found[0]}`;
          break;
        }
        if (found.length > 1) {
          // "Price (per Btok / per Mtok) | $42 / $0.042": as many rates as
          // numbers in the cell value, in the same order — pair by position.
          // The value starts after the column header ("jev-1.13.0: ").
          const cellEnd = Math.min(...[text.indexOf('|', start), text.indexOf('\n', start), text.length].filter((i) => i !== -1));
          const cell = text.slice(cellStart, cellEnd);
          const colon = cell.indexOf(': ');
          const valueStart = cellStart + (colon === -1 || cellStart + colon >= start ? 0 : colon + 2);
          const numbersInCell = text.slice(valueStart, cellEnd).match(NUMBER_TOKEN) ?? [];
          const index = (text.slice(valueStart, start).match(NUMBER_TOKEN) ?? []).length;
          if (numbersInCell.length === found.length) unit = `${unit}_${found[index]}`;
          break;
        }
      }
    }

    const context = sentenceAround(text, start, end);
    const label = inTable ? rowLabel(text, start) ?? labelFor(context, unit) : labelFor(context, unit);

    // A range keeps both ends: "3–329 секунд" is two facts, not the larger one.
    const low = RANGE_LOW.exec(before);
    if (low) {
      const lowValue = readNumber(low[1] ?? '', locale);
      if (lowValue !== undefined) hits.push({ value: lowValue, unit, label: `${label}_min`, context });
      hits.push({ value, unit, label: `${label}_max`, context });
      continue;
    }
    hits.push({ value, unit, label, context });
  }
  return hits;
}

/** Rates named in a header fragment, in order of appearance, without repeats. */
function ratesIn(scope: string): string[] {
  const found: { at: number; rate: string }[] = [];
  for (const [re, rate] of HEADER_RATES) {
    const m = re.exec(scope);
    if (m && !found.some((f) => f.rate === rate)) found.push({ at: m.index, rate });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.rate);
}

/** A number token as it appears in text, for counting numbers within a cell. */
const NUMBER_TOKEN = /\d+(?:[.,\s]\d+)*/g;

/**
 * In a table the row header names what the row measures: for
 * "Jev 1.13: Price (per Btok) | jev-1.13.0: $42" that is "Price (per Btok)".
 * The first cell of the row, without its column header, gives the label.
 */
function rowLabel(text: string, start: number): string | undefined {
  const rowStart = text.lastIndexOf('\n', start) + 1;
  const rowEnd = text.indexOf('\n', start);
  const row = text.slice(rowStart, rowEnd === -1 ? undefined : rowEnd);
  const first = row.split(' | ')[0] ?? '';
  if (first.trim() === '' || text.slice(rowStart, start).indexOf(' | ') === -1) return undefined;
  const colon = first.indexOf(': ');
  const cell = colon === -1 ? first : first.slice(colon + 2);
  const words = cell
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
  return words.length ? words.slice(0, 4).join('_') : undefined;
}

/** The sentence the number sits in, trimmed to a readable length. */
function sentenceAround(text: string, start: number, end: number): string {
  const boundary = /[.!?…]\s|\n/g;
  let from = 0;
  let to = text.length;
  let b: RegExpExecArray | null;
  while ((b = boundary.exec(text))) {
    const at = b.index + b[0].length;
    if (at <= start) from = at;
    else if (b.index >= end) {
      to = b.index + 1;
      break;
    }
  }
  let s = text.slice(from, to).replace(/\s+/g, ' ').trim();
  if (s.length > CONTEXT_CHARS) {
    const mid = Math.max(0, start - from);
    const lo = Math.max(0, mid - CONTEXT_CHARS / 2);
    s = (lo > 0 ? '…' : '') + s.slice(lo, lo + CONTEXT_CHARS).trim() + '…';
  }
  return s;
}

/**
 * A short handle derived from the sentence: its first meaningful words,
 * without numbers or stop words. `context` is the readable version; the
 * label exists so a fact can be referred to in one token.
 */
function labelFor(context: string, unit: string): string {
  // A context that was cut at the front starts with a partial word; skip it.
  const whole = context.startsWith('…') ? context.slice(1).replace(/^\S*\s/, '') : context;
  const words = whole
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  const head = words.slice(0, 3);
  return head.length ? head.join('_') : unit.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
}

const STOP = new Set([
  'the', 'and', 'for', 'per', 'with', 'that', 'this', 'from', 'are', 'was', 'were', 'has', 'have',
  'you', 'your', 'our', 'its', 'out', 'which', 'works', 'under', 'stay', 'must', 'than', 'about',
  'для', 'что', 'это', 'при', 'как', 'или', 'под', 'над', 'без', 'его', 'она', 'они', 'наш', 'все',
  'также', 'ещё', 'еще', 'уже', 'если', 'чтобы', 'были', 'было', 'быть', 'есть', 'тот', 'той', 'этот',
]);
