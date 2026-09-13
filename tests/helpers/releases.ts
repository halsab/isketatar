import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';

// Второй immutable artifact проходит тот же упаковщик, без повторной компиляции неизменного JS.
export async function releaseServer() {
  const directory = await mkdtemp(join(tmpdir(), 'isketatar-update-'));
  const original = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
  await mkdir(join(directory, 'src/generated'), { recursive: true });
  await mkdir(join(directory, 'quality-results'), { recursive: true });
  for (const path of ['package.json', 'src/generated/content-manifest.json', 'quality-results/bundle-graph.json']) await writeFile(join(directory, path), await readFile(path));
  for (const asset of original.assets) {
    const path = asset.url.split(`/releases/${original.release_id}/`)[1];
    if (path === 'manifest.webmanifest') continue;
    const destination = join(directory, 'dist', path); await mkdir(resolve(destination, '..'), { recursive: true });
    const input = await readFile('dist/' + asset.url.slice('/isketatar/'.length));
    const bytes = /\.(?:js|css|html)$/u.test(path) ? Buffer.from(input.toString().replaceAll(original.release_id, '__ISKE_RELEASE__')) : input;
    await writeFile(destination, bytes);
  }
  await writeFile(join(directory, 'dist/sw.js'), await readFile('dist/sw.js'));
  execFileSync(process.execPath, [resolve('tools/build-release.mjs')], { cwd: directory, env: { ...process.env, SOURCE_DATE_EPOCH: String(original.built_at / 1000 + 1) } });
  const next = JSON.parse(await readFile(join(directory, 'dist/release-manifest.json'), 'utf8'));
  let published = false;
  const server = await serveArtifact(path => path.startsWith(`releases/${next.release_id}/`) || published && !path.startsWith('releases/') ? join(directory, 'dist') : resolve('dist'));
  return { ...server, original: original.release_id as string, next: next.release_id as string, publish: () => { published = true; }, reset: () => { published = false; server.setUnavailable(false); }, close: async () => { await server.close(); await rm(directory, { recursive: true }); } };
}

async function serveArtifact(rootFor: (path: string) => string) {
  let unavailable = false;
  const requests: string[] = [];
  const held = new Map<string, { waiting: Promise<void>; release: () => void }>();
  const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain' };
  // Обрыв сокета повреждает сетевую сессию libsoup в Linux WebKit; 503 не отдаёт ни одного байта ресурса.
  const server = createServer(async (request, response) => {
    if (unavailable) { response.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' }).end(); return; }
    const url = new URL(request.url!, 'http://localhost'); const path = url.pathname.slice('/isketatar/'.length) || 'index.html';
    if (!url.pathname.startsWith('/isketatar/') || path.includes('..')) { response.writeHead(404).end(); return; }
    requests.push(path);
    const root = rootFor(path);
    await held.get(path)?.waiting;
    try { const body = await readFile(join(root, path)); if (unavailable) { response.writeHead(503, { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' }).end(); return; } response.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body); }
    catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('missing_test_server');
  return { url: `http://127.0.0.1:${address.port}/isketatar/`, requests, setUnavailable: (value: boolean) => { unavailable = value; },
    hold: (path: string) => { let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; }); held.set(path, { waiting, release }); return () => { held.delete(path); release(); }; },
    close: () => { for (const item of held.values()) item.release(); return new Promise<void>(resolve => server.close(() => resolve())); } };
}
export async function artifactServer() { return serveArtifact(() => resolve('dist')); }
