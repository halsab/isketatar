import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const release = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
assert.equal(release.base_path, '/isketatar/');
assert.equal(new Set(release.assets.map(asset => asset.url)).size, release.assets.length);
for (const asset of release.assets) {
  assert.ok(asset.url.startsWith('/isketatar/'));
  const bytes = await readFile(`dist/${asset.url.slice('/isketatar/'.length)}`);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
}
console.log('Release integrity: pass');
