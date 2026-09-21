# Lab 1 — ten web-development sources

Run on 21 September 2026 with `codearia-sieve` at `c4d7e37` (after the fixes
below) and Jev `jev-latest` through `jev-mcp`. Rules in `rules.json`; raw rows
in `results/` (local only).

## The grid

| source | score | usable | dated | median age | median tokens | structure | relevance | substantive |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| css-tricks.com | 85 | 5/5 | 5/5 | 26 d | 1 412 | 12 | 0.71 | 0.80 |
| habr.com/webdev | 84 | 5/5 | 5/5 | 1 d | 4 242 | 25 | 0.38 | 1.00 |
| web.dev | 82 | 5/5 | 5/5 | 151 d | 1 012 | 10 | 0.87 | 1.00 |
| dev.to | 82 | 5/5 | 5/5 | 1 d | 1 307 | 6 | 0.26 | 1.00 |
| sitepoint.com | 82 | 5/5 | 5/5 | 1 d | 6 435 | 38 | 0.28 | 1.00 |
| smashingmagazine.com | 79 | 5/5 | 5/5 | 13 d | 3 561 | 15 | 0.31 | 0.80 |
| blog.logrocket.com | 77 | 5/5 | 5/5 | 25 d | 2 664 | 23 | 0.30 | 1.00 |
| freecodecamp.org | 75 | 5/5 | 5/5 | 3 d | 9 583 | 62 | 0.08 | 1.00 |
| developer.mozilla.org | 74 | 5/5 | 5/5 | 321 d | 1 583 | 7 | 0.56 | 1.00 |
| developer.chrome.com | 68 | 5/5 | 5/5 | 97 d | 1 158 | 7 | 0.39 | 0.80 |

50 pages, 2 867 175 → 264 756 tokens (−90.8 %; tutorials keep their code).
50/50 usable, 50/50 dated. Before the fixes: 44/50 usable, 34/50 dated.

Reading the grid: the score is a blend, and the columns disagree on purpose.
web.dev has the most relevant material and the stalest feed; freecodecamp is
the deepest and the least on-topic (its feed is Python, iOS and medical
imaging this week); dev.to is fresh and shallow. A Java job should weight the
columns for its own question rather than trust one number.

## Bugs found in codearia-sieve, all fixed in `c4d7e37`

| # | symptom | cause | fix | test |
|---|---|---|---|---|
| 1 | web.dev and developer.chrome.com: 10/10 pages without a date | the date is plain text, `Published: May 29, 2026`, no JSON-LD, meta or `<time>`; the cleaner drops the line before blocks exist | fourth date tier `byline`: the smallest element whose whole text is a labelled date, read from the untouched tree | `a plain-text "Published:" line …` |
| 2 | developer.mozilla.org: 5/5 without a date | `<time class="date">` has no `datetime` attribute | a bare `<time>` is read from its text | `a <time> without a datetime attribute …` |
| 3 | habr.com: 5/5 `robots-disallowed` | feed links carry `?utm_campaign=…&amp;utm_source=…`; habr's robots.txt forbids every `?utm_` URL and serves the clean one | `stripTracking()` before the robots check and the fetch; `&amp;` decoded | `tracking parameters are stripped …` |
| 4 | css-tricks.com `animation-trigger`: `empty-without-js` on a 1 412-token article | the theme leaves an empty `.article-content` container next to the real article; the warning fired on the container alone | the warning needs the extracted text to be short as well (< 2 000 chars) | `an empty container beside a full article …` |

Lab-script bug: `jev_rerank` returns `ranked[].relevance`, not `results[].score`.
The first run scored relevance 0 for every source because of it.

## Open observations

- **Title suffixes.** web.dev and developer.chrome.com titles come back as
  `New to the web platform in May  |  Blog`. The `| Blog` is the site's
  suffix, not the title. Candidate rule: drop a trailing ` | X` / ` - X` when
  X equals `og:site_name` or repeats on every page of the host. Not done: needs
  a second page of the same host to be safe.
- **Stale feeds are real.** web.dev's feed serves May; MDN's serves June. The
  `fresh` rule punishes them, correctly, but a reader of the grid should know
  it is the feed, not the site.
- **Relevance is judged on 1 800 characters.** Long tutorials whose first
  screen is preamble score low. Sending the first chunk head is the honest
  budget for `jev_rerank`; a second pass on the top 20 with more text would
  be the next experiment.
- **16 of 50 classifications on `review`.** Mostly `tutorial` vs `analysis`
  and one `sponsored` (Chrome's WebMCP origin trial post). Class descriptions
  in `rules.json` can be tightened with precedence rules.
- **freecodecamp GraphRAG post: 172 167 → 104 268 tokens.** A 100k-token
  tutorial with 218 code blocks, cut into 10 chunks under the 20 000-token
  budget with no `block-split`. Not a bug — the tool keeps what is there — but
  the `depth` rule caps such pages by design.
