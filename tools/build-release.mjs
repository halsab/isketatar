import { bootModules, initialModules } from './boot-modules.mjs';
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { productScope } from './product-scope.mjs';
import { verifyArtifact } from './release-artifact.mjs';

const sourceRoot = resolve(import.meta.dirname, '..');
const sourceGit = args => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' }).trim();
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
const graph = JSON.parse(await readFile('quality-results/bundle-graph.json', 'utf8'));
const templateRoot = `${base}releases/${placeholder}/`;
const shellPaths = new Set([...input.get('index.html').toString().matchAll(/(?:src|href)="([^"]+)"/gu)].map(match => match[1]).filter(url => url.startsWith(templateRoot)).map(url => url.slice(templateRoot.length)));
for (const path of input.keys()) if (['index.html', 'recovery.html', 'runtime/core.json', 'manifest.webmanifest'].includes(path) || /^assets\/Inter[^/]+\.woff2$/u.test(path) || path.startsWith('icons/')) shellPaths.add(path);
const shellChunks = new Set();
function includeChunk(file, paths = shellPaths, chunks = shellChunks) {
  if (chunks.has(file)) return;
  const chunk = graph.find(chunk => chunk.file === file);
  if (!chunk) throw new Error(`Missing shell chunk: ${file}`);
  chunks.add(file); paths.add(file);
  for (const css of chunk.css) paths.add(css);
  chunk.imports.forEach(file => includeChunk(file, paths, chunks));
}
graph.filter(chunk => chunk.entry).forEach(chunk => includeChunk(chunk.file));
for (const module of bootModules) {
  const chunk = graph.find(chunk => chunk.modules.includes(module));
  if (!chunk) throw new Error(`Missing boot module: ${module}`);
  includeChunk(chunk.file);
}
for (const path of shellPaths) if (!input.has(path)) throw new Error(`Missing shell asset: ${path}`);
const sortedShellPaths = [...shellPaths].sort();
const index = input.get('index.html').toString();
const hinted = new Set([...index.matchAll(/(?:src|href)="([^"]+)"/gu)].map(match => match[1]));
const preloadPaths = new Set(); const preloadChunks = new Set();
graph.filter(chunk => chunk.entry || initialModules.some(module => chunk.modules.includes(module))).forEach(chunk => includeChunk(chunk.file, preloadPaths, preloadChunks));
const hints = [...preloadPaths].sort().filter(path => /\.(?:js|css)$/u.test(path) && !hinted.has(templateRoot + path))
  .map(path => `<link rel="${path.endsWith('.js') ? 'modulepreload' : 'preload'}"${path.endsWith('.css') ? ' as="style"' : ''} crossorigin href="${templateRoot + path}">`).join('\n');
if (hints) input.set('index.html', Buffer.from(index.replace('</head>', `${hints}\n</head>`)));
const header = { app_version: app.version, content_version: content.content_version,
  content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: base, built_at: builtAt,
  question_revisions: content.question_revisions, policy_versions: content.policy_versions };
// ID определяется шаблонными байтами: подстановка собственного пути не создаёт цикл хеширования.
const fingerprintInput = { transport: hash(transport), files: [...input].map(([path, bytes]) => [path, hash(bytes)]), header, shell_paths: sortedShellPaths };
const fingerprint = hash(JSON.stringify(fingerprintInput));
const { built_at: _builtAt, ...productHeader } = header;
// Запись заключения меняет commit timestamp, но не проверенные исполняемые байты и продуктовые версии.
const productArtifact = hash(JSON.stringify({ ...fingerprintInput, header: productHeader }));
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
const release = { release_id: id, ...header, assets, shell_assets: sortedShellPaths.map(path => root + path) };
const serialized = JSON.stringify(release);
await writeFile(`dist/releases/${id}/release-manifest.json`, serialized);
await writeFile('dist/release-manifest.json', serialized);
await writeFile('dist/sw.js', transport);
await writeFile('dist/index.html', html);
await writeFile('dist/recovery.html', await readFile(`dist/releases/${id}/recovery.html`));
await writeFile('dist/manifest.webmanifest', await readFile(`dist/releases/${id}/manifest.webmanifest`));
await mkdir('quality-results', { recursive: true });
await writeFile('quality-results/build-provenance.json', JSON.stringify({
  release_id: id, manifest_sha256: hash(serialized), build_inputs_sha256: fingerprint,
  artifact_sha256: (await verifyArtifact('dist')).sha256,
  product_artifact_sha256: productArtifact, product_scope_sha256: (await productScope(sourceRoot)).sha256,
  node_version: process.version,
  base_commit: sourceGit(['rev-parse', 'HEAD']),
  working_tree_dirty: resolve(process.cwd()) !== sourceRoot || sourceGit(['status', '--porcelain', '--untracked-files=normal']).length > 0,
}, null, 2) + '\n');
console.log(`Release ${id}: ${assets.length} assets, ${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes`);
