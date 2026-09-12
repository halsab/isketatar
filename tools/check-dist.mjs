import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const html = await readFile('dist/index.html', 'utf8');
assert.match(html, /lang="tt-Cyrl"/);
assert.match(html, /Content-Security-Policy/);
assert.doesNotMatch(html, /unsafe-eval|unsafe-inline|https?:\/\//);
const urls = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]);
for (const url of urls) {
  if (!url.startsWith('/')) continue;
  assert.ok(url.startsWith('/isketatar/'), `Outside base: ${url}`);
  await readFile(`dist/${url.slice('/isketatar/'.length)}`);
}
const files = await readdir('dist', { recursive: true });
assert.ok(!files.some(p => /(?:\.map$|\.env|textbook|audits|\.DS_Store)/.test(p)));
console.log('Static artifact: pass');
