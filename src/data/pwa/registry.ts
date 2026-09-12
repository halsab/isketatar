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
  checked_at?: number;
}
export const emptyRegistry = (): Registry => ({ schema_version: 1, current_release_id: null, previous_release_id: null, candidate_release_id: null, offline_requested: false, releases: [], operation: null });
export interface RegistryStore { read(): Promise<Registry>; change(change: (value: Registry) => void): Promise<Registry> }
interface PwaDB extends DBSchema { registry: { key: string; value: Registry } }
function checked(value: Registry | undefined): Registry {
  if (value === undefined) return emptyRegistry();
  if (value?.checked_at !== undefined && (!Number.isSafeInteger(value.checked_at) || value.checked_at < 0)) throw new Error('pwa_storage_unavailable');
  if (!value || value.schema_version !== 1 || !Array.isArray(value.releases) || value.releases.length > 3 || typeof value.offline_requested !== 'boolean' || value.operation === undefined || !['current_release_id', 'previous_release_id', 'candidate_release_id'].every(key => Reflect.get(value, key) === null || typeof Reflect.get(value, key) === 'string' && RELEASE_ID.test(Reflect.get(value, key)))) throw new Error('pwa_storage_unavailable');
  for (const release of value.releases) if (!release || !RELEASE_ID.test(release.release_id) || release.shell_cache !== `isketatar-shell-${release.release_id}` || release.course_cache !== `isketatar-course-${release.release_id}` || release.manifest_url !== `/isketatar/releases/${release.release_id}/release-manifest.json` || !/^[a-f0-9]{64}$/u.test(release.manifest_sha256)) throw new Error('pwa_storage_unavailable');
  const ids = value.releases.map(entry => entry.release_id); const roles = [value.current_release_id, value.previous_release_id, value.candidate_release_id].filter((id): id is string => id !== null);
  if (new Set(ids).size !== ids.length || new Set(roles).size !== roles.length || roles.some(id => !ids.includes(id))) throw new Error('pwa_storage_unavailable');
  for (const entry of value.releases) if (!['not_saved', 'downloading', 'verifying', 'ready', 'incomplete', 'failed'].includes(entry.completeness) || !Number.isSafeInteger(entry.created_at) || entry.created_at < 0 || entry.verified_at !== null && (!Number.isSafeInteger(entry.verified_at) || entry.verified_at < 0) || entry.completeness === 'ready' && entry.verified_at === null) throw new Error('pwa_storage_unavailable');
  const operation = value.operation;
  if (operation !== null && (!operation || typeof operation !== 'object' || typeof operation.update_id !== 'string' || !operation.update_id || operation.update_id.length > 256 || !['prepared', 'committed'].includes(operation.phase) || !ids.includes(operation.from_release_id) || !ids.includes(operation.target_release_id) || operation.from_release_id === operation.target_release_id || (operation.phase === 'prepared' ? value.current_release_id !== operation.from_release_id || value.candidate_release_id !== operation.target_release_id : value.current_release_id !== operation.target_release_id || value.previous_release_id !== operation.from_release_id))) throw new Error('pwa_storage_unavailable');
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
