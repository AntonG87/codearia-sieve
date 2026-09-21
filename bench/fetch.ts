// Downloads the pages listed in bench/pages.txt into bench/pages/, through the
// same fetcher the library uses (robots.txt respected, no headless browser).
// Existing files are kept, so re-running only fills the gaps.
//
// Usage: npm run bench:fetch

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultFetcher, fetchWarning } from '../src/fetch.ts';

const LIST = 'bench/pages.txt';
const DIR = 'bench/pages';

const urls = (await readFile(LIST, 'utf8'))
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

await mkdir(DIR, { recursive: true });

/** Stable file name from the URL, so the same page lands in the same file. */
function slug(url: string, index: number): string {
  const u = new URL(url);
  const path = decodeURIComponent(u.pathname).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  const host = u.hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/gi, '-');
  return `${String(index + 1).padStart(2, '0')}-${host}${path ? `-${path}` : ''}`.slice(0, 80) + '.html';
}

let ok = 0;
for (const [i, url] of urls.entries()) {
  const file = join(DIR, slug(url, i));
  try {
    await access(file);
    console.log(`  kept   ${file}`);
    ok++;
    continue;
  } catch {
    // not downloaded yet
  }
  try {
    const res = await defaultFetcher.get(url);
    // The source URL travels with the page so anchors and robots stay honest.
    await writeFile(file, `<!-- source: ${url} -->\n${res.html}`);
    console.log(`  ${res.status}    ${file}  (${(res.html.length / 1024).toFixed(0)} KB)`);
    ok++;
  } catch (error) {
    const w = fetchWarning(error);
    console.log(`  skip   ${url}  [${w.code}] ${w.detail ?? ''}`);
  }
}
console.log(`\n${ok}/${urls.length} pages on disk in ${DIR}/`);
