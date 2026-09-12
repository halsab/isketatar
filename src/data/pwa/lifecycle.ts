import type { Session } from '../../domain/learning/types';
import { fetchManifest, PWA_BASE, RELEASE_ID, type PackageManifest } from './manifest';
import type { PackageStore } from './packages';
import type { Registry } from './registry';

export type ReleasePin = Pick<Session, 'session_id' | 'release_id' | 'content_schema' | 'policy_versions'>;
const day = 86_400_000;
function readerSupports(reader: PackageManifest, source: Pick<PackageManifest, 'content_schema' | 'policy_versions' | 'min_reader_version'>) {
  const minimum = source.min_reader_version.split('.').map(Number); const version = reader.app_version.split('.').map(Number);
  const difference = minimum.findIndex((part, index) => part !== version[index]);
  const versionCompatible = difference === -1 || version[difference]! > minimum[difference]!;
  return reader.progress_schema === 1 && reader.content_schema === source.content_schema && versionCompatible && Object.entries(source.policy_versions).every(([key, value]) => Reflect.get(reader.policy_versions, key) === value);
}
function pinsAllow(value: Registry, pins: readonly ReleasePin[]) {
  if (pins.some(pin => pin.release_id !== value.current_release_id)) throw new Error('release_pinned');
}

// Изменения ролей, загрузки и очистка вызываются одной последовательной очередью transport worker.
export class ReleaseLifecycle {
  constructor(readonly packages: PackageStore, private readonly request: typeof fetch = (input, init) => fetch(input, init)) {}
  private get registry() { return this.packages.registry; }
  async check(occupiedReleaseIds: readonly string[]): Promise<PackageManifest | null> {
    const fetched = await fetchManifest(PWA_BASE + 'release-manifest.json', undefined, undefined, this.request);
    const value = await this.registry.read();
    if (value.operation) throw new Error('update_in_progress');
    if (!value.current_release_id) throw new Error('content_unavailable');
    const known = value.releases.find(entry => entry.release_id === fetched.manifest.release_id);
    if (known && known.manifest_sha256 !== fetched.digest) throw new Error('content_corrupt');
    if ([value.current_release_id, value.previous_release_id].includes(fetched.manifest.release_id)) return null;
    if (value.candidate_release_id && value.candidate_release_id !== fetched.manifest.release_id) await this.remove(value.candidate_release_id, occupiedReleaseIds);
    await this.packages.register(fetched.manifest, fetched.digest, fetched.response);
    return fetched.manifest;
  }
  async prepare(updateId: string, from: string, target: string, pins: readonly ReleasePin[]) {
    if (!updateId || updateId.length > 256) throw new Error('update_conflict');
    const value = await this.registry.read();
    if (value.operation && (value.operation.update_id !== updateId || value.operation.from_release_id !== from || value.operation.target_release_id !== target)) throw new Error('update_conflict');
    if (value.operation?.phase === 'committed') return;
    if (value.current_release_id !== from || value.candidate_release_id !== target) throw new Error('update_conflict');
    pinsAllow(value, pins);
    const reader = await this.packages.manifest(target);
    if (reader.content_schema !== 1 || reader.progress_schema !== 1 || !readerSupports(reader, reader)) throw new Error('unsupported_release');
    for (const pin of pins) if (!readerSupports(reader, { ...pin, min_reader_version: '0.0.0' })) throw new Error('unsupported_release');
    for (const id of new Set([target, ...pins.map(pin => pin.release_id)])) {
      const manifest = await this.packages.manifest(id);
      if (!readerSupports(reader, manifest)) throw new Error('unsupported_release');
      if (value.releases.find(entry => entry.release_id === id)?.completeness !== 'ready' || !await this.packages.verify(id)) throw new Error('retained_incomplete');
    }
    return this.registry.change(current => {
      if (current.current_release_id !== from || current.candidate_release_id !== target || current.operation && current.operation.update_id !== updateId) throw new Error('update_conflict');
      pinsAllow(current, pins);
      current.operation = { update_id: updateId, from_release_id: from, target_release_id: target, phase: 'prepared' };
    });
  }
  async commit(updateId: string, pins: readonly ReleasePin[]) {
    const before = await this.registry.read(); const pending = before.operation;
    if (!pending || pending.update_id !== updateId) throw new Error('update_conflict');
    if (pending.phase === 'prepared') await this.prepare(updateId, pending.from_release_id, pending.target_release_id, pins);
    return this.registry.change(value => {
      const operation = value.operation;
      if (!operation || operation.update_id !== updateId) throw new Error('update_conflict');
      if (operation.phase === 'committed') {
        if (value.current_release_id !== operation.target_release_id || value.previous_release_id !== operation.from_release_id) throw new Error('update_conflict');
        return;
      }
      if (value.current_release_id !== operation.from_release_id || value.candidate_release_id !== operation.target_release_id) throw new Error('update_conflict');
      pinsAllow(value, pins);
      if (value.releases.find(entry => entry.release_id === operation.target_release_id)?.completeness !== 'ready' || pins.some(pin => value.releases.find(entry => entry.release_id === pin.release_id)?.completeness !== 'ready')) throw new Error('retained_incomplete');
      value.previous_release_id = operation.from_release_id; value.current_release_id = operation.target_release_id; value.candidate_release_id = null; operation.phase = 'committed';
    });
  }
  async cancel(updateId: string) {
    return this.registry.change(value => {
      if (!value.operation || value.operation.update_id !== updateId) throw new Error('update_conflict');
      if (value.operation.phase === 'committed') throw new Error('update_committed');
      value.operation = null;
    });
  }
  async finish(updateId: string, pins: readonly ReleasePin[]) {
    const value = await this.registry.read(); const operation = value.operation;
    if (!operation || operation.update_id !== updateId || operation.phase !== 'committed' || value.current_release_id !== operation.target_release_id || value.previous_release_id !== operation.from_release_id) throw new Error('update_conflict');
    for (const entry of value.releases) if (![value.current_release_id, value.previous_release_id].includes(entry.release_id)) await this.remove(entry.release_id, pins.map(pin => pin.release_id), updateId);
    return this.registry.change(current => {
      if (current.operation?.update_id !== updateId || current.operation.phase !== 'committed') throw new Error('update_conflict');
      current.operation = null;
    });
  }
  async cleanup(now: number, occupiedReleaseIds: readonly string[]) {
    const value = await this.registry.read(); if (value.operation) return;
    for (const entry of value.releases) {
      if ([value.current_release_id, value.previous_release_id].includes(entry.release_id) || occupiedReleaseIds.includes(entry.release_id)) continue;
      const expires = entry.completeness === 'ready' ? (entry.verified_at ?? entry.created_at) + 7 * day : entry.created_at + day;
      if (entry.release_id !== value.candidate_release_id || now > expires) await this.remove(entry.release_id, occupiedReleaseIds);
    }
    const registered = new Set((await this.registry.read()).releases.map(entry => entry.release_id));
    for (const name of await this.packages.cacheStorage.keys()) {
      const id = /^isketatar-(?:shell|course)-(.+)$/u.exec(name)?.[1];
      if (id && RELEASE_ID.test(id) && !registered.has(id) && !occupiedReleaseIds.includes(id)) { await this.packages.cacheStorage.delete(name); this.packages.forget(id); }
    }
  }
  private async remove(id: string, occupiedReleaseIds: readonly string[], updateId?: string) {
    const value = await this.registry.read();
    const allowed = (state: Registry) => {
      if ([state.current_release_id, state.previous_release_id].includes(id) || occupiedReleaseIds.includes(id)) throw new Error('release_pinned');
      if (state.operation && (state.operation.update_id !== updateId || state.operation.phase !== 'committed')) throw new Error('update_in_progress');
    };
    allowed(value); const entry = value.releases.find(entry => entry.release_id === id); if (!entry) return;
    await this.packages.cacheStorage.delete(entry.course_cache); await this.packages.cacheStorage.delete(entry.shell_cache);
    await this.registry.change(current => { allowed(current); current.releases = current.releases.filter(entry => entry.release_id !== id); if (current.candidate_release_id === id) current.candidate_release_id = null; });
    this.packages.forget(id);
  }
}
