import { afterEach, beforeEach, expect, test, vi } from 'vitest';

let channel: { port1: { onmessage: ((event: { data: unknown }) => void) | null; close: ReturnType<typeof vi.fn> }; port2: object };
const url = '/isketatar/releases/1.0.0-123456789abcdef0/release-manifest.json';
const id = '1.0.0-123456789abcdef0';
const worker = { postMessage: vi.fn() } as unknown as ServiceWorker;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('MessageChannel', class {
    port1 = { onmessage: null, close: vi.fn() }; port2 = {};
    constructor() { channel = this; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.resetModules(); vi.clearAllMocks(); });
test('an old worker without immediate acknowledgement never delays normal bootstrap', async () => {
  const { preloadManifest, takePreloadedManifest } = await import('./manifest-preload-client');
  preloadManifest(worker, id, url);
  expect(takePreloadedManifest(url)).toBeNull(); expect(channel.port1.close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
test('shares an acknowledged result once and closes the port after delivery', async () => {
  const { preloadManifest, takePreloadedManifest } = await import('./manifest-preload-client');
  preloadManifest(worker, id, url); channel.port1.onmessage!({ data: { started: true } });
  const result = takePreloadedManifest(url);
  expect(result).not.toBeNull(); expect(takePreloadedManifest(url)).toBeNull();
  const manifest = { release_id: id };
  channel.port1.onmessage!({ data: { manifest } });
  await expect(result).resolves.toBe(manifest); expect(vi.getTimerCount()).toBe(0);
  expect(channel.port1.close).toHaveBeenCalledOnce();
});
test('a mismatched URL cannot consume the speculative response', async () => {
  const { preloadManifest, takePreloadedManifest } = await import('./manifest-preload-client');
  preloadManifest(worker, id, url); channel.port1.onmessage!({ data: { started: true } });
  expect(takePreloadedManifest('/isketatar/release-manifest.json')).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
test.each(['failure', 'timeout'])('%s rejects the advisory result so the caller can retry the normal request', async kind => {
  const { preloadManifest, takePreloadedManifest } = await import('./manifest-preload-client');
  preloadManifest(worker, id, url); channel.port1.onmessage!({ data: { started: true } });
  const result = takePreloadedManifest(url);
  const rejected = expect(result).rejects.toThrow('content_unavailable');
  if (kind === 'failure') channel.port1.onmessage!({ data: { error: 'content_unavailable' } });
  else await vi.advanceTimersByTimeAsync(45_000);
  await rejected;
  expect(channel.port1.close).toHaveBeenCalledOnce();
});
