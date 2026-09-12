/// <reference lib="webworker" />
import { IndexedRegistry, type StoredRelease } from './registry';
import { PackageStore, type DownloadProgress } from './packages';
import { checkedResponse, fetchManifest, parseRelease, PWA_BASE, releaseRoot, sha256 } from './manifest';
import { readBoundedBytes } from '../http';
import { ReleaseLifecycle } from './lifecycle';
import { BlockedUpdate, UpdateCoordinator, type UpdatePeer } from './coordination';
import { readUpdateState } from './progress-state';
declare const self: ServiceWorkerGlobalScope;
const registry = new IndexedRegistry(); const packages = new PackageStore(registry, caches);
const lifecycle = new ReleaseLifecycle(packages);
let operation: Promise<unknown> = Promise.resolve(); let controller: AbortController | null = null;
function ownClient(client: Client) { const url = new URL(client.url); return client.type === 'window' && url.origin === self.location.origin && url.pathname.startsWith(PWA_BASE); }
async function broadcast(message: unknown) { for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) if (ownClient(client)) client.postMessage(message); }
async function windows() { return (await self.clients.matchAll({ type: 'window', includeUncontrolled: true })).filter(ownClient); }
function ask(client: Client, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = () => { clearTimeout(timeout); channel.port1.close(); };
    const timeout = setTimeout(() => { finish(); reject(new Error('update_timeout')); }, 15_000);
    channel.port1.onmessage = event => { finish(); if (event.data?.error) reject(new Error(event.data.error)); else resolve(event.data?.value); };
    try { client.postMessage({ type: 'isketatar:pwa-request', request }, [channel.port2]); }
    catch (error) { finish(); reject(error); }
  });
}
async function peers(): Promise<UpdatePeer[]> { return (await windows()).map(client => ({ id: client.id, url: client.url, request: request => ask(client, request) })); }
const coordinator = new UpdateCoordinator(lifecycle, readUpdateState, peers);
async function occupied() {
  const ids = new Set<string>(); let unknown = false;
  for (const pin of (await readUpdateState())?.pins ?? []) ids.add(pin.release_id);
  await Promise.all((await windows()).map(async client => {
    try { const value = await ask(client, { type: 'identify' }); const id = value && typeof value === 'object' ? Reflect.get(value, 'release_id') : null; if (typeof id !== 'string') throw new Error('update_unknown_client'); ids.add(id); }
    catch { unknown = true; }
  }));
  // Неизвестное окно может использовать любой сохранённый пакет: очистка ждёт его закрытия.
  if (unknown) for (const entry of (await registry.read()).releases) ids.add(entry.release_id);
  return [...ids];
}
async function state() {
  const value = await registry.read(); const manifest = value.current_release_id ? await packages.manifest(value.current_release_id) : null;
  const candidate = value.candidate_release_id ? await packages.manifest(value.candidate_release_id).catch(() => null) : null;
  return { registry: value, manifest, candidate };
}
async function registerAvailable(id: string) {
  const cached = await (await caches.open(`isketatar-shell-${id}`)).match(releaseRoot(id) + 'release-manifest.json');
  try { const fetched = await fetchManifest(releaseRoot(id) + 'release-manifest.json'); await packages.register(fetched.manifest, fetched.digest, fetched.response); }
  catch (error) {
    if (!cached) throw error;
    const bytes = await readBoundedBytes(cached, 1_000_000); const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
    if (manifest.release_id !== id) throw new Error('content_corrupt');
    await packages.register(manifest, await sha256(bytes), new Response(bytes));
  }
  return !!cached;
}
async function recoverPrevious(current: string) {
  const progress = await readUpdateState(); const value = await registry.read();
  if (progress?.control.accepted_release_id !== current || value.operation || value.previous_release_id) return;
  const pinned = [...new Set(progress.pins.map(pin => pin.release_id).filter(id => id !== current))];
  // Восстанавливаем только однозначно закреплённый выпуск, а не угадываем previous по возрасту кэшей.
  if (pinned.length !== 1 || value.candidate_release_id && value.candidate_release_id !== pinned[0]) return;
  const id = pinned[0]!;
  if (!value.releases.some(entry => entry.release_id === id)) await registerAvailable(id);
  await registry.change(state => {
    if (state.current_release_id !== current || state.operation || state.previous_release_id || state.candidate_release_id !== id) throw new Error('update_conflict');
    state.previous_release_id = id; state.candidate_release_id = null;
  });
  const complete = await packages.verify(id);
  await registry.change(state => { const entry = state.releases.find(item => item.release_id === id)!; entry.completeness = complete ? 'ready' : 'incomplete'; entry.verified_at = complete ? Date.now() : null; });
}
async function initialize(id: string) {
  const value = await registry.read();
  let recovered = false;
  if (value.current_release_id && value.current_release_id !== id) throw new Error('release_not_current');
  if (!value.releases.some(entry => entry.release_id === id)) {
    recovered = await registerAvailable(id);
  }
  await packages.saveShell(id);
  const entry = (await registry.read()).releases.find(item => item.release_id === id)!;
  if (recovered || ['ready', 'downloading', 'verifying'].includes(entry.completeness)) {
    const complete = await packages.verify(id);
    await registry.change(value => { const current = value.releases.find(item => item.release_id === id)!; current.completeness = complete ? 'ready' : 'incomplete'; current.verified_at = complete ? Date.now() : null; });
  }
  await recoverPrevious(id).catch(() => { /* Недоступный pinned-пакет остаётся защищён от очистки; текущий курс доступен. */ });
}
// Активация транспорта не принимает новый курс и не удаляет сохранённые выпуски.
self.addEventListener('install', () => {});
self.addEventListener('activate', () => {});
self.addEventListener('message', event => {
  const source = event.source; const port = event.ports[0];
  if (!source || !('type' in source) || !ownClient(source as Client) || !port) return;
  const message: unknown = event.data;
  if (!message || typeof message !== 'object' || !['initialize', 'status', 'download', 'cancel', 'verify', 'release', 'check', 'check-auto', 'download-update', 'repair-update', 'accept', 'cancel-update', 'finish-update', 'accepted', 'boot', 'request-update'].includes(Reflect.get(message, 'type'))) return;
  const type: string = Reflect.get(message, 'type'); const id: unknown = Reflect.get(message, 'release_id');
  const reply = async () => {
    try {
      const updateId: unknown = Reflect.get(message, 'update_id');
      if (['accept', 'cancel-update', 'finish-update'].includes(type) && (typeof updateId !== 'string' || !updateId || updateId.length > 256)) throw new Error('stale_update');
      if (type === 'boot' || type === 'accepted') {
        const value = await registry.read(); const progress = await readUpdateState();
        if (typeof id !== 'string' || value.current_release_id !== id) throw new Error('release_not_current');
        if (value.operation?.phase === 'committed' && !await packages.verify(id)) throw new Error('retained_incomplete');
        port.postMessage({ value: { registry: value, progress, protocol: 1 } }); return;
      }
      if (type === 'request-update') {
        const progress = await readUpdateState(); if (!progress?.control.writer_id) throw new Error('update_not_coordinator');
        let delivered = false;
        await Promise.all((await windows()).map(async client => {
          try { const identity = await ask(client, { type: 'identify' }); if (identity && typeof identity === 'object' && Reflect.get(identity, 'tab_id') === progress.control.writer_id && Reflect.get(identity, 'mode') === 'durable') { client.postMessage({ type: 'isketatar:pwa-update-requested' }); delivered = true; } }
          catch { /* Неответившее окно не получает право записи и не считается согласившимся. */ }
        }));
        if (!delivered) throw new Error('update_writer_unavailable');
      }
      if (type === 'check' || type === 'check-auto') {
        if ((await readUpdateState())?.control.update_gate || (await registry.read()).operation) throw new Error('update_in_progress');
        const now = Date.now(); let check = false;
        await registry.change(value => { if (type === 'check' || value.checked_at === undefined || now - value.checked_at >= 3_600_000) { value.checked_at = now; check = true; } });
        if (check) { const busy = await occupied(); await lifecycle.cleanup(now, busy); await lifecycle.check(busy); }
      }
      if (type === 'download-update' || type === 'repair-update') {
        let value = await registry.read(); const progress = await readUpdateState();
        if (type === 'repair-update') {
          const gate = progress?.control.update_gate; const identity = await ask(source as Client, { type: 'identify' });
          if (!gate || gate.update_id !== updateId || id !== gate.target_release_id || !identity || typeof identity !== 'object' || Reflect.get(identity, 'tab_id') !== gate.coordinator_id || Reflect.get(identity, 'mode') !== 'durable') throw new Error('update_not_coordinator');
          if (!value.releases.some(entry => entry.release_id === id)) { await registerAvailable(gate.target_release_id); value = await registry.read(); }
        } else if (progress?.control.update_gate || value.operation) throw new Error('update_in_progress');
        if (typeof id !== 'string' || id !== (value.operation?.phase === 'committed' ? value.current_release_id : value.candidate_release_id)) throw new Error('update_conflict');
        if (progress?.pins.some(pin => pin.release_id !== (value.operation?.from_release_id ?? value.current_release_id))) throw new Error('release_pinned');
        controller = new AbortController();
        try { for (const release of new Set([id, ...(progress?.pins.map(pin => pin.release_id) ?? [])])) await packages.download(release, controller.signal, progress => { port.postMessage({ progress }); void broadcast({ type: 'isketatar:pwa-progress', progress }); }, false); }
        finally { controller = null; }
      }
      if (type === 'accept') {
        const result = await coordinator.run(updateId as string, (source as Client).id);
        // Transport v1 совместим с этим протоколом; естественная активация waiting worker не меняет роли.
        for (const client of await windows()) if (result.clients.includes(client.id)) client.postMessage({ type: 'isketatar:pwa-reload', operation: result.operation });
      }
      if (type === 'cancel-update') {
        const progress = await readUpdateState(); const gate = progress?.control.update_gate; const value = await registry.read();
        if (!progress || !gate || gate.update_id !== updateId || gate.phase !== 'quiescing' || value.operation?.phase === 'committed') throw new Error('stale_update');
        const identity = await ask(source as Client, { type: 'identify' });
        if (!identity || typeof identity !== 'object' || Reflect.get(identity, 'tab_id') !== gate.coordinator_id || Reflect.get(identity, 'mode') !== 'durable') throw new Error('update_not_coordinator');
        if (value.operation) await lifecycle.cancel(updateId as string);
        await ask(source as Client, { type: 'cancel', operation: { ...gate, data_generation: progress.control.data_generation, writer_epoch: progress.control.writer_epoch } });
        if ((await readUpdateState())?.control.update_gate) throw new Error('update_in_progress');
        await broadcast({ type: 'isketatar:pwa-cancelled', update_id: updateId });
      }
      if (type === 'finish-update') {
        const value = await registry.read(); const progress = await readUpdateState();
        if (progress?.control.update_gate || id !== value.current_release_id) throw new Error('stale_update');
        if (value.operation) { if (value.operation.update_id !== updateId || !await packages.verify(id as string)) throw new Error('retained_incomplete'); await lifecycle.finish(updateId as string, progress?.pins ?? [], await occupied()); }
      }
      if (type === 'release') {
        const value = await registry.read();
        if (typeof id !== 'string' || ![value.current_release_id, value.previous_release_id].includes(id)) throw new Error('content_unavailable');
        const entry = value.releases.find(item => item.release_id === id); if (!entry) throw new Error('content_unavailable');
        port.postMessage({ value: { manifest: await packages.manifest(id), digest: entry.manifest_sha256 } }); return;
      }
      if (type === 'initialize') { if (typeof id !== 'string') throw new Error('content_corrupt'); await initialize(id); }
      if (type === 'download' || type === 'verify') {
        if ((await readUpdateState())?.control.update_gate || (await registry.read()).operation) throw new Error('update_in_progress');
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
      port.postMessage({ error: code, ...(error instanceof BlockedUpdate ? { blockers: error.blockers } : {}) });
      try { await broadcast({ type: 'isketatar:pwa-state', value: await state() }); } catch { /* Недоступный реестр не затрагивает результаты обучения. */ }
    } finally { port.close(); }
  };
  if (type === 'cancel') { controller?.abort(); event.waitUntil(reply()); }
  else if (['status', 'release', 'boot', 'accepted'].includes(type)) event.waitUntil(reply());
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
      let value = await registry.read();
      if (!value.current_release_id && (navigation || request.mode === 'navigate' && immutable && ['index.html', 'recovery.html'].includes(immutable[2]!))) {
        const accepted = (await readUpdateState())?.control.accepted_release_id;
        if (accepted) {
          operation = operation.catch(() => {}).then(async () => { if (!(await registry.read()).current_release_id) await initialize(accepted); });
          await operation; value = await registry.read();
        }
      }
      const id = immutable?.[1] ?? value.current_release_id;
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
