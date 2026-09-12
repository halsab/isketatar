import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/learning-fixture';
import { ContentRepository } from '../data/content/repository';
import { expectedFrom } from '../data/progress/repository';
import { replacementToken } from '../data/progress/transfer';
import { AppRuntime } from './runtime';

vi.mock('../ui/preferences', () => ({ applyPreferences: vi.fn() }));
vi.mock('./release', () => ({ currentReleaseId: async () => 'test-release' }));
vi.mock('./tab-identity', () => ({ tabIdentity: async () => '00000000-0000-4000-8000-000000000001' }));
const runtimes: AppRuntime[] = [];
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(ContentRepository, 'open').mockResolvedValue({ catalog } as ContentRepository);
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.progress?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function open() { const runtime = new AppRuntime(); runtimes.push(runtime); await runtime.start(); return runtime; }
const command = { type: 'settings' as const, patch: { theme: 'dark' as const } };

it('does not reauthorize a captured callback after reset', async () => {
  const runtime = await open();
  const repository = runtime.progress!; const snapshot = runtime.getState().snapshot!;
  const scope = { repository, expected: expectedFrom(snapshot) };
  await repository.reset(replacementToken(snapshot), true); await runtime.refresh();
  await expect(runtime.command(command, scope)).rejects.toThrow('write_conflict');
  expect(runtime.getState().snapshot!.settings.theme).toBe('system');
});

it('does not redirect a durable callback into the memory branch', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  const scope = { repository, expected: expectedFrom(runtime.getState().snapshot!) };
  await runtime.useMemory();
  await expect(runtime.command(command, scope)).rejects.toThrow('write_conflict');
  expect(runtime.getState().snapshot!.settings.theme).toBe('system');
  repository.close();
});

it('reopens a closed connection with previous data and rejects callbacks bound to that connection', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  await runtime.command(command, { repository, expected: expectedFrom(runtime.getState().snapshot!) });
  const scope = { repository, expected: expectedFrom(runtime.getState().snapshot!) };
  repository.close();
  await expect(runtime.refresh()).rejects.toThrow('storage_unavailable');
  await runtime.retry();
  expect(runtime.getState()).toMatchObject({ phase: 'ready', error: null, snapshot: { settings: { theme: 'dark' } } });
  expect(runtime.progress).not.toBe(repository);
  await expect(runtime.command({ type: 'settings', patch: { theme: 'light' } }, scope)).rejects.toThrow('write_conflict');
});
