import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { catalog } from '../../tests/learning-fixture';
import { ContentCatalog } from '../domain/content/catalog';
import { ContentRepository } from '../data/content/repository';
import { ProgressRepository, expectedFrom } from '../data/progress/repository';
import { replacementToken } from '../data/progress/transfer';
import { AppRuntime } from './runtime';
import { SessionEditor } from '../features/practice/editor';

vi.mock('../ui/preferences', () => ({ applyPreferences: vi.fn() }));
vi.mock('./release', () => ({ currentReleaseId: async () => 'test-release' }));
const identity = vi.hoisted(() => ({ id: '00000000-0000-4000-8000-000000000001' }));
vi.mock('./tab-identity', () => ({ tabIdentity: async () => identity.id }));
vi.mock('../data/pwa/client', () => ({ offline: { start: async () => {}, getState: () => ({ registry: { previous_release_id: 'R1' } }) } }));
const runtimes: AppRuntime[] = [];
beforeEach(() => {
  identity.id = '00000000-0000-4000-8000-000000000001';
  vi.stubGlobal('indexedDB', new IDBFactory());
  vi.spyOn(ContentRepository, 'open').mockResolvedValue({ catalog } as ContentRepository);
});
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.progress?.close(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function open() { const runtime = new AppRuntime(); runtimes.push(runtime); await runtime.start(); return runtime; }
const command = { type: 'settings' as const, patch: { theme: 'dark' as const } };

it('cancels a composing preparation without replacing the live editor or losing its unflushed input', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  const created = await runtime.command({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, { repository, expected: expectedFrom(await repository.snapshot()) });
  await runtime.command({ type: 'show', presentation_id: created.presentation_id! }, { repository, expected: expectedFrom(await repository.snapshot()) });
  const editor = new SessionEditor(repository, await repository.snapshot(), created.presentation_id!, () => runtime.refresh()); runtime.registerEditor(editor);
  editor.composition(true); editor.input({ kind: 'text', text: 'яңа' });
  const request = await runtime.beginReleaseUpdate('next-release', replacementToken(await repository.snapshot()));
  await expect(runtime.prepareUpdate(request)).rejects.toThrow('composition_in_progress');
  await expect(runtime.recoverReleaseUpdate(request.update_id, true)).rejects.toThrow('composition_in_progress');
  expect((await repository.snapshot()).control.writer_epoch).toBe(request.writer_epoch);
  const revision = runtime.getState().editorRevision;
  await runtime.cancelReleaseUpdate(request);
  expect(runtime.getState().editorRevision).toBe(revision); expect(runtime.getState().quiescing).toBeNull();
  editor.input({ kind: 'text', text: 'яңа сүз' }); editor.composition(false); await editor.flush();
  expect((await repository.snapshot()).presentations.find(item => item.presentation_id === created.presentation_id)?.draft_answer).toEqual({ kind: 'text', text: 'яңа сүз' });
});
it('recovers a closed participant explicitly and fences callbacks from the previous connection', async () => {
  const writer = await open(); identity.id = crypto.randomUUID(); const viewer = await open();
  const request = await writer.beginReleaseUpdate('next-release', replacementToken(writer.getState().snapshot!));
  await viewer.prepareUpdate(request); const old = viewer.progress!;
  await expect(viewer.recoverReleaseUpdate(request.update_id, false)).rejects.toThrow('confirmation_required');
  const recovered = await viewer.recoverReleaseUpdate(request.update_id, true);
  expect(recovered.writer_epoch).toBe(request.writer_epoch + 1); expect(viewer.progress).not.toBe(old);
  await expect(viewer.command(command, { repository: old, expected: expectedFrom(viewer.getState().snapshot!) })).rejects.toThrow('update_in_progress');
  await viewer.prepareUpdate(recovered); await viewer.commitReleaseUpdate(recovered); expect(viewer.progress?.available).toBe(false);
  const committed = await writer.recoverReleaseUpdate(recovered.update_id, true);
  expect(committed.phase).toBe('commit');
  writer.registerPosition({ repository: writer.progress!, expected: expectedFrom(await writer.progress!.snapshot()) }, () => ({ type: 'position', position: { kind: 'lesson', target_id: 'V04', anchor_id: 'V04:theory', within_block_ratio: 0.5, content_revision: catalog.lessons.get('V04')!.content_revision } }));
  expect(await writer.prepareUpdate(committed)).toMatchObject({ closed: true });
});
it('joins a new gate when a closed participant missed the cancellation of the previous one', async () => {
  const writer = await open(); identity.id = crypto.randomUUID(); const viewer = await open();
  const first = await writer.beginReleaseUpdate('R2', replacementToken(writer.getState().snapshot!));
  await viewer.prepareUpdate(first);
  await writer.cancelReleaseUpdate(first);
  const second = await writer.beginReleaseUpdate('R3', replacementToken(writer.getState().snapshot!));
  expect(await viewer.prepareUpdate(second)).toMatchObject({ closed: true });
  expect(viewer.getState().quiescing).toBe(second.update_id);
  await viewer.cancelPreparation(first.update_id);
  expect(viewer.getState().quiescing).toBe(second.update_id);
});

it('loads a paused lesson question before disclosing final feedback on a cold catalog', async () => {
  const partial = new ContentCatalog(catalog.core);
  partial.addQuestions({ questions: [...catalog.questions.values()] } as Parameters<ContentCatalog['addQuestions']>[0]);
  const questions = vi.fn(async (ids: string[]) => { const loaded = ids.map(id => catalog.question(id)); partial.addQuestions({ questions: loaded } as Parameters<ContentCatalog['addQuestions']>[0]); return loaded; });
  vi.mocked(ContentRepository.open).mockResolvedValue({ catalog: partial, questions, load: async (resource: string) => { if (resource === 'readings.json') partial.addReadings({ readings: [...catalog.readings.values()], questions: [] }); } } as unknown as ContentRepository);
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
it('loads only the current import catalog when no previous session is referenced', async () => {
  const load = vi.fn(async () => {});
  vi.mocked(ContentRepository.open).mockResolvedValue({ catalog, load } as unknown as ContentRepository);
  const runtime = await open(); const retained = vi.spyOn(runtime, 'contentForRelease').mockRejectedValue(new Error('content_unavailable'));
  vi.stubEnv('PROD', true);
  await runtime.progress!.previewImport(await runtime.progress!.exportProgress(), ids => runtime.loadAllContent(ids));
  expect(load).toHaveBeenCalledWith('assessments.json'); expect(retained).not.toHaveBeenCalled();
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
it('quiesces the writer after a gate, persists raw input, and closes only after commit', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  const created = await runtime.command({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, { repository, expected: expectedFrom(await repository.snapshot()) });
  await repository.dispatch({ type: 'show', presentation_id: created.presentation_id! }, expectedFrom(await repository.snapshot()));
  runtime.registerPosition({ repository, expected: expectedFrom(await repository.snapshot()) }, () => ({ type: 'position', position: { kind: 'lesson', target_id: 'V04', anchor_id: 'V04:theory', within_block_ratio: 0.5, content_revision: catalog.lessons.get('V04')!.content_revision } }));
  const editor = new SessionEditor(repository, await repository.snapshot(), created.presentation_id!, () => runtime.refresh()); runtime.registerEditor(editor);
  editor.input({ kind: 'text', text: 'әңгәмә' });
  const gate = await repository.beginUpdate(replacementToken(await repository.snapshot()), 'R2'); const snapshot = await repository.snapshot();
  const request = { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
  const ready = await runtime.prepareUpdate(request);
  expect(ready.closed).toBe(false); expect(repository.available).toBe(true); expect(editor.dirty).toBe(false);
  expect((await repository.snapshot()).sessions[0]!.status).toBe('paused');
  expect((await repository.snapshot()).presentations.find(item => item.presentation_id === created.presentation_id)!.draft_answer).toEqual({ kind: 'text', text: 'әңгәмә' });
  expect((await repository.snapshot()).resume_positions[0]!.anchor_id).toBe('V04:theory');
  await expect(runtime.command(command, { repository, expected: expectedFrom(await repository.snapshot()) })).rejects.toThrow('update_in_progress');
  await expect(runtime.closeForUpdate(gate.update_id)).rejects.toThrow('update_not_committed');
  await repository.commitUpdate(replacementToken(await repository.snapshot()), gate.update_id); await runtime.closeForUpdate(gate.update_id);
  expect(repository.available).toBe(false); await editor.dispose();
});
it('requires an explicit memory decision and never treats a different gate as the same preparation', async () => {
  const runtime = await open(); const source = runtime.progress!; await runtime.useMemory();
  await runtime.command(command, { repository: runtime.progress!, expected: expectedFrom(await runtime.progress!.snapshot()) });
  const owner = await ProgressRepository.open({ ...source.options, tabId: crypto.randomUUID() });
  const before = await owner.snapshot(); await owner.takeover(before.control.data_generation, before.control.writer_epoch);
  const gate = await owner.beginUpdate(replacementToken(await owner.snapshot()), 'R2'); const snapshot = await owner.snapshot();
  const request = { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
  await expect(runtime.prepareUpdate(request)).rejects.toThrow('update_memory_mode'); expect(runtime.progress!.available).toBe(true);
  expect(await runtime.prepareUpdate(request, true)).toMatchObject({ closed: true, mode: 'memory', memory_loss_accepted: true });
  await expect(runtime.prepareUpdate({ ...request, update_id: crypto.randomUUID() }, true)).rejects.toThrow('stale_update');
  expect(await runtime.prepareUpdate(request)).toMatchObject({ memory_loss_accepted: true });
  expect(runtime.getState().snapshot!.settings.theme).toBe('dark');
  await owner.cancelUpdate(replacementToken(await owner.snapshot()), gate.update_id); await runtime.cancelPreparation(gate.update_id);
  expect(runtime.getState().quiescing).toBeNull(); expect(runtime.progress!.available).toBe(true); expect(runtime.getState().mode).toBe('memory');
  expect(runtime.getState().snapshot!.settings.theme).toBe('dark');
  const next = await owner.beginUpdate(replacementToken(await owner.snapshot()), 'R3'); const current = await owner.snapshot();
  const again = { ...next, data_generation: current.control.data_generation, writer_epoch: current.control.writer_epoch };
  await expect(runtime.prepareUpdate(again)).rejects.toThrow('update_memory_mode');
  expect(await runtime.prepareUpdate(again, true)).toMatchObject({ closed: true, memory_loss_accepted: true }); owner.close(); source.close();
});
it('closes a read-only viewer without pausing the owner and replaces its connection only after cancellation', async () => {
  const owner = await open(); const writer = owner.progress!;
  await writer.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await writer.snapshot()));
  identity.id = crypto.randomUUID(); const viewer = await open(); const previous = viewer.progress!;
  const scope = { repository: previous, expected: expectedFrom(await previous.snapshot()) };
  const gate = await writer.beginUpdate(replacementToken(await writer.snapshot()), 'R2'); const snapshot = await writer.snapshot();
  const request = { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
  expect(await viewer.prepareUpdate(request)).toMatchObject({ closed: true, mode: 'durable' });
  expect(previous.available).toBe(false); expect((await writer.snapshot()).sessions[0]!.status).toBe('active');
  const recovery = await ProgressRepository.open({ ...writer.options, tabId: crypto.randomUUID() });
  await recovery.recoverUpdate(replacementToken(await recovery.snapshot()), gate.update_id, true);
  const recovered = await recovery.snapshot();
  await expect(viewer.prepareUpdate(request)).rejects.toThrow('stale_update');
  expect(await viewer.prepareUpdate({ ...recovered.control.update_gate!, data_generation: recovered.control.data_generation, writer_epoch: recovered.control.writer_epoch })).toMatchObject({ closed: true });
  await expect(viewer.cancelPreparation(gate.update_id)).rejects.toThrow('update_in_progress');
  await recovery.cancelUpdate(replacementToken(await recovery.snapshot()), gate.update_id); await viewer.cancelPreparation(gate.update_id);
  expect(viewer.progress).not.toBe(previous); expect(viewer.getState().quiescing).toBeNull();
  await expect(viewer.command(command, scope)).rejects.toThrow('write_conflict');
  expect((await writer.snapshot()).control.writer_id).toBe(recovery.tabId); recovery.close();
});
it('waits for an already admitted disclosure and joins overlapping prepare requests into one operation', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  let admit!: () => void; let entered!: () => void;
  const hold = new Promise<void>(resolve => { admit = resolve; }); const dispatched = new Promise<void>(resolve => { entered = resolve; });
  const original = repository.dispatch.bind(repository);
  vi.spyOn(repository, 'dispatch').mockImplementation(async (...args) => { if (args[0].type === 'observe') { entered(); await hold; } return original(...args); });
  const disclosure = runtime.command({ type: 'observe', target: { kind: 'reference', id: 'rules' }, confirm_assessment_help: false }, { repository, expected: expectedFrom(await repository.snapshot()) });
  await dispatched;
  const gate = await repository.beginUpdate(replacementToken(await repository.snapshot()), 'R2'); const snapshot = await repository.snapshot();
  const request = { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
  const preparing = runtime.prepareUpdate(request); expect(runtime.prepareUpdate(request)).toBe(preparing);
  await expect(runtime.command({ type: 'observe', target: { kind: 'reference', id: 'rules' }, confirm_assessment_help: false }, { repository, expected: expectedFrom(snapshot) })).rejects.toThrow('update_in_progress');
  let ready = false; void preparing.then(() => { ready = true; }); await Promise.resolve(); expect(ready).toBe(false);
  admit(); await disclosure; await preparing; expect(ready).toBe(true);
  await repository.cancelUpdate(replacementToken(await repository.snapshot()), gate.update_id); await runtime.cancelPreparation(gate.update_id);
});
it('pauses a clean assessment editor after admitted help advances the session revision', async () => {
  const runtime = await open(); const repository = runtime.progress!;
  const created = await repository.dispatch({ type: 'start', kind: 'diagnostic' }, expectedFrom(await repository.snapshot()));
  const editor = new SessionEditor(repository, await repository.snapshot(), created.presentation_id!, () => runtime.refresh()); runtime.registerEditor(editor);
  const scope = { repository, expected: expectedFrom(await repository.snapshot()) };
  const gate = await repository.beginUpdate(replacementToken(await repository.snapshot()), 'R2');
  await repository.dispatch({ type: 'observe', target: { kind: 'reference', id: 'rules' }, confirm_assessment_help: true }, scope.expected);
  const snapshot = await repository.snapshot();
  await runtime.prepareUpdate({ ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch });
  expect((await repository.snapshot()).sessions[0]).toMatchObject({ status: 'paused', assessment_help_opened_at: expect.any(Number) });
  await editor.dispose();
});
