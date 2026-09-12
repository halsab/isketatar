import { PWA_BASE, type PackageManifest } from './manifest';
import type { DownloadProgress } from './packages';
import type { Registry } from './registry';
import type { UpdateState } from './coordination';
import type { Preparation, UpdateBlocker } from './coordination';
interface WorkerState { registry: Registry; manifest: PackageManifest | null; candidate: PackageManifest | null }
interface UpdateHost {
  identify(): { tab_id: string; release_id: string; mode: 'durable' | 'memory' };
  prepare(request: Preparation, discardMemory?: boolean): Promise<unknown>;
  commit(request: Preparation): Promise<unknown>; cancel(request: Preparation): Promise<void>; cancelled(id: string): Promise<void>;
  reconcile(): Promise<string | null>;
}
export interface OfflineState { supported: boolean | null; loading: boolean; registry: Registry | null; manifest: PackageManifest | null; candidate: PackageManifest | null; progress: DownloadProgress | null; error: string | null; update: { operation: Preparation | null; memoryRequest: Preparation | null; requested: boolean; blockers: UpdateBlocker[]; error: string | null } }
class OfflineClient {
  private value: OfflineState = { supported: null, loading: false, registry: null, manifest: null, candidate: null, progress: null, error: null, update: { operation: null, memoryRequest: null, requested: false, blockers: [], error: null } };
  private listeners = new Set<() => void>(); private registration: ServiceWorkerRegistration | null = null; private starting: Promise<void> | null = null;
  private host: UpdateHost | null = null; private readyFor: string | null = null; private reloading = false; private listening = false;
  bind(host: UpdateHost) { this.host = host; }
  getState = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<OfflineState>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
  private update(patch: Partial<OfflineState['update']>) { this.publish({ update: { ...this.value.update, ...patch } }); }
  start(id: string) {
    return this.starting ??= this.initialize(id);
  }
  private async initialize(id: string) {
    if (import.meta.env.DEV || !('serviceWorker' in navigator) || !('caches' in globalThis) || !globalThis.isSecureContext) { this.publish({ supported: false }); return; }
    this.publish({ supported: true, loading: true, error: null });
    try {
      this.registration = await navigator.serviceWorker.register(PWA_BASE + 'sw.js', { scope: PWA_BASE, updateViaCache: 'none' });
      const active = this.registration.active;
      if (!active || active.state !== 'activated') {
        const installing = this.registration.installing ?? this.registration.waiting;
        if (!installing) throw new Error('pwa_unavailable');
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => { installing.removeEventListener('statechange', change); reject(new Error('pwa_unavailable')); }, 30_000);
          const change = () => { if (installing.state === 'activated' || installing.state === 'redundant') { clearTimeout(timeout); installing.removeEventListener('statechange', change); if (installing.state === 'activated') resolve(); else reject(new Error('pwa_unavailable')); } };
          installing.addEventListener('statechange', change); change();
        });
      }
      if (!this.listening) {
        this.listening = true;
        navigator.serviceWorker.addEventListener('message', event => { if (event.source === this.registration?.active) void this.message(event); });
        navigator.serviceWorker.addEventListener('controllerchange', () => { void this.perform('status').then(() => this.reloadIfAccepted()).catch(() => {}); });
        const refresh = () => { if (document.visibilityState === 'visible') { void this.perform('status').then(() => this.reloadIfAccepted()).catch(() => {}); void this.check(false); } };
        window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
      }
      await this.perform('initialize', id);
      void this.check(false);
    } catch (error) { this.publish({ error: error instanceof Error ? error.message : 'pwa_unavailable', loading: false }); this.starting = null; }
  }
  private async message(event: MessageEvent) {
    if (event.data?.type === 'isketatar:pwa-state') { this.publish({ ...event.data.value, progress: null }); await this.reconcile(); await this.reloadIfAccepted(); }
    if (event.data?.type === 'isketatar:pwa-progress') this.publish({ progress: event.data.progress });
    if (event.data?.type === 'isketatar:pwa-update-requested') this.update({ requested: true });
    if (event.data?.type === 'isketatar:pwa-reload') await this.reloadIfAccepted(event.data.operation);
    if (event.data?.type === 'isketatar:pwa-cancelled') {
      try {
        await this.host?.cancelled(event.data.update_id);
        if (this.value.update.operation?.update_id === event.data.update_id) { this.readyFor = null; this.update({ operation: null, memoryRequest: null, blockers: [], error: null }); }
      } catch (error) { this.update({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); }
    }
    if (event.data?.type !== 'isketatar:pwa-request' || !event.ports[0]) return;
    const port = event.ports[0]; const request = event.data.request;
    try {
      if (!this.host) throw new Error('update_unknown_client');
      let value: unknown;
      if (request.type === 'identify') value = this.host.identify();
      else if (request.type === 'prepare') {
        this.update({ operation: request.operation, error: null });
        value = await this.host.prepare(request.operation); this.readyFor = request.operation.purpose ? null : request.operation.update_id;
      } else if (request.type === 'commit') value = await this.host.commit(request.operation);
      else if (request.type === 'cancel') {
        value = await this.host.cancel(request.operation);
        if (this.value.update.operation?.update_id === request.operation.update_id) { this.readyFor = null; this.update({ operation: null, memoryRequest: null, blockers: [], error: null }); }
      }
      else throw new Error('update_unknown_client');
      port.postMessage({ value });
    } catch (error) {
      const code = error instanceof Error ? error.message : 'update_unknown_client';
      if (code === 'update_memory_mode') this.update({ memoryRequest: request.operation });
      this.update({ error: code }); port.postMessage({ error: code });
    } finally { port.close(); }
  }
  private async reconcile() {
    try {
      const id = await this.host?.reconcile();
      if (id && this.value.update.operation?.update_id === id) { this.readyFor = null; this.update({ operation: null, memoryRequest: null, blockers: [], error: null }); }
    } catch (error) { this.update({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); }
  }
  private async reloadIfAccepted(operation = this.value.update.operation) {
    if (!operation || operation.purpose || this.readyFor !== operation.update_id || this.reloading) return;
    if (this.value.registry?.current_release_id !== operation.target_release_id) return;
    try {
      const proof = await this.verifyBoot(operation.target_release_id);
      if (proof.protocol !== 1 || proof.registry.current_release_id !== operation.target_release_id || this.readyFor !== operation.update_id || this.reloading) return;
      this.reloading = true;
      window.location.replace(PWA_BASE + 'index.html' + location.hash);
    } catch (error) { this.update({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); }
  }
  async acceptMemoryLoss() {
    const request = this.value.update.memoryRequest;
    if (!request || !this.host) throw new Error('stale_update');
    await this.host.prepare(request, true); this.readyFor = request.update_id;
    this.update({ memoryRequest: null, error: null }); await this.perform('request-update');
  }
  async check(explicit = true) {
    if (!this.registration?.active) return;
    if (explicit) this.publish({ loading: true, error: null });
    try { const value = await this.request(explicit ? 'check' : 'check-auto'); this.publish(value); if (explicit) await this.registration.update().catch(() => {}); }
    catch (error) { if (explicit) this.publish({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); }
    finally { if (explicit) this.publish({ loading: false }); }
  }
  private request<T = WorkerState>(type: string, releaseId?: string, updateId?: string): Promise<T> {
    const worker = this.registration?.active;
    if (!worker || worker.scriptURL !== new URL(PWA_BASE + 'sw.js', location.origin).href || worker.state !== 'activated') return Promise.reject(new Error('pwa_unavailable'));
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel(); let timeout: ReturnType<typeof setTimeout>;
      const end = () => { clearTimeout(timeout); channel.port1.close(); };
      const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => { end(); reject(new Error('pwa_unavailable')); }, 45_000); }; resetTimeout();
      channel.port1.onmessage = event => {
        if (event.data.progress) { this.publish({ progress: event.data.progress }); resetTimeout(); return; }
        end(); if (event.data.error) reject(Object.assign(new Error(event.data.error), { blockers: event.data.blockers })); else resolve(event.data.value);
      };
      worker.postMessage({ type, release_id: releaseId, update_id: updateId, offline_epoch: this.value.registry?.offline_epoch ?? 0 }, [channel.port2]);
    });
  }
  async retainedManifest(id: string) { return this.request<{ manifest: PackageManifest; digest: string }>('release', id); }
  async verifyBoot(id: string) { return this.request<{ registry: Registry; progress: UpdateState | null; protocol: number }>('boot', id); }
  async finishBoot(id: string, updateId: string) { await this.request('finish-update', id, updateId); }
  async accept(request: Preparation) {
    this.update({ operation: request, blockers: [], error: null, requested: false }); this.publish({ loading: true });
    try { const value = await this.request(request.purpose === 'remove_offline' ? 'remove-offline' : 'accept', undefined, request.update_id); this.publish(value); await this.reloadIfAccepted(); }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'pwa_unavailable', blockers: error && typeof error === 'object' && Array.isArray(Reflect.get(error, 'blockers')) ? Reflect.get(error, 'blockers') : [] }); throw error; }
    finally { this.publish({ loading: false }); }
  }
  async cancelUpdate(updateId: string) { const value = await this.request('cancel-update', undefined, updateId); this.publish(value); }
  async repairUpdate(request: Preparation) { const value = await this.request('repair-update', request.target_release_id, request.update_id); this.publish(value); }
  async perform(type: 'initialize' | 'status' | 'download' | 'cancel' | 'verify' | 'download-update' | 'request-update', releaseId?: string) {
    if (type !== 'status') this.publish({ loading: true, error: null });
    try { const value = await this.request(type, releaseId); this.publish({ ...value, error: null, ...(type === 'status' ? {} : { progress: null }) }); if (type === 'status') await this.reconcile(); }
    catch (error) { if (!(error instanceof Error && error.message === 'cancelled')) this.publish({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); throw error; }
    finally { if (type !== 'status') this.publish({ loading: false }); }
  }
}
export const offline = new OfflineClient();
