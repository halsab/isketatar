import 'fake-indexeddb/auto';
import { expect, it } from 'vitest';
import { catalog } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import { replacementToken } from './transfer';

it('fences an unaccepted shell and the old reader after commit, including observation, reset and takeover', async () => {
  const name = crypto.randomUUID(); const tabId = crypto.randomUUID();
  const old = await ProgressRepository.open({ name, tabId, catalog, releaseId: 'R1' });
  const next = await ProgressRepository.open({ name, tabId, catalog, releaseId: 'R2' });
  try {
    const before = await old.snapshot();
    expect(before.control.accepted_release_id).toBe('R1');
    await expect(next.dispatch({ type: 'settings', patch: { theme: 'dark' } }, expectedFrom(before))).rejects.toThrow('release_not_current');
    await expect(next.reset(replacementToken(before), true)).rejects.toThrow('release_not_current');
    await expect(next.takeover(before.control.data_generation, before.control.writer_epoch)).rejects.toThrow('release_not_current');
    const gate = await old.beginUpdate(replacementToken(before), 'R2');
    await old.commitUpdate(replacementToken(await old.snapshot()), gate.update_id);
    await next.finishUpdate(replacementToken(await next.snapshot()), gate.update_id);
    const after = await next.snapshot(); expect(after.control.accepted_release_id).toBe('R2'); expect(after.control.data_generation).toBe(before.control.data_generation);
    await expect(old.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: false }, expectedFrom(before))).rejects.toThrow('release_not_current');
    await next.dispatch({ type: 'settings', patch: { theme: 'dark' } }, expectedFrom(after));
    const backup = await next.exportProgress(); expect(await backup.text()).not.toContain('accepted_release_id');
    await next.reset(replacementToken(await next.snapshot()), true); expect((await next.snapshot()).control.accepted_release_id).toBe('R2');
    const preview = await next.previewImport(backup); await next.commitImport(preview.id, true); expect((await next.snapshot()).control.accepted_release_id).toBe('R2');
  } finally { old.close(); next.close(); }
});
