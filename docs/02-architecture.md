# codearia-sieve. Technical approach

This document answers "how it works inside". Anything marked as an open
question is decided before it is coded.

---

## Limits set by the consumer

The whole design follows from who the material is prepared for. Jev's numbers
as of September 20, 2026, checked against `docs.typesafe.ai/models`:

| Limit | Value | What follows |
|---|---|---|
| Request context | 64k tokens | Chunking is mandatory, not optional |
| State + longest question | 32k tokens | Target chunk ~20k, with headroom for questions |
| Rate limits | 250k tokens/s, 1 200 requests/min | Batching on our side, a queue at peaks |
| Input | text only | Images, PDFs and tables are reduced to text by us |
| Does not count | — | Our code computes numbers and passes them ready |
| Reads dates as text | — | Dates are extracted and normalised to ISO |
| Context rot | accuracy drops with irrelevant material | Relevance filtering is a function, not decoration |

Vendor versions and limits move, as the vendor itself warns. The values live
in `src/limits.ts`, not in the pipeline code.

## The pipeline

```
URL or HTML
      ↓
[1] Fetch            robots.txt, timeouts, honest user agent
      ↓
[2] Parse            HTML → DOM (linkedom, no browser)
      ↓
[3] Dates and ids    read from the untouched tree, before cleaning strips them
      ↓
[4] Clean            menus, footer, banners, ads, "read also"
      ↓
[5] Blocks           headings, paragraphs, lists, tables, code, in order
      ↓
[6] Facts, anchors   dates → ISO, numbers → values with units, ids restored
      ↓
[7] Chunk            pieces under a two-dimensional budget, with anchors
      ↓
[8] Assemble         state for decisions, markdown for reading, usage, warnings
```

Every step is ordinary code, and that is its strength: deterministic, cheap,
covered by tests. Relevance selection is the only place a model could be
useful, and it is a port (`Selector`) with no default implementation.

## Selection: what to select with

This is the fork that decides the economics.

**Option A. Rules and heuristics.** Text density, link share in a block,
position in the document, repetition across pages of one domain. Zero cost,
zero latency, blind to meaning: a paragraph about shipping and a paragraph
about returns look the same.

**Option B. A System One model.** One question per block: "does this relate
to the task". A thousand blocks go in batches, cost cents, come back in a
fraction of a second. Meaning is distinguished.

**Option C. Hybrid, and this is our choice.** Rules remove the obvious junk
for free: navigation, footer, cookie banner. A model works only on what is
left, and only when a task is given. Without a task the mode degrades to
"give me clean state" and no model is called at all.

We would be using a System One model to prepare input for a System One model.
That is not a curiosity but a normal recursion; it does mean a dependency on
a vendor with a waiting list. So selection sits behind an interface, and the
rules-only path is the default.

## The result

The main difference from "another reader API" lives here.

```jsonc
{
  "source": { "url": "…", "fetchedAt": "2026-09-20T10:11:12Z", "status": 200 },

  // Ready for reading: by a human or a generative model
  "markdown": "# Title\n\n…",

  // Ready for decisions: what this is all for
  "state": {
    "title": "…",
    "publishedAt": "2026-09-15",     // out of the prose, already a date
    "updatedAt": "2026-09-17",
    "language": "en",
    "facts": [
      { "label": "price_per_btok", "value": 42, "unit": "USD_per_billion",
        "context": "Price per Btok: $42", "from": "b7" }
    ],
    "chunks": [
      {
        "id": "c1",
        "text": "…",
        "tokens": 1840,
        "chars": 7120,
        "anchor": "#pricing",         // where to go back and check
        "blocks": ["b1", "b2", "b3"]
      }
    ]
  },

  "usage": { "rawTokens": 126447, "stateTokens": 1840, "visibleChars": 7010,
             "stateChars": 7120, "chunks": 1, "ms": 1238 },
  "warnings": []
}
```

Three things make this shape useful:

1. **Dates and numbers are out of the text.** The decision model does not
   compute them, so we do. This is not convenience; it works around its main
   limitation.
2. **Chunks know their size in tokens and characters.** The client assembles
   a request under budget without guessing.
3. **Every chunk has an anchor and every fact names its block.** A decision
   made on the material can be checked on the source page. Without that an
   automated decision is unprovable.

Expected outcomes do not throw. They come back as named warnings:
`robots-disallowed`, `fetch-failed`, `blocked`, `paywall`, `empty-without-js`,
`no-main-content`, `thin-content`, `fallback-extractor`, `block-split`.

## Fitting jev-mcp

Checked on September 21, 2026 against the `jkudish/jev-mcp` README and the
vendor docs.

The "agent calls Jev" niche is taken: `jev-mcp` exposes ten typed tools over
the model. It does no preparation on principle: it judges what it is given
and leaves fetching and cleaning to the caller. The vendor offers no
preparation tools either and advises reducing material to text yourself.

Hence the decision: we do not compete, we connect. Our output has to fit the
input of `jev-mcp` without adapters.

| jev-mcp input limit | Value |
|---|---|
| Text field | 2 000 – 50 000 characters |
| Total rerank budget | 100 000 characters |
| Candidates per call | up to 250 |

This sets the requirement on chunking: **the budget is two-dimensional**. A
chunk must fit both the token budget under Jev's 32k state and the character
ceiling per field. Counting tokens alone is not enough: on Cyrillic the
characters-to-tokens ratio is different, and a chunk that passes on tokens can
fail on characters.

## Fetching

- `robots.txt` is respected, and not only for ethics: it is what separates a
  tool people can rely on from a scraper that lives until the first complaint.
- Plain HTTP with an honest user agent, a timeout, no retries by default.
- Client-side rendering: some pages are empty without JavaScript. A headless
  browser costs many times a plain request, so it is not part of the tool;
  the page comes back with `empty-without-js` and the caller decides.
- Fetching is a port (`Fetcher`), so a cache, a proxy pool or a browser can be
  plugged in without touching the pipeline.

## Stack

- **Runtime**: Node 22+, TypeScript with `--experimental-strip-types`, no
  build step for tests.
- **Extraction**: Defuddle as the base, Readability as the fallback, our own
  rules on top. No reason to write cleaning from scratch.
- **DOM**: linkedom. No browser.
- **Tokens**: gpt-tokenizer (o200k) as an approximation; swappable through
  the `Tokenizer` port.
- **Interfaces**: the library (`sieve()`) and the MCP server (`sieve_page`,
  `sieve_chunk`) over the same pipeline.

## Open questions

1. ~~Licence and the line between open and paid.~~ Decided: MIT, nothing
   paid, no hosting.
2. ~~Is an MCP server a second interface next to REST.~~ Decided on
   September 21, 2026: MCP is the main interface. A one-line install into an
   agent replaces REST as the way to distribute the tool.
3. A headless browser: not in the tool. A `Fetcher` implementation on top of
   one can live in a separate package if it proves necessary.
4. Paywalled pages: we do not bypass them. The teaser comes back with a
   `paywall` warning.
