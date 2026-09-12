import { bootModules } from './boot-modules.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
const graph = JSON.parse(await readFile('quality-results/bundle-graph.json', 'utf8'));
const root = `/isketatar/releases/${manifest.release_id}/`;
const gzip = new Map();
for (const chunk of graph) {
  const asset = manifest.assets.find(asset => asset.url === root + chunk.file);
  assert.ok(asset, `Missing compiled chunk: ${chunk.file}`);
  const body = await readFile(`dist/${asset.url.slice('/isketatar/'.length)}`);
  assert.equal(createHash('sha256').update(body.toString().replaceAll(manifest.release_id, '__ISKE_RELEASE__')).digest('hex'), chunk.sha256, 'Stale bundle graph');
  gzip.set(chunk.file, gzipSync(body, { level: 9 }).length);
}
assert.equal(graph.length, manifest.assets.filter(asset => asset.kind === 'script').length);
const initial = new Set();
function include(file) {
  if (initial.has(file)) return;
  const chunk = graph.find(chunk => chunk.file === file); assert.ok(chunk, `Unknown import ${file}`);
  initial.add(file); chunk.imports.forEach(include);
}
graph.filter(chunk => chunk.entry).forEach(chunk => include(chunk.file));
for (const module of bootModules) {
  const chunk = graph.find(chunk => chunk.modules.includes(module)); assert.ok(chunk, `Missing boot dependency: ${module}`); include(chunk.file);
}
const transport = await readFile('dist/sw.js');
const transportGzip = gzipSync(transport, { level: 9 }).length;
const initialBytes = transportGzip + [...initial].reduce((sum, file) => sum + gzip.get(file), 0);
// Сумма всех JS — консервативная верхняя граница любого маршрута, включая backup и retained code.
const routeUpperBound = transportGzip + [...gzip.values()].reduce((sum, bytes) => sum + bytes, 0);
let css = 0;
for (const asset of manifest.assets.filter(asset => asset.kind === 'style')) css += gzipSync(await readFile(`dist/${asset.url.slice('/isketatar/'.length)}`), { level: 9 }).length;
const fonts = manifest.assets.filter(asset => asset.kind === 'font').reduce((sum, asset) => sum + asset.bytes, 0);
const total = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0) + transport.length + (await readFile('dist/release-manifest.json')).length;
const measures = { initial_js_gzip: [initialBytes, 200 * 1024], renderer_js_gzip: [initialBytes - transportGzip, 180 * 1024], route_js_gzip_upper_bound: [routeUpperBound, 300 * 1024], css_gzip: [css, 40 * 1024], fonts: [fonts, 600 * 1024], offline_package: [total, 8 * 1024 * 1024] };
const report = { release_id: manifest.release_id, gzip_level: 9, transport_gzip: transportGzip, boot_modules: bootModules, initial_chunks: [...initial], measures };
await writeFile('quality-results/budgets.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
for (const [name, [bytes, limit]] of Object.entries(measures)) assert.ok(bytes <= limit, `${name}: ${bytes} exceeds ${limit}`);
