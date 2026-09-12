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
  assert.ok(asset.url.startsWith(`/isketatar/releases/${release.release_id}/`));
  const bytes = await readFile(`dist/${asset.url.slice('/isketatar/'.length)}`);
  assert.equal(bytes.length, asset.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
}
console.log('Release integrity: pass');

const root = `dist/releases/${release.release_id}/`;
assert.equal(await readFile(root + 'index.html', 'utf8'), html);
assert.equal(await readFile(root + 'release-manifest.json', 'utf8'), await readFile('dist/release-manifest.json', 'utf8'));
const allowed = new Set(['index.html', 'recovery.html', 'release-manifest.json', 'manifest.webmanifest', `releases/${release.release_id}/release-manifest.json`, ...release.assets.map(asset => asset.url.slice('/isketatar/'.length))]);
for(const path of await readdir('dist',{recursive:true,withFileTypes:true}))if(path.isFile())assert.ok(allowed.has(`${path.parentPath}/${path.name}`.replace(/^dist\//u,'')), `Unexpected artifact: ${path.name}`);
assert.ok(release.assets.reduce((sum,asset)=>sum+asset.bytes,0) <= 8*1024*1024);
for(const url of release.shell_assets)assert.ok(release.assets.some(asset=>asset.url===url));
for(const asset of release.assets.filter(asset=>/\.(?:js|css|html|webmanifest)$/u.test(asset.url))){const text=await readFile(`dist/${asset.url.slice('/isketatar/'.length)}`,'utf8');assert.ok(!text.includes('__ISKE_RELEASE__'));}
console.log('Immutable layout and package budget: pass');
