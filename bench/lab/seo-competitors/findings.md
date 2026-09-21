# Lab 2 — competitor product pages for one query

Ten standing-desk product pages for the query *"electric standing desk for a
home office, sturdy, under $700, with a warranty"*. Run on 21 September 2026,
`codearia-sieve` at `64ecd41`, Jev through `jev-mcp`.

## The grid (after the fixes)

| vendor | raw → state tokens | warning | sieve price facts | Jev price | Jev warranty | relevance |
|---|---:|---|---|---|---|---:|
| autonomous | 154 983 → 2 312 | — | 435 426 422 417 449 400 | $449 auto | 10-year auto | 0.91 |
| branch | 525 426 → 1 067 | — | 749 549 949 299 799 | $749 auto | review | 0.47 |
| ergonofis | 312 606 → 2 183 | — | 2295 | $2,295.00 auto | 10-year auto | 0.40 |
| secretlab | 806 659 → 186 | `thin-content` (842 of 9 266 chars) | — | — | — | 0.03 |
| ikea | 336 035 → 66 | `empty-without-js` | — | — | — | excluded |
| flexispot | 41 281 → 37 | `http-error`, `empty-without-js` | — | — | — | excluded |
| uplift | 117 973 → 7 | `http-error`, `fallback-extractor` | — | — | — | excluded |
| hermanmiller | 30 665 → 248 | `http-error` (404) | — | — | — | excluded |
| vari | 116 162 → 174 | `http-error` (404) | — | — | — | excluded |
| desky | 183 961 → 99 | `http-error` (404) | — | — | — | excluded |

Three of ten product pages are readable without a browser. That is the honest
number for e-commerce: shops render prices by script, and guessed URLs 404.
Where the page is readable, Sieve's price facts and Jev's verbatim extraction
agree (autonomous $449, branch $749, ergonofis $2 295), and the relevance
ranking matches the query (autonomous is the only one under $700 with a
stated warranty).

## Bugs found, fixed in `64ecd41`

| # | symptom | cause | fix | test |
|---|---|---|---|---|
| 5 | three 404 pages came back with no warning; Jev ranked Vari's 404 page third (0.39) | `blocked` covers 401/403/405/429/503 and challenge titles; a themed 404 carries menus and a title, so it looked like a page | new warning `http-error` for any 4xx/5xx that is not `blocked`, with the status | `a themed 404 page is reported as http-error …` |
| 6 | script-rendered shops (uplift 9 visible chars, flexispot 104, ikea 365) came back "usable" with 7–66 tokens | `empty-without-js` needed either a declared article container or a body under 200 chars; a shop shell has menus in the body and no article container | a scripted page with under 500 chars of prose in its main region and over 50 KB of markup is a shell | `a scripted product page with a few hundred visible characters …` |

Lab-script bug: the first version of `BAD` did not know `http-error`, so the
rerank still received two 404 pages on the second run. Fixed in `lib.ts`.

## Open observations

- **No H1 in the markdown.** Defuddle removes the heading that repeats the
  title, so `state.title` *is* the H1 for SEO purposes. An audit that needs
  the literal `<h1>` (and `<title>` separately, and `meta description`,
  canonical, schema.org types) needs fields Sieve does not expose. Candidate:
  `state.meta { htmlTitle, h1, description, canonical, schemaTypes }`, read
  from the untouched tree like the dates. This is the one feature request
  the lab produced.
- **Price facts on a product page mix variants.** Autonomous lists six
  prices (sizes, colours); the facts carry them all with block ids, and the
  judge picks the one sold "on this page". Right division of labour, but a
  reader of `facts` alone cannot tell the main price from a variant.
- **`fallback-extractor` on a 404** (uplift): Readability ran on an error
  page. Harmless now that `http-error` is present, but the warning order
  should put `http-error` first. It does.
