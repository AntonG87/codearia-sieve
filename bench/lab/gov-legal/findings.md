# Lab 5 — government and legal pages

Twelve official pages: fee schedules (gov.uk visas, passports, Companies
House; USCIS; IRCC), tax tables (IRS, ATO), a regulation (GDPR on EUR-Lex),
a statute section (legislation.gov.uk), an Israeli service page (gov.il), an
SEC 10-K and a Federal Register rule. Run on 21 September 2026,
`codearia-sieve` at `c447a36`, Jev through `jev-mcp`.

## The grid (after the fixes)

| page | raw → state | facts (money) | table rows | Jev answer | Sieve facts verified by Jev |
|---|---:|---:|---:|---|---|
| gov.uk visa fees | 67 735 → 8 812 | 417 (417) | 189 | review — too many candidates for one regex | 8/8 |
| gov.uk passport | 21 684 → 460 | 10 (9) | 10 | £102 auto | 8/8 |
| irs brackets | 28 021 → 998 | 60 (39) | 32 | 37 % auto | 8/8 |
| uscis fees | 30 967 → 1 276 | 2 (2) | 0 | not found — the schedule is rendered by script | 2/2 |
| legislation.gov.uk | 14 057 → 1 020 | 0 | 0 | 2018 auto | — |
| companies house | 44 328 → 2 819 | 98 (96) | 128 | £100 review | 8/8 |
| canada fees | 4 448 → 90 | — | — | `http-error` 404 (a guessed URL) | — |
| eur-lex gdpr | 781 → 4 | — | — | `blocked` "JavaScript is disabled" | — |
| gov.il fees | 2 606 → 4 | — | — | `blocked` "Just a moment…" | — |
| sec 10-k | 1 168 → 539 | — | — | `blocked` "Undeclared Automated Tool" | — |
| federalregister | 2 856 → 166 | — | — | `blocked` "Request Access" | — |
| ato | 187 → 85 | — | — | `blocked` "Access Denied" | — |

6/12 usable. Every currency fact Sieve lifted from a fee table and handed to
Jev as a claim was verified: **34 of 34**. No `block-split` on any page.

What the grid says: official fee tables are the best case for the tool —
"Header: cell" rows keep the column, the currency sign gives the unit, and a
judge confirms every number. The other half of government is behind bot
walls: EUR-Lex, gov.il (Cloudflare), SEC EDGAR (declared-agent policy),
Federal Register (Request Access), ATO (Akamai). Those need a declared
agent, an API (EDGAR has one) or a browser — not this tool, and it says so.

## Bugs found, fixed in `c447a36`

| # | symptom | cause | fix | test |
|---|---|---|---|---|
| 9 | gov.uk visa fees: exactly 200 facts from a 189-row table, no sign that the list was cut | `MAX_FACTS = 200` silently truncated | cap raised to 500 and a `facts-capped` warning when it is hit | `a long fee schedule keeps its facts …` |
| 10 | federalregister.gov: 200 status, "Request Access" bot wall, no warning | the title matched none of the known challenge phrases | `request access`, `automated tool`, `javascript is disabled` added to `BLOCK_TITLE` | covered by the existing challenge test |

## Open observations

- **One regex, 417 candidates.** `jev_extract` returned `review` on the
  visa table because the pattern matched hundreds of fees. The right call for
  a schedule is a two-step: `jev_find` the row, then extract from that row.
  A lab-script pattern, not a tool issue — but worth an example.
- **Script-rendered schedules** (USCIS) come back with the prose and none
  of the fees. The `empty-without-js` rule does not fire because the page has
  2 000+ characters of prose around the empty table. A "table container is
  empty" signal is possible; not done.
- **gov.il behind Cloudflare** means the Hebrew government use case needs a
  browser-backed `Fetcher`. Noted for the memory file.
