import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });
test('early and runtime callers share registration without a second update request', async () => {
  const registration = { active: null };
  const register = vi.fn().mockResolvedValue(registration);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  const { registerTransport } = await import('./transport');
  const early = registerTransport(); const runtime = registerTransport();
  expect(early).toBe(runtime); await expect(early).resolves.toBe(registration);
  expect(register).toHaveBeenCalledExactlyOnceWith('/isketatar/sw.js', { scope: '/isketatar/', updateViaCache: 'none' });
});
test('a failed early registration permits a later explicit retry', async () => {
  const register = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ active: null });
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  const { registerTransport } = await import('./transport');
  await expect(registerTransport()).rejects.toThrow('offline');
  await expect(registerTransport()).resolves.toEqual({ active: null }); expect(register).toHaveBeenCalledTimes(2);
});
test('synchronous registration denial becomes a rejected promise and does not stop boot imports', async () => {
  vi.stubGlobal('navigator', { get serviceWorker() { throw new DOMException('denied', 'SecurityError'); } });
  const { registerTransport } = await import('./transport');
  const promise = registerTransport();
  await expect(promise).rejects.toMatchObject({ name: 'SecurityError' });
  vi.stubGlobal('navigator', { serviceWorker: { register: () => ({ active: null }) } });
  await expect(registerTransport()).resolves.toEqual({ active: null });
});
test('a redundant installation permits a fresh registration on retry', async () => {
  const installing = { state: 'redundant', addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const next = { active: { state: 'activated' } };
  const register = vi.fn().mockResolvedValueOnce({ active: null, installing }).mockResolvedValue(next);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  const { activeTransport } = await import('./transport');
  await expect(activeTransport()).rejects.toThrow('pwa_unavailable');
  await expect(activeTransport()).resolves.toBe(next); expect(register).toHaveBeenCalledTimes(2);
});
