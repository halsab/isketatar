import { checkedResponse, fetchManifest, parseRelease, releaseRoot, sha256, type PackageManifest } from './manifest';
import { readBoundedBytes } from '../http';
import type { RegistryStore, StoredRelease } from './registry';
export interface DownloadProgress { phase: 'downloading' | 'verifying'; count: number; total: number; bytes: number; total_bytes: number }
export class PackageStore {
  private readonly manifests = new Map<string, PackageManifest>();
  constructor(readonly registry: RegistryStore, readonly cacheStorage: CacheStorage, private readonly request: typeof fetch = (input, init) => fetch(input, init)) {}
  async register(manifest: PackageManifest, digest: string, response: Response) {
    parseRelease(manifest); const id = manifest.release_id;
    const bytes = await readBoundedBytes(response, 1_000_000);
    if (await sha256(bytes) !== digest) throw new Error('content_corrupt');
    const value = await this.registry.read(); const existing = value.releases.find(item => item.release_id === id);
    if (existing && existing.manifest_sha256 !== digest) throw new Error('content_corrupt');
    if (!existing && (value.operation || value.releases.length >= 3)) throw new Error('release_slots_full');
    const entry: StoredRelease = existing ?? { release_id: id, manifest_url: releaseRoot(id) + 'release-manifest.json', manifest_sha256: digest, shell_cache: `isketatar-shell-${id}`, course_cache: `isketatar-course-${id}`, completeness: 'not_saved', verified_at: null, created_at: Date.now() };
    await (await this.cacheStorage.open(entry.shell_cache)).put(entry.manifest_url, new Response(bytes, { headers: { 'content-type': 'application/json' } }));
    await this.registry.change(state => {
      if (!state.releases.some(item => item.release_id === id)) {
        if (state.operation || state.releases.length >= 3) throw new Error('release_slots_full');
        state.releases.push(entry);
        if (!state.current_release_id) state.current_release_id = id; else if (!state.candidate_release_id) state.candidate_release_id = id; else throw new Error('release_slots_full');
      }
    });
    this.manifests.set(id, manifest);
  }
  async manifest(id: string): Promise<PackageManifest> {
    const existing = this.manifests.get(id); if (existing) return existing;
    const { manifest } = await this.readManifest(id); this.manifests.set(id, manifest); return manifest;
  }
  forget(id: string) { this.manifests.delete(id); }
  private async readManifest(id: string): Promise<{ manifest: PackageManifest; response: Response }> {
    const entry = await this.entry(id);
    const cache = await this.cacheStorage.open(entry.shell_cache); const cached = await cache.match(entry.manifest_url);
    if (cached) {
      try {
        const bytes = await readBoundedBytes(cached, 1_000_000);
        if (await sha256(bytes) !== entry.manifest_sha256) throw new Error('content_corrupt');
        const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
        if (manifest.release_id !== id) throw new Error('content_corrupt');
        return { manifest, response: new Response(bytes, { headers: { 'content-type': 'application/json' } }) };
      } catch { await cache.delete(entry.manifest_url); }
    }
    await this.incomplete(id);
    const fetched = await fetchManifest(entry.manifest_url, entry.manifest_sha256, undefined, this.request);
    await this.register(fetched.manifest, fetched.digest, fetched.response.clone());
    return { manifest: fetched.manifest, response: fetched.response };
  }
  async manifestResponse(id: string) { return (await this.readManifest(id)).response; }
  private async entry(id: string) { const entry = (await this.registry.read()).releases.find(item => item.release_id === id); if (!entry) throw new Error('content_unavailable'); return entry; }
  private async cacheFor(id: string, url: string) {
    const [entry, manifest] = await Promise.all([this.entry(id), this.manifest(id)]);
    return this.cacheStorage.open(manifest.shell_assets.includes(url) ? entry.shell_cache : entry.course_cache);
  }
  async resource(id: string, url: string, cacheOnly = false): Promise<Response> {
    const manifest = await this.manifest(id); const asset = manifest.assets.find(item => item.url === url);
    if (!asset) throw new Error('content_unavailable');
    const cache = await this.cacheFor(id, url); const cached = await cache.match(url);
    if (cached) {
      try { return await checkedResponse(cached, asset); }
      catch { await cache.delete(url); await this.incomplete(id); }
    } else if ((await this.entry(id)).completeness === 'ready') await this.incomplete(id);
    if (cacheOnly) throw new Error('content_unavailable');
    const response = await checkedResponse(await this.request(url, { redirect: 'error', cache: 'no-store' }), asset);
    if (manifest.shell_assets.includes(url)) await cache.put(url, response.clone());
    return response;
  }
  private async incomplete(id: string) { await this.registry.change(state => { const entry = state.releases.find(item => item.release_id === id); if (entry?.completeness === 'ready') { entry.completeness = 'incomplete'; entry.verified_at = null; } }); }
  async saveShell(id: string) { const manifest = await this.manifest(id); for (const url of manifest.shell_assets) await this.resource(id, url); }
  async verify(id: string): Promise<boolean> {
    try {
      await this.manifestResponse(id);
      const manifest = await this.manifest(id);
      for (const asset of manifest.assets) {
        const response = await this.resource(id, asset.url, true);
        if (asset.url.endsWith('/runtime/core.json')) {
          const core: unknown = await response.json();
          if (!core || typeof core !== 'object' || Reflect.get(core, 'content_schema') !== manifest.content_schema || Reflect.get(core, 'content_version') !== manifest.content_version) throw new Error('content_corrupt');
          const questions: unknown = Reflect.get(core, 'questions');
          if (!Array.isArray(questions) || questions.length !== Object.keys(manifest.question_revisions).length || questions.some(question => !question || typeof question !== 'object' || manifest.question_revisions[Reflect.get(question, 'id')] !== Reflect.get(question, 'grading_revision'))) throw new Error('content_corrupt');
          const policies: unknown = Reflect.get(core, 'policy_versions');
          if (!policies || typeof policies !== 'object' || Object.entries(manifest.policy_versions).some(([key, value]) => Reflect.get(policies, key) !== value)) throw new Error('content_corrupt');
        }
      }
      return true;
    } catch { await this.incomplete(id); return false; }
  }
  async download(id: string, signal: AbortSignal, notify: (progress: DownloadProgress) => void, requestOffline = true) {
    const manifest = await this.manifest(id); const before = await this.entry(id);
    if (before.completeness === 'ready' && await this.verify(id)) return;
    await this.registry.change(state => { const entry = state.releases.find(item => item.release_id === id)!; entry.completeness = 'downloading'; entry.verified_at = null; if (requestOffline) state.offline_requested = true; });
    let count = 0; let bytes = 0; const totalBytes = manifest.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    try {
      for (const asset of manifest.assets) {
        signal.throwIfAborted(); const cache = await this.cacheFor(id, asset.url); const cached = await cache.match(asset.url);
        let response: Response | undefined;
        if (cached) try { response = await checkedResponse(cached, asset); } catch { /* Повреждённый объект заменяется только проверенным телом. */ }
        response ??= await checkedResponse(await this.request(asset.url, { signal, redirect: 'error', cache: 'no-store' }), asset);
        signal.throwIfAborted(); await cache.put(asset.url, response); signal.throwIfAborted();
        count++; bytes += asset.bytes; notify({ phase: 'downloading', count, total: manifest.assets.length, bytes, total_bytes: totalBytes });
      }
      signal.throwIfAborted(); await this.registry.change(state => { state.releases.find(item => item.release_id === id)!.completeness = 'verifying'; });
      notify({ phase: 'verifying', count, total: manifest.assets.length, bytes, total_bytes: totalBytes });
      if (!await this.verify(id)) throw new Error('content_corrupt');
      signal.throwIfAborted();
      await this.registry.change(state => { const entry = state.releases.find(item => item.release_id === id)!; entry.completeness = 'ready'; entry.verified_at = Date.now(); });
    } catch (error) {
      await this.cacheStorage.delete(before.course_cache).catch(() => {});
      await this.registry.change(state => { const entry = state.releases.find(item => item.release_id === id)!; entry.completeness = signal.aborted ? 'not_saved' : 'failed'; entry.verified_at = null; if (signal.aborted && requestOffline) state.offline_requested = false; }).catch(() => {});
      throw error;
    }
  }
}
