import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sieve } from '../src/index.ts';
import type { Fetcher } from '../src/types.ts';

const FIXTURE = new URL('./fixtures/pricing.html', import.meta.url);
const URL_ = 'https://docs.example/jev/pricing';
const NOW = () => new Date('2026-09-21T12:00:00Z');

async function run() {
  const html = await readFile(FIXTURE, 'utf8');
  return sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
}

test('strips chrome and keeps the article', async () => {
  const r = await run();
  const all = r.state.chunks.map((c) => c.text).join('\n');
  assert.match(all, /charged per input token/);
  assert.match(all, /32,000 tokens/);
  assert.doesNotMatch(all, /cookies/i);
  assert.doesNotMatch(all, /All rights reserved/);
  assert.doesNotMatch(all, /Follow us/);
  assert.doesNotMatch(all, /dataLayer/);
});

test('title and dates come from markup, as ISO, with their tier recorded', async () => {
  const html = await readFile(FIXTURE, 'utf8');
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  assert.equal(r.state.title, 'Jev pricing and limits');
  assert.equal(r.state.publishedAt, '2026-09-15');
  assert.equal(r.state.updatedAt, '2026-09-17');
  assert.equal(r.trace?.dateSource, 'json-ld');
});

test('publisher suffixes are removed from titles without losing an article heading', async () => {
  const article = `<p>${'Enough article text to keep the primary extraction path stable. '.repeat(12)}</p>`;
  const suffixed = await sieve({ kind: 'html', html: `<html><head><title>New platform features | Example Blog</title><meta property="og:site_name" content="Example Blog"></head><body><article><h1>New platform features</h1>${article}</article></body></html>`, url: URL_ }, { now: NOW });
  assert.equal(suffixed.state.title, 'New platform features');

  const siteOnly = await sieve({ kind: 'html', html: `<html><head><title>Example Blog</title><meta property="og:site_name" content="Example Blog"></head><body><article><h1>Specific article heading</h1>${article}</article></body></html>`, url: URL_ }, { now: NOW });
  assert.equal(siteOnly.state.title, 'Specific article heading');
});

test('without markup, a labelled byline is the only prose consulted', async () => {
  const html = `<html><body><article>
    <h1>Post</h1><p>Posted 3 марта 2026</p>
    <p>${'Body text about nothing in particular. '.repeat(20)} Deadline is 12.12.2030.</p>
  </article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  assert.equal(r.state.publishedAt, '2026-03-03');
  assert.equal(r.trace?.dateSource, 'byline');
});

test('trace lists what the cleaners removed, off by default', async () => {
  const quiet = await run();
  assert.equal(quiet.trace, undefined);
  const html = await readFile(FIXTURE, 'utf8');
  const loud = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  assert.ok(loud.trace && loud.trace.dropped.length > 0, 'expected at least one recorded removal');
  for (const d of loud.trace.dropped) assert.ok(d.step && typeof d.text === 'string');
});

test('chunks carry token counts, char counts and anchors', async () => {
  const r = await run();
  assert.ok(r.state.chunks.length >= 1);
  for (const c of r.state.chunks) {
    assert.ok(c.tokens > 0);
    assert.equal(c.chars, c.text.length);
    assert.ok(c.blocks.length > 0);
  }
  // Defuddle drops element ids; they are restored from the original page, so
  // the first chunk points at a real fragment.
  assert.equal(r.state.chunks[0]?.anchor, '#pricing');
});

test('facts are lifted out of the article with units and provenance', async () => {
  const r = await run();
  const price = r.state.facts.find((f) => f.unit === 'USD_per_million');
  assert.equal(price?.value, 0.042);
  assert.ok(price?.from?.startsWith('b'));
  const tokens = r.state.facts.find((f) => f.value === 32_000);
  assert.equal(tokens?.unit, 'token');
});

test('the token bill is real and the saving is large', async () => {
  const r = await run();
  assert.ok(r.usage.rawTokens > r.usage.stateTokens);
  assert.ok(r.usage.stateTokens / r.usage.rawTokens < 0.5, 'expected at least 2x saving on a page this heavy');
  assert.equal(r.usage.chunks, r.state.chunks.length);
});

test('a small budget splits into several chunks, none over either limit', async () => {
  const html = await readFile(FIXTURE, 'utf8');
  const budget = { maxTokens: 60, maxChars: 400 };
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, budget });
  assert.ok(r.state.chunks.length > 2);
  for (const c of r.state.chunks) {
    assert.ok(c.tokens <= budget.maxTokens, `${c.id} over token budget`);
    assert.ok(c.chars <= budget.maxChars, `${c.id} over char budget`);
  }
});

test('deterministic: same input, byte-identical output', async () => {
  // `usage.ms` is timing telemetry, not content; everything else must match.
  const strip = (r: Awaited<ReturnType<typeof run>>) =>
    JSON.stringify({ ...r, usage: { ...r.usage, ms: 0 } });
  assert.equal(strip(await run()), strip(await run()));
});

test('tracing never changes the result, only adds to it', async () => {
  const html = await readFile(FIXTURE, 'utf8');
  const quiet = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  const loud = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  const strip = (r: typeof quiet) => JSON.stringify({ ...r, usage: { ...r.usage, ms: 0 }, trace: undefined });
  assert.equal(strip(quiet), strip(loud));
});

test('a big page that yields almost nothing is flagged as thin', async () => {
  // An app shell: lots of markup, a spinner's worth of text, a script that would draw the rest.
  const html = `<html><body><div id="root"><p>Loading…</p></div>${'<div class="x"></div>'.repeat(4000)}<script src="/app.js"></script></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.ok(r.usage.rawTokens > 10_000);
  assert.ok(r.warnings.some((w) => w.code === 'empty-without-js'), 'an app shell is named as such');
});

