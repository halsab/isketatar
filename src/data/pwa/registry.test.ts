import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, expect, it, vi } from 'vitest';
import { IndexedRegistry } from './registry';
afterEach(() => vi.unstubAllGlobals());
it('rejects corrupt persisted operation markers and aborts an invalid role mutation atomically', async () => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  const registry = new IndexedRegistry(); const original = await registry.read();
  const raw = await openDB('isketatar-pwa', 1);
  for (const operation of [false, 0, '', { phase: 'committed' }]) {
    await raw.put('registry', { ...original, operation }, 'state');
    await expect(registry.read()).rejects.toThrow('pwa_storage_unavailable');
  }
  await raw.put('registry', original, 'state');
  await expect(registry.change(value => { value.current_release_id = '1.0.0-1111111111111111'; })).rejects.toThrow('pwa_storage_unavailable');
  expect(await registry.read()).toEqual(original); raw.close();
});
