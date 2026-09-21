# Lab journal

Every scenario is a real task run through the MCP server the way an agent
would run it, with Jev as the judge. Scripts and findings are committed; raw
rows stay in `*/results/` on the machine that ran them.

## Grid

| # | scenario | pages | usable | dated | bugs found | fixed | open |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | [ten web-dev sources](webdev-sources/findings.md) — rate sources by rules | 50 | 50/50 | 50/50 | 4 + 1 lab | 4 | 5 obs. |

## Fixed so far

| when | bug | scenario |
|---|---|---|
| 21.09 | table facts labelled by column header; two rates in a row header unpaired; `256 с.` read as seconds; ISO-dated heading not a byline | Jev example |
| 21.09 | plain-text `Published:` lines and bare `<time>` not read as dates | lab 1 |
| 21.09 | utm parameters sent to robots.txt, `&amp;` in feed links | lab 1 |
| 21.09 | `empty-without-js` on a full article with an unused container beside it | lab 1 |

## Open

| since | observation | where |
|---|---|---|
| 21.09 | pricing grids: a fact knows its block, not its plan column — send the chunk | pricing example, README |
| 21.09 | title suffixes `… \| Blog` on Google's sites | lab 1 |
| 21.09 | relevance judged on 1 800 chars punishes long tutorials with a preamble | lab 1 |
| 21.09 | 16/50 `review` classifications — class descriptions need precedence | lab 1 |

## Next scenarios

2. Competitor pages for SEO: 10 shops in one niche, extract H1/meta/schema
   presence and price facts, judge who answers the query best.
3. Docs freshness: 10 framework doc pages, `updatedAt` vs the date stated in
   the text, and how many pages are client-rendered.
4. Hebrew and Arabic news: RTL pages, dates in Hebrew, thin-content edges.
5. Government and legal pages: long PDFs linked from HTML, tables of fees,
   `block-split` behaviour.
