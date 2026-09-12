/// <reference lib="webworker" />
import { IndexedRegistry, type StoredRelease } from './registry';
import { PackageStore, type DownloadProgress } from './packages';
import { checkedResponse, fetchManifest, parseRelease, PWA_BASE, releaseRoot, sha256 } from './manifest';
import { readBoundedBytes } from '../http';
declare const self: ServiceWorkerGlobalScope;
const registry = new IndexedRegistry(); const packages = new PackageStore(registry, caches);
let operation: Promise<unknown> = Promise.resolve(); let controller: AbortController | null = null;
function ownClient(client: Client) { const url = new URL(client.url); return client.type === 'window' && url.origin === self.location.origin && url.pathname.startsWith(PWA_BASE); }
async function broadcast(message: unknown) { for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if (ownClient(client)) client.postMessage(message); }
async function state() {
  const value = await registry.read(); const manifest = value.current_release_id ? await packages.manifest(value.current_release_id) : null;
  return { registry: value, manifest };
}
async function initialize(id: string) {
  const value = await registry.read();
  if (value.current_release_id && value.current_release_id !== id) throw new Error('release_not_current');
  if (!value.releases.some(entry => entry.release_id === id)) {
    try { const fetched = await fetchManifest(releaseRoot(id) + 'release-manifest.json'); await packages.register(fetched.manifest, fetched.digest, fetched.response); }
    catch (error) {
      const cached = await (await caches.open(`isketatar-shell-${id}`)).match(releaseRoot(id) + 'release-manifest.json');
      if (!cached) throw error;
      const bytes = await readBoundedBytes(cached, 1_000_000); const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
      if (manifest.release_id !== id) throw new Error('content_corrupt');
      await packages.register(manifest, await sha256(bytes), new Response(bytes));
    }
  }
  await packages.saveShell(id);
  const entry = (await registry.read()).releases.find(item => item.release_id === id)!;
  if (['ready', 'downloading', 'verifying'].includes(entry.completeness)) {
    const complete = await packages.verify(id);
    await registry.change(value => { const current = value.releases.find(item => item.release_id === id)!; current.completeness = complete ? 'ready' : 'incomplete'; current.verified_at = complete ? Date.now() : null; });
  }
}
// Активация транспорта не принимает новый курс и не удаляет сохранённые выпуски.
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});
self.addEventListener('message', event => {
  const source = event.source; const port = event.ports[0];
  if (!source || !('type' in source) || !ownClient(source as Client) || !port) return;
  const message: unknown = event.data;
  if (!message || typeof message !== 'object' || !['initialize', 'status', 'download', 'cancel', 'verify', 'release'].includes(Reflect.get(message, 'type'))) return;
  const type: string = Reflect.get(message, 'type'); const id: unknown = Reflect.get(message, 'release_id');
  const reply = async () => {
    try {
      if (type === 'release') {
        const value = await registry.read();
        if (typeof id !== 'string' || ![value.current_release_id, value.previous_release_id].includes(id)) throw new Error('content_unavailable');
        const entry = value.releases.find(item => item.release_id === id); if (!entry) throw new Error('content_unavailable');
        port.postMessage({ value: { manifest: await packages.manifest(id), digest: entry.manifest_sha256 } }); return;
      }
      if (type === 'initialize') { if (typeof id !== 'string') throw new Error('content_corrupt'); await initialize(id); }
      if (type === 'download' || type === 'verify') {
        const current = (await registry.read()).current_release_id;
        if (id !== current || !current) throw new Error('release_not_current');
        if (type === 'verify') { const complete = await packages.verify(current); await registry.change(value => { const entry = value.releases.find(item => item.release_id === current)!; entry.completeness = complete ? 'ready' : 'incomplete'; entry.verified_at = complete ? Date.now() : null; }); }
        else {
          controller = new AbortController(); let last = 0;
          try { await packages.download(current, controller.signal, (progress: DownloadProgress) => { port.postMessage({ progress }); if (Date.now() - last > 250 || progress.count === progress.total) { last = Date.now(); void broadcast({ type: 'isketatar:pwa-progress', progress }); } }); }
          finally { controller = null; }
        }
      }
      const value = await state(); port.postMessage({ value }); await broadcast({ type: 'isketatar:pwa-state', value });
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'QuotaExceededError' ? 'quota' : error instanceof Error ? error.name === 'AbortError' ? 'cancelled' : error.message : 'pwa_storage_unavailable';
      port.postMessage({ error: code });
      try { await broadcast({ type: 'isketatar:pwa-state', value: await state() }); } catch { /* Недоступный реестр не затрагивает результаты обучения. */ }
    } finally { port.close(); }
  };
  if (type === 'cancel') { controller?.abort(); event.waitUntil(reply()); }
  else if (type === 'status' || type === 'release') event.waitUntil(reply());
  else { operation = operation.catch(() => {}).then(reply); event.waitUntil(operation); }
});
self.addEventListener('fetch', event => {
  const request = event.request; const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith(PWA_BASE) || url.search) return;
  const immutable = /^\/isketatar\/releases\/(\d+\.\d+\.\d+-[a-f0-9]{16})\/(.+)$/u.exec(url.pathname);
  const navigation = request.mode === 'navigate' && [PWA_BASE, PWA_BASE + 'index.html', PWA_BASE + 'recovery.html'].includes(url.pathname);
  const manifest = url.pathname === PWA_BASE + 'manifest.webmanifest';
  if (!immutable && !navigation && !manifest) return;
  event.respondWith((async () => {
    let fallback = request.url; let retained: StoredRelease | undefined;
    try {
      const value = await registry.read(); const id = immutable?.[1] ?? value.current_release_id;
      if (!id || !value.releases.some(entry => entry.release_id === id)) return fetch(request);
      const path = immutable ? url.pathname : releaseRoot(id) + (manifest ? 'manifest.webmanifest' : url.pathname.endsWith('recovery.html') ? 'recovery.html' : 'index.html');
      fallback = new URL(path, self.location.origin).href; retained = value.releases.find(entry => entry.release_id === id);
      if (path.endsWith('/release-manifest.json')) {
        return await packages.manifestResponse(id);
      }
      const response = await packages.resource(id, path);
      if (value.releases.find(item => item.release_id === id)?.completeness === 'ready' && (await registry.read()).releases.find(item => item.release_id === id)?.completeness !== 'ready') await broadcast({ type: 'isketatar:pwa-state', value: await state() });
      return response;
    } catch (error) {
      if (!(error instanceof Error) || !['content_corrupt', 'content_unavailable'].includes(error.message)) {
        try {
          if (retained) {
            const fetched = await fetchManifest(retained.manifest_url, retained.manifest_sha256);
            const path = new URL(fallback).pathname;
            if (path === retained.manifest_url) return fetched.response;
            const asset = fetched.manifest.assets.find(item => item.url === path);
            if (!asset) throw new Error('content_unavailable');
            return await checkedResponse(await fetch(fallback, { redirect: 'error' }), asset);
          }
          return await fetch(fallback, { redirect: 'error' });
        } catch { /* Онлайн-обход хранилища также может быть недоступен. */ }
      }
      return new Response('', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  })());
});
