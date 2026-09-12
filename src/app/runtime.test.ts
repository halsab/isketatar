import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/learning-fixture';
import { ContentCatalog } from '../domain/content/catalog';
import { ContentRepository } from '../data/content/repository';
import { expectedFrom } from '../data/progress/repository';
import { replacementToken } from '../data/progress/transfer';
import { AppRuntime } from './runtime';
import { SessionEditor } from '../features/practice/editor';

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

it('loads a paused lesson question before disclosing final feedback on a cold catalog', async () => {
  const partial = new ContentCatalog(catalog.core);
  partial.addQuestions({ questions: [...catalog.questions.values()] } as Parameters<ContentCatalog['addQuestions']>[0]);
  const questions = vi.fn(async (ids: string[]) => { const loaded = ids.map(id => catalog.question(id)); partial.addQuestions({ questions: loaded } as Parameters<ContentCatalog['addQuestions']>[0]); return loaded; });
  vi.mocked(ContentRepository.open).mockResolvedValue({ catalog: partial, questions } as unknown as ContentRepository);
  const runtime = await open(); const repository = runtime.progress!;
  const run = async (value: Parameters<AppRuntime['command']>[0]) => runtime.command(value, { repository, expected: expectedFrom(await repository.snapshot()) });
  const final = await run({ type: 'start', kind: 'final' });
  await run({ type: 'finish_assessment', session_id: final.session_id!, confirm_incomplete: true, defer_imla: false });
  const lesson = await run({ type: 'start', kind: 'lesson_cycle', lesson_id: 'L09' });
  await run({ type: 'show', presentation_id: lesson.presentation_id! });
  await run({ type: 'pause', session_id: lesson.session_id! });
  for (const question of partial.questions.values()) if (question.origin === 'course') partial.questions.delete(question.id);
  const feedbackId = (await repository.snapshot()).attempts.find(item => item.question_id === 'F-15')!.presentation_id;
  await run({ type: 'help', kind: 'reveal', presentation_id: feedbackId });
  expect(questions).toHaveBeenCalledWith(['Q-L09-01']);
  expect((await repository.snapshot()).presentations.find(item => item.presentation_id === feedbackId)?.feedback_opened_at).not.toBeNull();
});

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

it('keeps unsaved raw input available when unreadable durable storage requires an empty memory branch', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  await runtime.command({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, { repository, expected: expectedFrom(runtime.getState().snapshot!) });
  const id = runtime.getState().snapshot!.sessions[0]!.active_presentation_id!;
  await runtime.command({ type: 'show', presentation_id: id }, { repository, expected: expectedFrom(runtime.getState().snapshot!) });
  const editor = new SessionEditor(repository, runtime.getState().snapshot!, id, () => runtime.refresh()); runtime.registerEditor(editor);
  editor.input({ kind: 'text', text: 'әңгәмә' });
  vi.spyOn(repository.backend, 'run').mockRejectedValue(new Error('storage_unavailable'));
  const switching = runtime.useMemory();
  editor.input({ kind: 'text', text: 'late callback' });
  await switching;
  expect(runtime.getState()).toMatchObject({ phase: 'ready', mode: 'memory', recoveryText: 'әңгәмә', snapshot: { sessions: [] } });
  expect(repository.acceptsCommands).toBe(false);
  await editor.dispose(); repository.close();
});
