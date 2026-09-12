import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const base = '/isketatar/'; const placeholder = '__ISKE_RELEASE__';
const app = JSON.parse(await readFile('package.json', 'utf8'));
const content = JSON.parse(await readFile('src/generated/content-manifest.json', 'utf8'));
const files = (await readdir('dist', { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => `${entry.parentPath}/${entry.name}`.replace(/^dist\//, '')).sort();
const allowed = new Set(['index.html', 'recovery.html', 'licenses/Inter.txt', 'licenses/NotoNaskhArabic.txt', 'licenses/ThirdParty.txt', 'sources/sections.json', 'runtime/content-manifest.json', ...content.assets.map(asset => asset.url.slice(base.length))]);
const input = new Map();
const transport = await readFile('dist/sw.js');
for (const path of files) {
  if (path === 'sw.js') continue;
  if (!allowed.has(path) && !/^assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2)$/u.test(path) && !/^icons\/(?:icon-192|icon-512|maskable-512|apple-touch)\.png$/u.test(path)) throw new Error(`Unexpected release file: ${path}`);
  input.set(path, await readFile(`dist/${path}`));
}
const webmanifest = {
  id: base, scope: base, start_url: base, name: 'Иске имля', short_name: 'Иске имля', lang: 'tt-Cyrl', dir: 'ltr', display: 'standalone', theme_color: '#F7F4ED', background_color: '#F7F4ED',
  icons: [['icon-192', 192, 'any'], ['icon-512', 512, 'any'], ['maskable-512', 512, 'maskable']].map(([name, size, purpose]) => ({ src: `${base}releases/${placeholder}/icons/${name}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose })),
};
input.set('manifest.webmanifest', Buffer.from(JSON.stringify(webmanifest)));
const builtAt = Number(process.env.SOURCE_DATE_EPOCH ?? execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], { encoding: 'utf8' }).trim()) * 1000;
if (!Number.isSafeInteger(builtAt) || builtAt < 0) throw new Error('Invalid build timestamp');
// ID определяется шаблонными байтами: подстановка собственного пути не создаёт цикл хеширования.
const fingerprint = hash(JSON.stringify({ transport: hash(transport), files: [...input].map(([path, bytes]) => [path, hash(bytes)]), built_at: builtAt }));
const id = `${app.version}-${fingerprint.slice(0, 16)}`; const root = `${base}releases/${id}/`;
await rm('dist', { recursive: true }); await mkdir(`dist/releases/${id}`, { recursive: true });
const assets = [];
for (const [path, original] of input) {
  const bytes = /\.(?:js|css|html|webmanifest)$/u.test(path) ? Buffer.from(original.toString().replaceAll(placeholder, id)) : original;
  const target = `dist/releases/${id}/${path}`; await mkdir(target.slice(0, target.lastIndexOf('/')), { recursive: true }); await writeFile(target, bytes);
  const kind = path.endsWith('.js') ? 'script' : path.endsWith('.css') ? 'style' : path.endsWith('.woff2') ? 'font' : path.endsWith('.json') ? 'content' : path.endsWith('.html') ? 'shell' : 'media';
  assets.push({ url: root + path, sha256: hash(bytes), bytes: bytes.length, kind, required: true });
}
const html = await readFile(`dist/releases/${id}/index.html`, 'utf8');
const initial = new Set([...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map(match => match[1]));
const shell = assets.filter(asset => initial.has(asset.url) || ['index.html', 'recovery.html', 'runtime/core.json', 'manifest.webmanifest'].some(path => asset.url === root + path) || /\/assets\/Inter[^/]+\.woff2$/u.test(asset.url) || asset.url.includes('/icons/')).map(asset => asset.url);
const release = {
  release_id: id, app_version: app.version, content_version: content.content_version,
  content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: base, built_at: builtAt,
  assets, shell_assets: shell, question_revisions: content.question_revisions, policy_versions: content.policy_versions,
};
const serialized = JSON.stringify(release);
await writeFile(`dist/releases/${id}/release-manifest.json`, serialized);
await writeFile('dist/release-manifest.json', serialized);
await writeFile('dist/sw.js', transport);
await writeFile('dist/index.html', html);
await writeFile('dist/recovery.html', await readFile(`dist/releases/${id}/recovery.html`));
await writeFile('dist/manifest.webmanifest', await readFile(`dist/releases/${id}/manifest.webmanifest`));
console.log(`Release ${id}: ${assets.length} assets, ${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes`);
