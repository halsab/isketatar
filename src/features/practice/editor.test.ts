import { expect, it } from 'vitest';
import { catalog } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from '../../data/progress/repository';
import { SessionEditor } from './editor';

it('flushes raw draft before pause', async () => {
  const repository = await ProgressRepository.memory({ catalog, releaseId: 'test-release' });
  let snapshot = await repository.snapshot();
  await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(snapshot));
  snapshot = await repository.snapshot();
  const session = snapshot.sessions[0]!; const id = session.active_presentation_id!;
  await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(snapshot));
  snapshot = await repository.snapshot();
  const editor = new SessionEditor(repository, snapshot, id, async () => {});
  editor.input({ kind: 'text', text: 'әңгәмә' });
  await editor.leave();
  const paused = await repository.snapshot();
  expect(paused.sessions[0]!.status).toBe('paused');
  expect(paused.presentations.find(item => item.presentation_id === id)!.draft_answer).toEqual({ kind: 'text', text: 'әңгәмә' });
  await editor.dispose(); repository.close();
});

it('roundtrips all chapter anchors in the same content release', async () => {
  const repository = await ProgressRepository.memory({ catalog, releaseId: 'test-release' });
  for (const section of ['goals', 'theory', 'pitfalls', 'outcomes']) {
    await repository.dispatch({ type: 'position', position: { kind: 'lesson', target_id: 'V04', anchor_id: `V04:${section}`, within_block_ratio: 0.5, content_revision: catalog.lessons.get('V04')!.content_revision } }, expectedFrom(await repository.snapshot()));
    const preview = await repository.previewImport(await repository.exportProgress());
    await repository.commitImport(preview.id, true);
    expect((await repository.snapshot()).resume_positions[0]!.anchor_id).toBe(`V04:${section}`);
  }
  repository.close();
});
it('quiesces only after IME completion, saves the last input, and rejects new editor commands', async () => {
  const repository = await ProgressRepository.memory({ catalog, releaseId: 'test-release' });
  const created = await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
  await repository.dispatch({ type: 'show', presentation_id: created.presentation_id! }, expectedFrom(await repository.snapshot()));
  const editor = new SessionEditor(repository, await repository.snapshot(), created.presentation_id!, async () => {});
  editor.composition(true); editor.input({ kind: 'text', text: 'әңгәмә' });
  await expect(editor.prepareUpdate()).rejects.toThrow('composition_in_progress');
  expect((await repository.snapshot()).sessions[0]!.status).toBe('active');
  editor.composition(false); await editor.prepareUpdate();
  editor.input({ kind: 'text', text: 'late input' });
  await expect(editor.perform({ type: 'resume', session_id: created.session_id! })).rejects.toThrow('update_in_progress');
  const snapshot = await repository.snapshot(); expect(snapshot.sessions[0]!.status).toBe('paused');
  expect(snapshot.presentations.find(item => item.presentation_id === created.presentation_id)!.draft_answer).toEqual({ kind: 'text', text: 'әңгәмә' }); expect(editor.dirty).toBe(false);
  await editor.dispose(); repository.close();
});
it('does not reopen a suspended draft queue when a rejected preparation removes its update fence', async () => {
  const repository = await ProgressRepository.memory({ catalog, releaseId: 'test-release' });
  const created = await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
  const editor = new SessionEditor(repository, await repository.snapshot(), created.presentation_id!, async () => {});
  await editor.suspend(); editor.beginUpdate(); editor.cancelUpdate(); editor.input({ kind: 'text', text: 'not admitted' });
  expect(editor.getState()).toMatchObject({ busy: true, answer: null }); await expect(editor.prepareUpdate()).rejects.toThrow('editor_unavailable');
  await editor.dispose(); repository.close();
});
