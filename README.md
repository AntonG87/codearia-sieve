<p align="center">
  <img src="docs/banners/01-hero.png" alt="codearia-sieve — web pages into decision-ready state" width="100%">
</p>

<h1 align="center">codearia-sieve</h1>

<p align="center"><strong>Stop paying your model to read menus.</strong><br>
One call turns a web page into decision-ready state — dates as dates, numbers with units, text in token-budgeted chunks with anchors back to the page — and tells you exactly how many tokens it just saved you.</p>

<p align="center">
  <code>npx codearia-sieve</code> · MCP server for Claude Code, Cursor and any agent · TypeScript library · MIT
</p>

---

## The number

On **56 random pages** — fresh news from nine RSS feeds in seven languages, random Wikipedia articles, docs, blogs, government sites, recipes, shops — the median page went from **53 718 tokens to 1 106**.

| | |
|---|---|
| Median token saving | **98.5 %** |
| Mean (dragged down by a whole novel and long RFCs) | 91.3 % |
| Pages where the tool returned a usable article | 50 of 56 — the rest were bot challenges and robots.txt refusals, each named as such |
| Publication date found | 35 of 50; 100 % of news articles |
| Time per page, median / p90 | 1.1 s / 3.5 s — no headless browser, no model, no API key |

Every figure comes from `npm run analytics`; the sample and the rows are in [`bench/analytics/`](bench/analytics/).

<p align="center">
  <img src="docs/banners/02-before-after.png" alt="Before: the agent reads 80 000 tokens of markup. After: 1 860 tokens of state." width="100%">
</p>

## Who it is for

**You build agents and you have seen the bill.** Every time an agent fetches a page it swallows the navigation, the cookie banner, the footer, three ad slots and a megabyte of framework markup — then pays for all of it in tokens and hunts through the pile for one paragraph. A model priced per token is doing a cleaner's job.

**You run cheap decision models.** Classifiers, rankers, System One models like Jev that judge instead of write. They are fast and nearly free, and they have hard edges: they cannot count, they read dates as text, and their accuracy drops as irrelevant material fills the context. They need the most carefully prepared input of all — and every "page to markdown" tool prepares input for a reader, not for a judge.

**You want an answer you can check.** A decision made from scraped text is unprovable unless every piece points back to where it came from.

## What comes back

```ts
import { sieve } from 'codearia-sieve';

const r = await sieve({ kind: 'url', url: 'https://docs.typesafe.ai/models' });

r.state.publishedAt   // "2026-09-15"                       ← from the markup, as a date
r.state.facts[0]      // { value: 42, unit: "USD_per_billion", label: "price_per_btok",
                      //   context: "Price per Btok: $42", from: "b7" }
r.state.chunks[0]     // { id: "c1", tokens: 1 206, chars: 4 860, anchor: "#pricing", blocks: [...], text: "…" }
r.usage               // { rawTokens: 126 447, stateTokens: 1 206, visibleChars: 4 802, stateChars: 4 860, ms: 1 238 }
r.warnings            // []   ← or: blocked · paywall · empty-without-js · robots-disallowed · thin-content
r.markdown            // the same article, for a human or a generative model
```

Two formats from one pass. `markdown` is what other tools already give you. `state` is the point:

- **Dates and numbers are lifted out of the prose.** `"0,114 секунды"` becomes `{ value: 0.114, unit: "s" }` — the decimal comma is read by the page's language, never guessed. A number without a unit is not a fact; a year is never a fact.
- **Chunks know their own weight.** Each one fits two budgets at once — tokens for the model's state window and characters for the tool that will carry it — and lists the blocks it was built from.
- **Every chunk has an anchor.** A real `#fragment` from the page when one exists, the heading trail when not. Never a hash you cannot follow.
- **Warnings, not exceptions.** A robots.txt refusal, a Cloudflare challenge, a subscription teaser, an article left for JavaScript to render — each comes back named, so an agent working through two hundred links gets the honest picture instead of a crash.

<p align="center">
  <img src="docs/banners/03-pipeline.png" alt="The pipeline: fetch, parse, dates and ids from the untouched tree, clean, blocks, anchors and facts, chunk, assemble." width="100%">
</p>

## How it works

Eight steps, all deterministic code. No model runs by default; the same HTML produces the same JSON, byte for byte.