// B2 — an old page with no <p>: text sits loose in a container, split by <br><br>.
test('loose text separated by <br><br> becomes paragraphs', async () => {
  const essay = Array.from({ length: 12 }, (_, i) => `Paragraph number ${i + 1} of a long essay about doing great work, with enough words to matter.`);
  const html = `<html><body><table><tr><td><font size="2" face="verdana">${essay.join('<br><br>')}</font></td></tr></table></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  const text = r.state.chunks.map((c) => c.text).join('\n');
  assert.match(text, /Paragraph number 1 /);
  assert.match(text, /Paragraph number 12 /);
  assert.ok(!r.warnings.some((w) => w.code === 'thin-content'), 'a whole essay is not thin');
});

// B4 — inline elements meet without whitespace.
test('adjacent inline elements get a space, footnote markers are dropped', async () => {
  const html = `<html><body><article><h1>T</h1>
    <p><span>20 сентября 2026</span><span>10 мин чтения</span><span>проверено на jev-1.13.0</span></p>
    <p>${'Israel is a state<sup>[65]</sup><sup>49</sup> in West Asia. '.repeat(12)}</p>
  </article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  const text = r.state.chunks.map((c) => c.text).join('\n');
  assert.doesNotMatch(text, /202610/);
  assert.doesNotMatch(text, /state6549|state\[65\]/);
  assert.match(text, /a state in West Asia/);
});

// B7 — byline and tag row do not reach the state.
test('byline and tag rows near the top are dropped and recorded', async () => {
  const html = `<html><body><article><h1>Заголовок</h1>
    <p>20 сентября 2026 · 10 мин чтения</p>
    <p>AI-агенты AI-автоматизация Claude Code</p>
    <p>${'Настоящий абзац статьи с достаточным количеством слов, чтобы считаться текстом. '.repeat(8)}</p>
    <p>Читайте наш гайд про агентов.</p>
  </article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW, trace: true });
  const text = r.state.chunks.map((c) => c.text).join('\n');
  assert.doesNotMatch(text, /мин чтения/);
  assert.doesNotMatch(text, /AI-автоматизация/);
  assert.doesNotMatch(text, /Читайте наш гайд/);
  const steps = new Set(r.trace?.dropped.map((d) => d.step));
  assert.ok(steps.has('sieve:byline') && steps.has('sieve:tags') && steps.has('sieve:cta'));
});

// B6 — JSON-LD with a trailing semicolon.
test('a trailing semicolon in JSON-LD does not lose the date', async () => {
  const html = `<html><head><script type="application/ld+json">{"@type":"Article","datePublished":"2025-12-04T09:00:00.0000000+00:00"};</script></head>
    <body><article><h1>Malaria</h1><p>${'Malaria is a life-threatening disease spread by mosquitoes. '.repeat(10)}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.equal(r.state.publishedAt, '2025-12-04');
});

