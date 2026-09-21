import robotsParserModule from 'robots-parser';
import type { Fetcher, FetchResult, Warning } from './types.ts';

// The package ships a CommonJS default export; under NodeNext its typings
// resolve to the module namespace, so we restate the callable shape ourselves.
const robotsParser = robotsParserModule as unknown as (
  url: string,
  robotstxt: string,
) => { isAllowed(url: string, ua?: string): boolean | undefined };

const USER_AGENT = 'codearia-sieve/0.0 (+https://github.com/AntonG87/codearia-sieve)';
const TIMEOUT_MS = 15_000;

/** Raised instead of fetching when the site has asked crawlers to stay out. */
export class RobotsDisallowed extends Error {
  constructor(url: string) {
    super(`robots.txt disallows ${url}`);
    this.name = 'RobotsDisallowed';
  }
}

async function isAllowed(url: string): Promise<boolean> {
  const robotsUrl = new URL('/robots.txt', url).toString();
  try {
    const res = await fetch(robotsUrl, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // No robots file means no restrictions.
    if (!res.ok) return true;
    const body = await res.text();
    return robotsParser(robotsUrl, body).isAllowed(url, USER_AGENT) ?? true;
  } catch {
    // An unreachable robots file is not a ban; the page fetch reports its own error.
    return true;
  }
}

/** Query parameters that track the click and never select the content. */
const TRACKING_PARAM = /^(?:utm_\w+|fbclid|gclid|dclid|yclid|msclkid|mc_cid|mc_eid|_ga|_gl|ref_src|igshid)$/i;

/**
 * The same page without its tracking parameters. Feeds and social links carry
 * them, and sites such as habr.com disallow every "?utm_" URL in robots.txt
 * while serving the clean one — the clean one is what is asked for.
 */
export function stripTracking(url: string): string {
  let u: URL;
  try {
    // "&amp;" survives in URLs copied out of HTML and feeds; it is never meant.
    u = new URL(url.replace(/&amp;/g, '&'));
  } catch {
    return url;
  }
  const keys = [...u.searchParams.keys()].filter((k) => TRACKING_PARAM.test(k));
  if (!keys.length) return url;
  for (const k of keys) u.searchParams.delete(k);
  return u.toString();
}

/** Plain HTTP with robots.txt respected. No headless browser, no proxies. */
export const defaultFetcher: Fetcher = {
  async get(requested: string): Promise<FetchResult> {
    const url = stripTracking(requested);
    if (!(await isAllowed(url))) throw new RobotsDisallowed(url);
    const res = await fetch(url, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { html: await res.text(), status: res.status, finalUrl: res.url || url };
  },
};

/** Maps a fetch failure to the warning the caller will see. */
export function fetchWarning(error: unknown): Warning {
  if (error instanceof RobotsDisallowed) {
    return { code: 'robots-disallowed', detail: error.message };
  }
  const detail = error instanceof Error ? error.message : String(error);
  return { code: 'fetch-failed', detail };
}
