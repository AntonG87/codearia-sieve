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
| 4 | [Hebrew and Arabic news](rtl-news/findings.md) — RTL, dates, units, paywalls | 20 | 17/20 | 20/20 | 4 | 4 | 3 obs. |
| 5 | [government and legal](gov-legal/findings.md) — fee tables, statutes, bot walls | 12 | 6/12 | — | 2 | 2 | 3 obs. |

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
| 21.09 | silent cap of 200 facts on a 190-row fee table → 500 and `facts-capped` | lab 5 |
| 21.09 | "Request Access" / "Undeclared Automated Tool" bot walls with status 200 passed → `blocked` | lab 5 |

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
| 21.09 | a script-rendered table inside a prose page (USCIS fee schedule) gives no signal | lab 5 |
| 21.09 | gov.il, EUR-Lex, SEC EDGAR, Federal Register, ATO sit behind bot walls — need a declared agent, an API or a browser `Fetcher` | lab 5 |
| 21.09 | one regex over a 400-fact schedule floods `jev_extract`; find the row first (`jev_find`), then extract | lab 5 |

## Next scenarios

6. Long documents: Wikipedia's longest articles, RFCs, a novel — chunk
   boundaries at headings, anchors that resolve to real ids, `block-split`.
7. Forums and Q&A: Stack Overflow, Hacker News threads, Reddit (blocked?) —
   answers as blocks, accepted answer, vote counts as facts.
8. Recipes and how-tos: ingredient quantities as facts with units, steps as
   list blocks, schema.org Recipe.
9. Multilingual product docs (de, fr, es, ja): number locales beyond ru/en.