// B11 — a bot challenge is named as such.
test('a challenge page is reported as blocked, not as an empty page', async () => {
  const challenge: Fetcher = {
    get: async () => ({ html: '<html><head><title>Just a moment...</title></head><body><p>Checking your browser</p></body></html>', status: 403, finalUrl: 'https://x.example/' }),
  };
  const r = await sieve({ kind: 'url', url: 'https://x.example/' }, { fetcher: challenge, now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'blocked'));
  assert.ok(!r.warnings.some((w) => w.code === 'no-main-content'));
});

// B19/B20 — a 405 "Human Verification" page and a 203 interstitial are refusals.
test('non-200 answers without an article are reported as blocked', async () => {
  const cases: [number, string][] = [
    [405, '<html><head><title>Human Verification</title></head><body><p>Please verify.</p></body></html>'],
    [203, '<html><head><title>pubmed.ncbi.nlm.nih.gov</title></head><body><div id="c"></div></body></html>'],
  ];
  for (const [status, html] of cases) {
    const fetcher: Fetcher = { get: async () => ({ html, status, finalUrl: 'https://x.example/' }) };
    const r = await sieve({ kind: 'url', url: 'https://x.example/' }, { fetcher, now: NOW });
    assert.ok(r.warnings.some((w) => w.code === 'blocked'), `status ${status} should be blocked`);
  }
});

// B21 — a subscription wall is named, not called thin.
test('a paywalled teaser is reported as paywall', async () => {
  const html = `<html><head><title>(S+) Berlin-Wahl</title>
    <script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false,"datePublished":"2026-09-21"}</script></head>
    <body><article><h1>Berlin-Wahl</h1><p>Sie können den Artikel leider nicht mehr aufrufen.</p>
    <p>${'Teaser text of the article that stops early. '.repeat(6)}</p></article>${'<div class="x"></div>'.repeat(3000)}</body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'paywall'));
  assert.ok(!r.warnings.some((w) => w.code === 'thin-content'));
});

// B22 — a declared article container left empty for JavaScript.
test('an empty article container on a script-heavy page is empty-without-js', async () => {
  const html = `<html><body><header>${'<a href="/x">Раздел</a> '.repeat(80)}</header>
    <div class="article__body js-mediator-article"><div class="article__text">Краткий пересказ от ИИ.</div></div>
    <footer>${'<a href="/y">Ещё</a> '.repeat(80)}</footer>
    ${'<script src="/app.js"></script>'.repeat(6)}</body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'empty-without-js'));
  assert.ok(!r.warnings.some((w) => w.code === 'thin-content'));
});

// B23 — a short article inside a huge site chrome is not thin.
test('a short article wrapped in heavy navigation is judged against its main region', async () => {
  const nav = `<nav>${'<a href="/x">Menu item</a> '.repeat(600)}</nav>`;
  const html = `<html><body>${nav}<main id="content"><article><h1 id="firstHeading">Stub</h1>
    <p>${'A short encyclopedia entry about a small railway station in Germany. '.repeat(6)}</p></article></main>${nav}${nav}</body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.ok(r.usage.rawTokens > 10_000, 'the page is big');
  assert.ok(!r.warnings.some((w) => w.code === 'thin-content'), 'but the article was returned whole');
});

// B15 — very large pages get a sampled raw count, and say so.
test('the raw token count on a huge page is an estimate and is flagged', async () => {
  const para = '<p>Elizabeth Bennet walked to Meryton with her sisters and talked of the militia. </p>';
  const html = `<html><body><article>${para.repeat(28_000)}</article></body></html>`;
  assert.ok(html.length > 2_000_000);
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.equal(r.usage.rawTokensEstimated, true);
  assert.ok(r.usage.rawTokens > 100_000);
});

// B18 — no lang attribute: the script decides the number rules.
test('without a lang attribute the script of the text picks the locale', async () => {
  const html = `<html><body><article><h1>Тест</h1><p>${'Задержка составила 0,114 секунды при нагрузке. '.repeat(10)}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  assert.equal(r.state.language, 'ru');
  assert.equal(r.state.facts[0]?.value, 0.114);
});

