import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { openDB } from 'idb';
import { readUpdateState } from './progress-state';
import { ProgressRepository, expectedFrom } from '../progress/repository';
import { replacementToken } from '../progress/transfer';
import { catalog } from '../../../tests/learning-fixture';

it('does not create a missing progress database and reads only version gates and unfinished release pins', async () => {
  const name = crypto.randomUUID();
  expect(await readUpdateState(name)).toBeNull(); expect((await indexedDB.databases()).some(db => db.name === name)).toBe(false);
  const repository = await ProgressRepository.open({ catalog, name, releaseId: '1.0.0-1111111111111111' });
  try {
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    let snapshot = await repository.snapshot();
    await repository.dispatch({ type: 'show', presentation_id: snapshot.sessions[0]!.active_presentation_id! }, expectedFrom(snapshot)); snapshot = await repository.snapshot();
    await repository.dispatch({ type: 'draft', presentation_id: snapshot.sessions[0]!.active_presentation_id!, answer: { kind: 'text', text: 'private answer' } }, expectedFrom(snapshot));
    const gate = await repository.beginUpdate(replacementToken(await repository.snapshot()), '1.0.0-2222222222222222');
    const state = await readUpdateState(name);
    expect(state?.control.update_gate).toEqual(gate); expect(state?.active).toBe(true);
    expect(state?.pins).toEqual([{ session_id: snapshot.sessions[0]!.session_id, release_id: repository.options.releaseId, content_schema: 1, policy_versions: catalog.core.policy_versions }]);
    expect(JSON.stringify(state)).not.toMatch(/private answer|question_plan|draft_answer|attempts|settings/u);
    const raw = await openDB(name, 1); await raw.put('meta', { ...snapshot.control, progress_schema: 9 }); raw.close();
    await expect(readUpdateState(name)).rejects.toThrow('unsupported_storage');
  } finally { repository.close(); }
});
