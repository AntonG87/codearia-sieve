# Lab 4 — Hebrew and Arabic news

Twenty articles from ynet, Haaretz, Walla, Globes (Hebrew) and BBC Arabic;
Al Jazeera's feed failed to fetch and Asharq Al-Awsat's parsed to no items.
Run on 21 September 2026, `codearia-sieve` at `7296b23`, Jev topic
classification through `jev-mcp`.

## The grid (after the fixes)

| source | articles | usable | dated | language | RTL share | facts | note |
|---|---:|---:|---:|---|---:|---:|---|
| ynet.co.il | 4 | 4 | 4 | he | 100 % | 3 | |
| walla.co.il | 4 | 4 | 4 | he | 99–100 % | 0 | counts without units: "3,322 בני אדם" |
| globes.co.il | 4 | 4 | 4 | he | 99–100 % | 36 | ILS, USD, EUR, % — after the fixes |
| haaretz.co.il | 4 | 1 | 4 | he | 97–100 % | 0 | 3 × `paywall` (all `.premium` URLs), 1 free |
| bbc.com/arabic | 4 | 4 | 4 | ar | 100 % | 4 | "قبل 3 ساعات" timestamps become `3 h` |

17/20 usable, 20/20 dated (all JSON-LD), 20/20 language detected, reading
order intact (RTL share of letters 97–100 %). Topic classification: 76 % auto
across Hebrew and Arabic with five generic classes.
3 091 742 → 24 942 tokens.

Before the fixes: 12/20 usable and every Hebrew fact list was empty except
`%`.

## Bugs found, fixed in `7296b23`

| # | symptom | cause | fix | test |
|---|---|---|---|---|
| 7 | Globes: 4/4 `paywall` on articles served whole | the site sets `isAccessibleForFree:false` on every article, and its hidden print dialog says "printing is for subscribers only", which the text-phrase check read | paywall decided by the element `hasPart.cssSelector` names: served with its text → no wall; missing, nearly empty, or ending in "loading…" → teaser. Text phrases are read from the reader-visible region only | `the walled part named in JSON-LD decides …` |
| 8 | Hebrew facts empty; `ב-3,000 ש"ח` → −3000 with no unit | no Hebrew or Arabic units, scales or currency words; Hebrew mapped to the comma-decimal locale; a hyphen glued to a Hebrew prefix read as a minus sign | ש"ח/שקל, דולר, אירו, אלף/מיליון/מיליארד, דקות/שעות/ימים, ק"מ/ק"ג, אחוז and the Arabic equivalents (دولار, ريال, درهم, جنيه, مليون/مليار, بالمئة, ساعة/يوم); `he` and `ar` use the English separators; a sign counts only after a non-letter | `Hebrew and Arabic currencies, scales and units …` |

Result on the same Globes pages: `10.9 billion ILS`, `79.6 billion ILS`,
`85,200 USD`, `13.8 %` — read from `10.9 מיליארד שקל`.

## Open observations

- **Haaretz premium pages are exact.** Every `paywall` warning falls on a
  `/.premium/` URL and no free article gets one. The tell is the walled
  part ending in "טוען..." — worth keeping an eye on when the site changes.
- ~~**Eastern Arabic digits** are not read as numbers.~~ Fixed the same day:
  ٠–٩ and ۰–۹ are mapped to 0–9 before the number scan (same length, so
  offsets and anchors hold).
- ~~**"3 hours ago" timestamps become facts** (`3 h`) on BBC Arabic.~~ Fixed:
  a duration wrapped in an "ago" word (ago, назад, قبل, منذ, לפני, il y a,
  hace, vor) is a timestamp and is skipped, the way years are.
- **Counts without units** ("3,322 people") are not facts by design. For
  news, "people", "אנשים", "أشخاص" could be a unit worth adding — it is the
  number most stories rest on.
- **Two Arabic feeds unreachable** from this network (Al Jazeera TLS failure,
  Asharq Al-Awsat feed format). A retry and an Atom-aware feed parser belong
  to the lab, not the tool.
