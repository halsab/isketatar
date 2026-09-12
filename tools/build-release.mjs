import { readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const app = JSON.parse(await readFile('package.json', 'utf8'));
const content = JSON.parse(await readFile('src/generated/content-manifest.json', 'utf8'));
const files = (await readdir('dist', { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`.replace(/^dist\//, '')).sort();
const allowed = new Set(['index.html', 'recovery.html', 'licenses/Inter.txt', 'licenses/NotoNaskhArabic.txt', 'licenses/ThirdParty.txt', 'sources/sections.json', 'runtime/content-manifest.json', ...content.assets.map(asset => asset.url.slice('/isketatar/'.length))]);
const assets = [];
for (const path of files) {
  if (!allowed.has(path) && !/^assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2)$/u.test(path)) throw new Error(`Unexpected release file: ${path}`);
  const bytes = await readFile(`dist/${path}`);
  const kind = path.endsWith('.js') ? 'script' : path.endsWith('.css') ? 'style' : path.endsWith('.woff2') ? 'font' : path.endsWith('.json') ? 'content' : path.endsWith('.html') ? 'shell' : 'media';
  assets.push({ url: `/isketatar/${path}`, sha256: hash(bytes), bytes: bytes.length, kind, required: true });
}
const builtAt = Number(process.env.SOURCE_DATE_EPOCH ?? execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' }).trim()) * 1000;
if (!Number.isSafeInteger(builtAt) || builtAt < 0) throw new Error('Invalid build timestamp');
const fingerprint = hash(JSON.stringify({ assets, built_at: builtAt }));
const release = {
  release_id: `${app.version}-${fingerprint.slice(0, 16)}`, app_version: app.version, content_version: content.content_version,
  content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: builtAt,
  assets, question_revisions: content.question_revisions, policy_versions: content.policy_versions,
};
await writeFile('dist/release-manifest.json', JSON.stringify(release));
console.log(`Release ${release.release_id}: ${assets.length} assets, ${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes`);