| | Step | What happens |
|---|---|---|
| 1 | **Fetch** | `robots.txt` first — a refusal is reported, not bypassed. Plain HTTP, honest user agent, 15 s timeout. |
| 2 | **Parse** | HTML into a DOM with `linkedom`; no browser. |
| 3 | **Read the untouched tree** | Publication date from JSON-LD → meta tags → `<time>`, in that order; the `id` of every element, indexed by its text. Both are gone after cleaning, so this happens first. |
| 4 | **Clean** | Defuddle strips navigation, banners, hidden and low-scoring elements; Readability takes over if it comes back empty. Inline elements are separated before cleaning so `<span>20 Sept</span><span>10 min</span>` never becomes `202610 min`. |
| 5 | **Blocks** | Headings, paragraphs, lists, tables, code, quotes — in document order, with positional ids. Loose text set with `<br><br>` becomes paragraphs; table rows keep their column headers. |
| 6 | **Anchors and facts** | Ids restored from step 3. Numbers become facts only next to a unit: currency, percent, tokens, milliseconds, `per million`, `за миллиард`. Ranges keep both ends. |
| 7 | **Chunk** | Greedy, in order, under a two-dimensional budget (20 000 tokens and 50 000 characters by default). Oversized blocks split on paragraphs, then sentences, and say so. |
| 8 | **Assemble** | `state`, `markdown`, `usage`, `warnings` — and, with `trace: true`, every element that was thrown away and why. |

The relevance step — "does this block serve the task?" — exists as an interface (`Selector`) and does not run unless you plug one in. Nothing here waits on a vendor.

## Use it from an agent

<p align="center">
  <img src="docs/banners/04-mcp.png" alt="The agent calls sieve_page and gets typed state without chunk text; sieve_chunk returns one chunk on demand." width="100%">
</p>

Add the server to Claude Code, Cursor or anything that speaks MCP:

```json
{ "mcpServers": { "sieve": { "command": "npx", "args": ["-y", "codearia-sieve"] } } }
```

Until the package is on npm, point at a checkout instead: `"command": "node", "args": ["/path/to/codearia-sieve/dist/mcp/cli.js"]`.

| Tool | Input | Output |
|---|---|---|
| `sieve_page` | `url` or `html`; `mode`: `summary` (default) · `full` · `markdown`; `maxTokens`, `maxChars`, `trace` | Typed `structuredContent` with an output schema: `source`, `state`, `usage`, `warnings`. In `summary` the chunks carry sizes and anchors but **no text** — the agent sees what exists without paying for it. |
| `sieve_chunk` | `url`, `id` | The text of one chunk, from the last result for that URL, no refetch. |

Overview first, then only what is needed. That is the whole idea, applied to the tool itself.

## Use it as a library

```ts
sieve(input, options)

input    { kind: 'url', url }                      // fetch it
         { kind: 'html', html, url? }              // already have it; url only for anchors

options  budget?:   { maxTokens?, maxChars? }      // chunk limits
         task?:     string                         // enables `selector`
         selector?: Selector                       // relevance judge; rules-free by default
         tokenizer?: Tokenizer                     // o200k by default, swap for your model's
         fetcher?:  Fetcher                        // your transport, or a file reader for tests
         now?:      () => Date                     // injected clock: identical output on identical input
         trace?:    boolean                        // return everything that was discarded, and why
```

`parseDate`, `findDates` and the vendor limits (`JEV`, `JEV_MCP`, `DEFAULT_BUDGET`) are exported too.

## Where it is honest about its limits

- **Front pages and listings** have no article to find; you get the headlines and a small state. Product pages are not articles either.
- **Pages that render the article with JavaScript** come back as `empty-without-js` when the article container is empty. When a site ships a teaser statically and streams the rest, there is no way to tell without a browser — you get the teaser.
- **Text-heavy pages save less.** A whole novel from Project Gutenberg saves 22 %, an RFC 84 %: there is no wrapping to remove, and the text is kept in full. That is the tool working, not failing.
- **Tokens are counted with o200k** as an approximation; every model family counts differently. Swap the tokenizer if yours is public. Pages over a megabyte get a sampled count and `usage.rawTokensEstimated: true`.

## Develop

```sh
npm install
npm test                         # 50 tests, offline, about a second
npm run demo -- <url>            # the token bill for one page
npm run bench                    # the 20-page benchmark set
npm run analytics                # the 56-page random sample: rows, CSV, summary
```

Design notes live in [`docs/`](docs/): vision, architecture, roadmap, research. They are written in Russian, the working language of the team.

## License

MIT © 2026 Anton Evelson · built at [Codearia Academy](https://academy.codearia.com/)
