// Usage: npm run demo -- <url>
// Prints the summary an agent would see, plus the number this project exists for.

import { sieve } from '../src/index.ts';

const url = process.argv[2];
if (!url) {
  console.error('usage: npm run demo -- <url>');
  process.exit(1);
}

const result = await sieve({ kind: 'url', url });
const { usage, state, warnings } = result;
const saved = usage.rawTokens ? 1 - usage.stateTokens / usage.rawTokens : 0;

console.log(`title:       ${state.title ?? '—'}`);
console.log(`published:   ${state.publishedAt ?? '—'}`);
console.log(`language:    ${state.language ?? '—'}`);
console.log(`status:      ${result.source.status}`);
console.log(`chunks:      ${usage.chunks}`);
console.log(`tokens:      ${usage.rawTokens.toLocaleString()} → ${usage.stateTokens.toLocaleString()}  (−${(saved * 100).toFixed(1)}%)`);
console.log(`time:        ${usage.ms} ms`);
if (warnings.length) console.log(`warnings:    ${warnings.map((w) => w.code).join(', ')}`);

for (const c of state.chunks.slice(0, 3)) {
  console.log(`\n[${c.id}] ${c.tokens} tok, ${c.chars} chars, anchor: ${c.anchor ?? '—'}`);
  console.log(c.text.slice(0, 160).replace(/\n/g, ' ') + (c.text.length > 160 ? '…' : ''));
}
