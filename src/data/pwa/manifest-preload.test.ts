import { expect, test, vi } from 'vitest';
import { ManifestPreload } from './manifest-preload';

const first = '1.0.0-123456789abcdef0'; const second = '1.0.0-123456789abcdef1';
test('shares one verified request with initialization and bounds speculative storage to one manifest', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof import('./manifest').fetchManifest>>) => void;
  const pending = new Promise<Awaited<ReturnType<typeof import('./manifest').fetchManifest>>>(done => { resolve = done; });
  const fetch = vi.fn(() => pending);
  const preload = new ManifestPreload(fetch);
  const warm = preload.warm(first); const same = preload.warm(first); await preload.warm(second);
  const taken = preload.take(first);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(`/isketatar/releases/${first}/release-manifest.json`);
  expect(preload.take(second)).toBeNull(); expect(preload.take(first)).toBeNull();
  const result = { manifest: { release_id: first }, digest: 'hash', response: new Response('{}') } as Awaited<ReturnType<typeof import('./manifest').fetchManifest>>;
  resolve(result); await warm; expect(await same).toBe(result); expect(await taken).toBe(result);
});
test('invalid ids do not fetch and a rejected warm-up leaves an ordinary retry available', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  const preload = new ManifestPreload(fetch);
  await preload.warm('../../release-manifest.json'); expect(fetch).not.toHaveBeenCalled();
  await expect(preload.warm(first)).rejects.toThrow('offline');
  expect(preload.take(first)).toBeNull();
  await expect(preload.warm(first)).rejects.toThrow('offline'); expect(fetch).toHaveBeenCalledTimes(2);
});
