# Lab journal

Every scenario is a real task run through the MCP server the way an agent
would run it, with Jev as the judge. Scripts and findings are committed; raw
rows stay in `*/results/` on the machine that ran them.

## Grid

| # | scenario | pages | usable | dated | bugs found | fixed | open |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | [ten web-dev sources](webdev-sources/findings.md) — rate sources by rules | 50 | 50/50 | 50/50 | 4 + 1 lab | 4 | 4 obs. |
| 2 | [competitor product pages](seo-competitors/findings.md) — who answers the query | 10 | 3/10 readable, 7 named | — | 2 + 1 lab | 2 | 1 feature |
| 3 | [docs freshness](docs-freshness/findings.md) — dates vs stated dates | 15 | 14/15 | 6/15 by markup | 0 | — | 3 obs. |
| 4 | [Hebrew and Arabic news](rtl-news/findings.md) — RTL, dates, units, paywalls | 20 | 17/20 | 20/20 | 2 | 2 | 5 obs. |

## Fixed so far

| when | bug | scenario |
|---|---|---|
| 21.09 | table facts labelled by column header; two rates in a row header unpaired; `256 с.` read as seconds; ISO-dated heading not a byline | Jev example |
| 21.09 | plain-text `Published:` lines and bare `<time>` not read as dates | lab 1 |
| 21.09 | utm parameters sent to robots.txt, `&amp;` in feed links | lab 1 |
| 21.09 | `empty-without-js` on a full article with an unused container beside it | lab 1 |
| 21.09 | 404/500 pages with a themed error page passed as content → `http-error` | lab 2 |
| 21.09 | script-rendered shops with a few hundred visible chars passed as content → `empty-without-js` | lab 2 |
| 21.09 | `paywall` from the JSON-LD flag alone and from hidden "for subscribers" dialogs → decided by the walled part `hasPart.cssSelector` names | lab 4 |
| 21.09 | no Hebrew/Arabic units, scales, currencies; Hebrew in the comma-decimal locale; `ב-3,000` read as minus | lab 4 |
| 21.09 | Eastern Arabic digits unread; "3 hours ago" bylines became duration facts | lab 4 |

## Open

| since | observation | where |
|---|---|---|
| 21.09 | pricing grids: a fact knows its block, not its plan column — send the chunk | pricing example, README |
| 21.09 | title suffixes `… \| Blog` on Google's sites | lab 1 |
| 21.09 | relevance judged on 1 800 chars punishes long tutorials with a preamble | lab 1 |
| 21.09 | 16/50 `review` classifications — class descriptions need precedence | lab 1 |
| 21.09 | **feature:** `state.meta` (html title, h1, description, canonical, schema types, version segment) for SEO and docs audits | labs 2, 3 |
| 21.09 | product pages: facts carry every variant price; the judge picks the sold one | lab 2 |
| 21.09 | `updatedAt` equal to today can be a build time (typescriptlang.org) | lab 3 |
| 21.09 | counts of people are not facts; "people/אנשים/أشخاص" as a unit would serve news | lab 4 |

## Next scenarios

2. Competitor pages for SEO: 10 shops in one niche, extract H1/meta/schema
   presence and price facts, judge who answers the query best.
3. Docs freshness: 10 framework doc pages, `updatedAt` vs the date stated in
   the text, and how many pages are client-rendered.
4. Hebrew and Arabic news: RTL pages, dates in Hebrew, thin-content edges.
5. Government and legal pages: long PDFs linked from HTML, tables of fees,
   `block-split` behaviour.
