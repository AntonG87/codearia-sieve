# Lab 3 — documentation freshness

Fifteen documentation pages (React, Vue, Svelte, Next.js, Astro, Node, MDN,
WordPress, PHP, Python, PostgreSQL, Tailwind, TypeScript, Stripe, Cloudflare).
Run on 21 September 2026, `codearia-sieve` at `64ecd41`.

## The grid

| page | raw → state | published | updated | tier | structure | note |
|---|---:|---|---|---|---|---|
| react useEffect | 199 717 → 7 887 | — | — | — | h33 c32 | undated by design |
| vue reactivity | 56 681 → 3 420 | — | — | — | h17 c34 | undated |
| svelte $state | — | — | — | — | — | `fetch-failed` once, 200 on retry |
| nextjs routing | 212 044 → 1 514 | — | 2026-08-25 | meta | h10 c10 | |
| astro components | 114 559 → 2 686 | — | — | — | h11 c18 | undated |
| node fs | 367 393 → 45 966 | — | — | — | h257 c105 | 46k tokens, 3 chunks |
| mdn fetch | 48 995 → 4 585 | 2025-08-20 | — | time | h17 c23 | |
| wordpress get_posts | 74 759 → 3 349 | 2017-02-11 | — | time | h8 c1 | a 2017 date on a live reference |
| php array_map | 24 670 → 1 640 | — | — | — | h6 c14 | undated |
| python asyncio | 6 941 → 462 | — | — | — | h0 c1 | index page, thin by nature |
| postgres SELECT | 30 324 → 12 974 | 2026-08-13 | — | meta | h35 c37 | Jev reads the same date in the text |
| tailwind responsive | 146 840 → 2 796 | — | — | — | h21 c21 | undated |
| typescript generics | 107 370 → 4 541 | — | 2026-09-21 | byline | h9 c31 | "Last updated: Sep 21, 2026" is the build time |
| stripe charges | 616 481 → 2 753 | — | — | — | h8 c3 | 616k raw: the API reference ships whole |
| cloudflare fetch | 62 929 → 934 | 2026-07-05 | 2026-07-05 | time | h4 c4 | |

14/15 usable, 0 client-rendered, 6/15 dated by markup, 1/14 dated by text
(Jev found "August 13, 2026" on the PostgreSQL page only).
2 069 703 → 95 507 tokens.

## What this says

- **Most documentation is undated on purpose.** React, Vue, Astro, PHP,
  Python, Tailwind, Stripe carry no date in markup or text. A freshness rule
  for docs cannot rely on dates; it needs the version the page belongs to
  (`3.4`, `v22`, `current`), which is in the URL or the sidebar. Candidate
  for the `meta` field proposed in lab 2: `canonical` and the version segment.
- **"Last updated" can mean "last built".** typescriptlang.org prints the
  build date on every page; Sieve reports what the page states, which is
  right, but a Java rule should treat an `updatedAt` equal to today with
  suspicion when the page's own text says nothing else changed.
- **Old dates are real.** WordPress's reference says 2017 and means it: the
  function has not changed. Freshness is not quality.
- **One transient `fetch-failed`** (svelte.dev; a 200 on the next call). The
  fetcher does no retries by design; a lab or a job should retry once itself.
  Not changed: a retry policy belongs to the caller's `Fetcher`.

## Bugs

None in the pipeline from this lab. Two lab-script notes: the text regex for
"last updated" missed the TypeScript line because Defuddle drops it (the
`byline` tier in the untouched tree caught it instead — the fix from lab 1
paid off here); and Node's 46k-token page produced 3 chunks under the budget
with no `block-split`.