// B12 — table cells keep their column header in the text.
test('table rows carry their headers so a number keeps its column', async () => {
  const html = `<html><body><article><h1>Models</h1>
    <table><tr><th>Model</th><th>Price per Btok</th></tr><tr><td>jev-1.13.0</td><td>$42</td></tr></table>
    <p>${'Every model is served by the same endpoint. '.repeat(10)}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: URL_ }, { now: NOW });
  const text = r.state.chunks.map((c) => c.text).join('\n');
  assert.match(text, /Price per Btok: \$42/);
});

test('expected failures come back as warnings, not exceptions', async () => {
  const failing: Fetcher = {
    get: async () => {
      throw new Error('ECONNREFUSED');
    },
  };
  const r = await sieve({ kind: 'url', url: 'https://down.example/' }, { fetcher: failing, now: NOW });
  assert.equal(r.warnings[0]?.code, 'fetch-failed');
  assert.equal(r.state.chunks.length, 0);
  assert.equal(r.usage.rawTokens, 0);
});

// A table block keeps one row per line, so facts can find their row header
// and pair "per Btok / per Mtok" with "$42 / $0.042" by position.
test('table rows stay on separate lines and yield labelled, rated facts', async () => {
  const html = `<html><body><article><h1>Models</h1><p>${'Prose about the model. '.repeat(20)}</p>
    <table><tr><th>Jev 1.13</th><th>jev-1.13.0</th></tr>
    <tr><td>Price (per Btok / per Mtok)</td><td>$42 / $0.042</td></tr>
    <tr><td>Rate limits</td><td>250,000 tokens per second</td></tr></table></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://x.test/models' }, { now: NOW });
  assert.deepEqual(
    r.state.facts.map((f) => [f.label, f.value, f.unit]),
    [['price_btok_mtok', 42, 'USD_per_billion'], ['price_btok_mtok', 0.042, 'USD_per_million'], ['rate_limits', 250000, 'token_per_s']],
  );
  assert.match(r.state.chunks[0]!.text, /Price \(per Btok \/ per Mtok\) \| jev-1\.13\.0: \$42 \/ \$0\.042\n/);
});

// Lab run over ten web-dev sources (21 Sept 2026): Google's blogs date their
// posts as plain text, a theme left an empty container next to a full
// article, and feed links carried utm parameters that robots.txt forbids.
test('a plain-text "Published:" line in the untouched tree dates the page', async () => {
  const html = `<html><body><article><h1>New to the web platform</h1>
    <div class="meta"><span>Published: May 29, 2026</span></div>
    <p>${'The platform gained a feature this month and here is what changed. '.repeat(12)}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://x.test/blog/may' }, { now: NOW, trace: true });
  assert.equal(r.state.publishedAt, '2026-05-29');
  assert.equal(r.trace?.dateSource, 'byline');
});

test('a <time> without a datetime attribute is read from its text', async () => {
  const html = `<html><body><article><h1>Post</h1><time class="date">September 18, 2026</time>
    <p>${'Body text of the post, long enough to count as an article. '.repeat(12)}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://x.test/post' }, { now: NOW });
  assert.equal(r.state.publishedAt, '2026-09-18');
});

test('an empty container beside a full article is not empty-without-js', async () => {
  const html = `<html><head><script>window.app = 1;</script></head><body>
    <div class="article-content"></div>
    <article><h1>animation-trigger</h1><p>${'The CSS animation-trigger property delays the start of an animation until a trigger occurs. '.repeat(30)}</p></article>
    </body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://x.test/almanac' }, { now: NOW });
  assert.ok(!r.warnings.some((w) => w.code === 'empty-without-js'), JSON.stringify(r.warnings));
});

// Lab 2 (SEO competitor pages): three 404 pages and four script-rendered
// shops passed as usable, and a judge then ranked a 404 page third.
test('a themed 404 page is reported as http-error, not as content', async () => {
  const html = `<html><body><nav>${'<a href="/x">Shop</a> '.repeat(40)}</nav>
    <main><h1>404 Error: Page Not Found</h1><p>The page you are looking for does not exist. Try our best sellers below.</p>
    <ul>${'<li><a href="/p">Desk 60x30 — $499</a></li>'.repeat(8)}</ul></main></body></html>`;
  const fetcher: Fetcher = { get: async () => ({ html, status: 404, finalUrl: 'https://shop.example/gone' }) };
  const r = await sieve({ kind: 'url', url: 'https://shop.example/gone' }, { fetcher, now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'http-error' && /404/.test(w.detail ?? '')), JSON.stringify(r.warnings));
});

test('a scripted product page with a few hundred visible characters is empty-without-js', async () => {
  const html = `<html><head>${('<script>window.__DATA__ = {"p": "' + 'x'.repeat(400) + '"};</script>').repeat(120)}</head><body>
    <header>${'<a href="/c">Category</a> '.repeat(60)}</header>
    <main><div id="app"><h1>Product details</h1><p>Loading product…</p></div></main>
    <footer>${'<a href="/f">Footer link</a> '.repeat(60)}</footer></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://shop.example/p/1' }, { now: NOW });
  assert.ok(r.warnings.some((w) => w.code === 'empty-without-js'), JSON.stringify(r.warnings));
});

