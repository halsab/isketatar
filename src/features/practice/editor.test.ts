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
