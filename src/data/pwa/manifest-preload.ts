import { fetchManifest, releaseRoot } from './manifest';

export class ManifestPreload {
  private pending: { id: string; promise: ReturnType<typeof fetchManifest> } | null = null;
  constructor(private readonly request = fetchManifest) {}
  warm(id: unknown): Promise<Awaited<ReturnType<typeof fetchManifest>> | undefined> {
    if (typeof id !== 'string' || !/^\d+\.\d+\.\d+-[a-f0-9]{16}$/u.test(id) || id.length > 128) return Promise.resolve(undefined);
    if (this.pending) return this.pending.id === id ? this.pending.promise : Promise.resolve(undefined);
    const entry = { id, promise: this.request(releaseRoot(id) + 'release-manifest.json') };
    this.pending = entry;
    return entry.promise.catch(error => { if (this.pending === entry) this.pending = null; throw error; });
  }
  take(id: string) {
    if (this.pending?.id !== id) return null;
    const promise = this.pending.promise; this.pending = null; return promise;
  }
}