// Lab 4 (Hebrew and Arabic news): globes.co.il flags every article
// isAccessibleForFree:false in JSON-LD and serves the whole text anyway.
test('a JSON-LD paywall flag on a page that served the full article is not a paywall', async () => {
  const body = 'שוק ההון סיים את היום בעליות, והריבית במשק נותרה ללא שינוי. '.repeat(80);
  const html = `<html><head><script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false,"datePublished":"2026-09-21"}</script></head>
    <body><article><h1>מה קרה לריביות</h1><p>${body}</p></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://news.example/a' }, { now: NOW });
  assert.ok(!r.warnings.some((w) => w.code === 'paywall'), JSON.stringify(r.warnings));
  const teaser = html.replace(body, 'שוק ההון סיים את היום בעליות. לרכישת מנוי לחצו כאן.');
  const t = await sieve({ kind: 'html', html: teaser, url: 'https://news.example/a' }, { now: NOW });
  assert.ok(t.warnings.some((w) => w.code === 'paywall'), JSON.stringify(t.warnings));
});

// Lab 4: haaretz.co.il and globes.co.il both mark the article body with
// hasPart.cssSelector; one serves the body, the other serves a teaser.
test('the walled part named in JSON-LD decides: served in full is no paywall, missing is one', async () => {
  const ld = '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":"false","hasPart":{"@type":"WebPageElement","isAccessibleForFree":"false","cssSelector":".article-body"}}</script>';
  const body = 'הריבית במשק נותרה ללא שינוי והבורסה סיימה בעליות. '.repeat(60);
  const full = `<html><head>${ld}</head><body><article><h1>כותרת</h1><div class="article-body"><p>${body}</p></div></article></body></html>`;
  const r = await sieve({ kind: 'html', html: full, url: 'https://news.example/full' }, { now: NOW });
  assert.ok(!r.warnings.some((w) => w.code === 'paywall'), JSON.stringify(r.warnings));
  const teaser = `<html><head>${ld}</head><body><article><h1>כותרת</h1><p>${body.slice(0, 200)}</p><div class="article-body"></div></article></body></html>`;
  const t = await sieve({ kind: 'html', html: teaser, url: 'https://news.example/teaser' }, { now: NOW });
  assert.ok(t.warnings.some((w) => w.code === 'paywall'), JSON.stringify(t.warnings));
  // haaretz.co.il serves the first paragraph inside the walled part and a "loading…" marker after it.
  const loading = `<html><head>${ld}</head><body><article><h1>כותרת</h1><div class="article-body"><p>${body.slice(0, 500)}</p><p>טוען...</p></div></article></body></html>`;
  const l = await sieve({ kind: 'html', html: loading, url: 'https://news.example/premium' }, { now: NOW });
  assert.ok(l.warnings.some((w) => w.code === 'paywall'), JSON.stringify(l.warnings));
  // A short brief served whole inside the walled part is not a teaser.
  const brief = `<html><head>${ld}</head><body><article><h1>כותרת</h1><div class="article-body"><p>${body.slice(0, 500)}</p></div></article></body></html>`;
  const b = await sieve({ kind: 'html', html: brief, url: 'https://news.example/brief' }, { now: NOW });
  assert.ok(!b.warnings.some((w) => w.code === 'paywall'), JSON.stringify(b.warnings));
});

// Lab 5 (government fee schedules): a 190-row table is 400 facts, and the
// old cap of 200 cut the list without a word.
test('a long fee schedule keeps its facts, and a cut list is announced', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => `<tr><td>Service ${i}</td><td>£${100 + i}</td><td>£${200 + i}</td></tr>`).join('');
  const html = `<html><body><article><h1>Fees</h1><p>${'The schedule below lists every fee. '.repeat(10)}</p><table><tr><th>Service</th><th>Standard</th><th>Priority</th></tr>${rows}</table></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://gov.example/fees' }, { now: NOW });
  assert.equal(r.state.facts.length, 500);
  assert.ok(r.warnings.some((w) => w.code === 'facts-capped'), JSON.stringify(r.warnings));
  assert.deepEqual(r.state.facts[0], { label: 'service', value: 100, unit: 'GBP', context: 'Service: Service 0 | Standard: £100 | Priority: £200', from: r.state.facts[0]!.from });
});

