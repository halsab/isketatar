import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { RELEASE_ID } from './manifest';
export type Completeness = 'not_saved' | 'downloading' | 'verifying' | 'ready' | 'incomplete' | 'failed';
export interface StoredRelease {
  release_id: string; manifest_url: string; manifest_sha256: string; shell_cache: string; course_cache: string;
  completeness: Completeness; verified_at: number | null; created_at: number;
}
export interface PwaOperation { update_id: string; from_release_id: string; target_release_id: string; phase: 'prepared' | 'committed' }
export interface Registry {
  schema_version: 1; current_release_id: string | null; previous_release_id: string | null; candidate_release_id: string | null;
  offline_requested: boolean; releases: StoredRelease[]; operation: PwaOperation | null;
}
export const emptyRegistry = (): Registry => ({ schema_version: 1, current_release_id: null, previous_release_id: null, candidate_release_id: null, offline_requested: false, releases: [], operation: null });
export interface RegistryStore { read(): Promise<Registry>; change(change: (value: Registry) => void): Promise<Registry> }
interface PwaDB extends DBSchema { registry: { key: string; value: Registry } }
function checked(value: Registry | undefined): Registry {
  if (!value) return emptyRegistry();
  if (value.schema_version !== 1 || !Array.isArray(value.releases) || value.releases.length > 3 || typeof value.offline_requested !== 'boolean' || !['current_release_id', 'previous_release_id', 'candidate_release_id'].every(key => Reflect.get(value, key) === null || typeof Reflect.get(value, key) === 'string' && RELEASE_ID.test(Reflect.get(value, key)))) throw new Error('pwa_storage_unavailable');
  for (const release of value.releases) if (!RELEASE_ID.test(release.release_id) || release.shell_cache !== `isketatar-shell-${release.release_id}` || release.course_cache !== `isketatar-course-${release.release_id}` || release.manifest_url !== `/isketatar/releases/${release.release_id}/release-manifest.json` || !/^[a-f0-9]{64}$/u.test(release.manifest_sha256)) throw new Error('pwa_storage_unavailable');
  return value;
}
export class IndexedRegistry implements RegistryStore {
  private connection: Promise<IDBPDatabase<PwaDB>> | null = null;
  private db() {
    return this.connection ??= openDB<PwaDB>('isketatar-pwa', 1, { upgrade(db) { db.createObjectStore('registry'); }, blocking: () => { void this.connection?.then(db => db.close()); this.connection = null; }, terminated: () => { this.connection = null; } }).catch(error => { this.connection = null; throw error; });
  }
  async read() { return checked(await (await this.db()).get('registry', 'state')); }
  async change(change: (value: Registry) => void) {
    const tx = (await this.db()).transaction('registry', 'readwrite');
    try { const value = checked(await tx.store.get('state')); change(value); checked(value); await tx.store.put(value, 'state'); await tx.done; return value; }
    catch (error) { try { tx.abort(); } catch { /* Транзакция могла уже завершиться с отказом. */ } await tx.done.catch(() => {}); throw error; }
  }
}
