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
  const html = `<html><body><article>${para.repeat(14_000)}</article></body></html>`;
  assert.ok(html.length > 1_000_000);
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