// Lab 6 (long documents): an old RFC starts with <pre> and has no <body>;
// the WHATWG specs omit the <body> start tag; RFC 9110's "#content" is a
// table of contents and Defuddle kept one section of 400 000 characters.
test('a body-less document is read whole, not lost outside an empty body', async () => {
  const pre = (n: number) => `<pre>Section ${n}. ${'The grammar of a JSON value is given below and every implementation MUST follow it. '.repeat(20)}</pre>`;
  const html = `${pre(1)}<span class="grey">[Page 1]</span>${pre(2)}${pre(3)}`;
  const r = await sieve({ kind: 'html', html, url: 'https://rfc.example/rfc1' }, { now: NOW });
  assert.ok(r.usage.stateChars > 4000, `kept ${r.usage.stateChars} chars`);
  assert.ok(!r.warnings.some((w) => w.code === 'no-main-content' || w.code === 'empty-without-js'), JSON.stringify(r.warnings));
  const spec = `<!DOCTYPE html><html><head><title>Spec</title></head><h1>Parsing</h1>${'<p>The tokenizer state machine reads one code point at a time and emits tokens. </p>'.repeat(60)}</html>`;
  const s = await sieve({ kind: 'html', html: spec, url: 'https://spec.example/parsing' }, { now: NOW });
  assert.ok(s.usage.visibleChars > 4000, `visible ${s.usage.visibleChars}`);
  assert.ok(!s.warnings.some((w) => w.code === 'empty-without-js'), JSON.stringify(s.warnings));
});

test('a small #content beside a huge document does not stand in for it', async () => {
  const toc = '<div id="content"><ul>' + Array.from({ length: 20 }, (_, i) => `<li><a href="#s${i}">Section ${i}</a></li>`).join('') + '</ul></div>';
  const sections = Array.from({ length: 40 }, (_, i) => `<section id="s${i}"><h2>Section ${i}</h2>${`<p>A server that receives a request it cannot fulfil responds with a status code from this section. <a href="#p${i}">¶</a></p>`.repeat(12)}</section>`).join('');
  const html = `<html><body>${toc}${sections}</body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://rfc.example/rfc9110' }, { now: NOW });
  assert.ok(r.usage.visibleChars > 30000, `visible ${r.usage.visibleChars}`);
  assert.ok(r.usage.stateChars > 30000, `kept ${r.usage.stateChars}`);
});

test('an oversized table is cut between rows, not inside one', async () => {
  const rows = Array.from({ length: 1500 }, (_, i) => `<tr><td>E${i}</td><td>${'An error that occurs when the parser meets an unexpected character in this state. '.repeat(3)}</td></tr>`).join('');
  const html = `<html><body><article><h1>Errors</h1><table><tr><th>Code</th><th>Description</th></tr>${rows}</table></article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://spec.example/errors' }, { now: NOW, budget: { maxTokens: 8000, maxChars: 30000 } });
  assert.ok(r.warnings.some((w) => w.code === 'block-split'));
  for (const c of r.state.chunks) {
    assert.ok(c.text.startsWith('Code: E') || c.text.startsWith('Code | '), c.text.slice(0, 40));
    assert.ok(/\.$/.test(c.text.trimEnd()), c.text.slice(-40));
  }
});

// Lab 6: a greedy chunker cut Wikipedia mid-section, so a chunk's anchor named
// a section it mostly was not about; and in summary mode an agent could not
// tell what a chunk covered.
test('a heading closes a half-full chunk, and every chunk lists its headings', async () => {
  const section = (n: number) => `<h2 id="s${n}">Section ${n}</h2>${`<p>Paragraph of section ${n} with enough words to weigh something on the budget scale. </p>`.repeat(30)}`;
  const html = `<html><body><article><h1>Doc</h1>${Array.from({ length: 8 }, (_, i) => section(i + 1)).join('')}</article></body></html>`;
  const r = await sieve({ kind: 'html', html, url: 'https://x.test/doc' }, { now: NOW, budget: { maxTokens: 1500, maxChars: 50000 } });
  assert.ok(r.state.chunks.length >= 4, `chunks ${r.state.chunks.length}`);
  for (const c of r.state.chunks.slice(1)) {
    assert.match(c.text, /^Section \d/, c.text.slice(0, 30));
    assert.ok(c.headings && c.headings.length >= 1 && c.text.startsWith(c.headings[0]!), JSON.stringify(c.headings));
    assert.match(c.anchor ?? '', /^#s\d/, c.anchor ?? '');
  }
});
