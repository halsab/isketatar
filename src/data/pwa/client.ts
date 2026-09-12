import { PWA_BASE, type PackageManifest } from './manifest';
import type { DownloadProgress } from './packages';
import type { Registry } from './registry';
interface WorkerState { registry: Registry; manifest: PackageManifest | null }
export interface OfflineState { supported: boolean | null; loading: boolean; registry: Registry | null; manifest: PackageManifest | null; progress: DownloadProgress | null; error: string | null }
class OfflineClient {
  private value: OfflineState = { supported: null, loading: false, registry: null, manifest: null, progress: null, error: null };
  private listeners = new Set<() => void>(); private registration: ServiceWorkerRegistration | null = null; private starting: Promise<void> | null = null;
  getState = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<OfflineState>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
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
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.source !== this.registration?.active) return;
        if (event.data?.type === 'isketatar:pwa-state') this.publish({ ...event.data.value, progress: null });
        if (event.data?.type === 'isketatar:pwa-progress') this.publish({ progress: event.data.progress });
      });
      await this.perform('initialize', id);
      const refresh = () => { if (document.visibilityState === 'visible') void this.perform('status').catch(() => {}); };
      window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    } catch (error) { this.publish({ error: error instanceof Error ? error.message : 'pwa_unavailable', loading: false }); this.starting = null; }
  }
  private request<T = WorkerState>(type: string, releaseId?: string): Promise<T> {
    const worker = this.registration?.active;
    if (!worker || worker.scriptURL !== new URL(PWA_BASE + 'sw.js', location.origin).href || worker.state !== 'activated') return Promise.reject(new Error('pwa_unavailable'));
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel(); let timeout: ReturnType<typeof setTimeout>;
      const end = () => { clearTimeout(timeout); channel.port1.close(); };
      const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => { end(); reject(new Error('pwa_unavailable')); }, 45_000); }; resetTimeout();
      channel.port1.onmessage = event => {
        if (event.data.progress) { this.publish({ progress: event.data.progress }); resetTimeout(); return; }
        end(); if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.value);
      };
      worker.postMessage({ type, release_id: releaseId }, [channel.port2]);
    });
  }
  async retainedManifest(id: string) { return this.request<{ manifest: PackageManifest; digest: string }>('release', id); }
  async perform(type: 'initialize' | 'status' | 'download' | 'cancel' | 'verify', releaseId?: string) {
    if (type !== 'status') this.publish({ loading: true, error: null });
    try { const value = await this.request(type, releaseId); this.publish({ ...value, error: null, ...(type === 'status' ? {} : { progress: null }) }); }
    catch (error) { if (!(error instanceof Error && error.message === 'cancelled')) this.publish({ error: error instanceof Error ? error.message : 'pwa_unavailable' }); throw error; }
    finally { if (type !== 'status') this.publish({ loading: false }); }
  }
}
export const offline = new OfflineClient();
