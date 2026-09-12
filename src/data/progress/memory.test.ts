import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, now } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import { replacementToken } from './transfer';
import type { Transaction } from './backend';
import { SOFT_BYTES } from './model';

const opened: ProgressRepository[] = [];
async function durable() { const repository = await ProgressRepository.open({ catalog, releaseId: 'memory-test', name: crypto.randomUUID(), clock: () => now }); opened.push(repository); return repository; }
afterEach(() => { for (const repository of opened.splice(0)) repository.close(); });
describe('explicit memory branch', () => {
  it('copies a coherent snapshot into an isolated unsaved branch without redirecting late callbacks', async () => {
    const saved = await durable();
    const lesson = await saved.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await saved.snapshot()));
    await saved.dispatch({ type: 'show', presentation_id: lesson.presentation_id! }, expectedFrom(await saved.snapshot()));
    const before = await saved.snapshot();
    const memory = await saved.branchToMemory(); opened.push(memory);
    expect(memory.mode).toBe('memory');
    const snapshot = await memory.snapshot();
    expect(snapshot.sessions[0]!.question_plan).toEqual(before.sessions[0]!.question_plan);
    expect(snapshot.control.data_generation).not.toBe(before.control.data_generation);
    await expect(saved.dispatch({ type: 'draft', presentation_id: lesson.presentation_id!, answer: { kind: 'text', text: 'текст' } }, expectedFrom(before))).rejects.toThrow('repository_detached');
    await expect(saved.reset(replacementToken(before), true)).rejects.toThrow('repository_detached');
    await expect(saved.takeover(before.control.data_generation, before.control.writer_epoch)).rejects.toThrow('repository_detached');
    await memory.dispatch({ type: 'resume', session_id: lesson.session_id! }, expectedFrom(snapshot));
    await memory.dispatch({ type: 'submit', presentation_id: lesson.presentation_id!, answer: { kind: 'unknown' } }, expectedFrom(await memory.snapshot()));
    expect((await saved.snapshot()).attempts).toEqual([]);
    expect((await memory.snapshot()).attempts).toHaveLength(1);
    const fresh = await durable();
    const preview = await fresh.previewImport(await memory.exportProgress());
    await fresh.commitImport(preview.id, true);
    expect((await fresh.snapshot()).attempts).toEqual((await memory.snapshot()).attempts);
  });
  it('persists help to the original pending durable assessment before disclosure in memory', async () => {
    const saved = await durable();
    const final = await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    const memory = await saved.branchToMemory(); opened.push(memory);
    const command = { type: 'observe' as const, target: { kind: 'lesson' as const, id: 'V04' }, confirm_assessment_help: true };
    await memory.dispatch(command, expectedFrom(await memory.snapshot()));
    expect((await saved.snapshot()).sessions.find(session => session.session_id === final.session_id)!.assessment_help_opened_at).toBe(now);
    expect((await memory.snapshot()).sessions.find(session => session.session_id === final.session_id)!.assessment_help_opened_at).toBe(now);
    expect((await saved.snapshot()).exposures).toEqual([]);
  });
  it('keeps help closed on durable quota failure even after clearing the memory branch', async () => {
    const saved = await durable();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    const memory = await saved.branchToMemory(); opened.push(memory);
    await memory.discardMemory(replacementToken(await memory.snapshot()), true);
    const before = await memory.snapshot();
    const run = saved.backend.run.bind(saved.backend);
    vi.spyOn(saved.backend, 'run').mockImplementationOnce(() => Promise.reject(new DOMException('test quota', 'QuotaExceededError')));
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(before))).rejects.toThrow('durable_help_required');
    expect(await memory.snapshot()).toEqual(before);
    saved.backend.run = run;
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: false }, expectedFrom(before))).rejects.toThrow('assessment_help_confirmation_required');
    await memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(before));
    expect((await saved.snapshot()).sessions[0]!.assessment_help_opened_at).toBe(now);
  });
  it('starts blank after a read failure but retains protection for known saved assessments', async () => {
    const saved = await durable();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    await saved.snapshot();
    const run = saved.backend.run.bind(saved.backend);
    vi.spyOn(saved.backend, 'run').mockImplementation(() => Promise.reject(new Error('storage_unavailable')));
    const memory = await saved.branchToMemory(); opened.push(memory);
    expect((await memory.snapshot()).sessions).toEqual([]);
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()))).rejects.toThrow('durable_help_required');
    saved.backend.run = run;
    await memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()));
    expect((await saved.snapshot()).sessions[0]!.assessment_help_opened_at).toBe(now);
  });
  it('never presents a memory-only clear as a successful durable reset', async () => {
    const saved = await durable();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    const memory = await saved.branchToMemory(); opened.push(memory);
    await expect(memory.reset(replacementToken(await memory.snapshot()), true)).rejects.toThrow('durable_reset_required');
    const recovered = await ProgressRepository.open({ ...saved.options, tabId: saved.tabId }); opened.push(recovered);
    await recovered.reset(replacementToken(await recovered.snapshot()), true);
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()))).rejects.toThrow('write_conflict');
    await memory.confirmDurableReset(recovered);
    await memory.discardMemory(replacementToken(await memory.snapshot()), true);
    await memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: false }, expectedFrom(await memory.snapshot()));
    expect((await saved.snapshot()).sessions).toEqual([]);
  });
  it('remembers a committed assessment even if the next snapshot fails', async () => {
    const saved = await durable();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    const run = saved.backend.run.bind(saved.backend);
    vi.spyOn(saved.backend, 'run').mockImplementation(() => Promise.reject(new Error('storage_unavailable')));
    const memory = await saved.branchToMemory(); opened.push(memory);
    expect((await memory.snapshot()).sessions).toEqual([]);
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()))).rejects.toThrow('durable_help_required');
    saved.backend.run = run;
  });
  it('can retry the durable help barrier after its original connection closed', async () => {
    const saved = await durable();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    saved.close();
    const memory = await saved.branchToMemory(); opened.push(memory);
    await memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()));
    const recovered = await ProgressRepository.open(saved.options); opened.push(recovered);
    expect((await recovered.snapshot()).sessions[0]!.assessment_help_opened_at).toBe(now);
  });
  it('rolls back all memory writes and rejects requests after a transaction ends', async () => {
    const memory = await ProgressRepository.memory({ catalog, releaseId: 'memory-test', clock: () => now }); opened.push(memory);
    const before = await memory.snapshot();
    let ended: Transaction | undefined;
    await expect(memory.backend.run('readwrite', async tx => {
      ended = tx;
      await tx.put('meta', { key: 'settings', value: { ...before.settings, theme: 'dark' } });
      throw new Error('test_abort');
    })).rejects.toThrow('test_abort');
    expect(await memory.snapshot()).toEqual(before);
    await expect(ended!.put('meta', { key: 'settings', value: { ...before.settings, theme: 'dark' } })).rejects.toThrow('storage_unavailable');
    expect(await memory.snapshot()).toEqual(before);
  });
  it('allows memory work beyond the durable soft threshold while retaining the hard export bound', async () => {
    const memory = await ProgressRepository.memory({ catalog, releaseId: 'memory-test', clock: () => now }); opened.push(memory);
    const snapshot = await memory.snapshot();
    await memory.backend.run('readwrite', tx => tx.put('meta', { ...snapshot.control, estimated_record_bytes: SOFT_BYTES }));
    await memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: false }, expectedFrom(await memory.snapshot()));
    expect((await memory.snapshot()).exposures).toHaveLength(1);
    const large = await memory.snapshot();
    await memory.backend.run('readwrite', tx => tx.put('meta', { ...large.control, estimated_record_bytes: 20 * 1024 * 1024 }));
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V05' }, confirm_assessment_help: false }, expectedFrom(large))).rejects.toThrow('history_full');
  });
  it('keeps the source update gate and help protection when a file replaces the memory branch', async () => {
    const saved = await durable();
    const empty = await saved.exportProgress();
    await saved.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await saved.snapshot()));
    const memory = await saved.branchToMemory(); opened.push(memory);
    const preview = await memory.previewImport(empty);
    await memory.commitImport(preview.id, true);
    const before = await saved.snapshot();
    await saved.backend.run('readwrite', tx => tx.put('meta', { ...before.control, update_gate: { update_id: crypto.randomUUID(), target_release_id: 'next', phase: 'commit', coordinator_id: saved.tabId, requested_at: now } }));
    const branchBefore = await memory.snapshot();
    await expect(memory.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(branchBefore))).rejects.toThrow('update_in_progress');
    expect(await memory.snapshot()).toEqual(branchBefore);
    expect((await saved.snapshot()).sessions[0]!.assessment_help_opened_at).toBeNull();
  });
  it('protects a just-imported assessment even when the connection closes before another snapshot', async () => {
    const source = await durable();
    await source.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await source.snapshot()));
    const saved = await durable();
    const preview = await saved.previewImport(await source.exportProgress());
    await saved.commitImport(preview.id, true);
    saved.close();
    const memory = await saved.branchToMemory(); opened.push(memory);
    expect((await memory.snapshot()).sessions).toEqual([]);
    const command = { type: 'observe' as const, target: { kind: 'lesson' as const, id: 'V04' }, confirm_assessment_help: false };
    await expect(memory.dispatch(command, expectedFrom(await memory.snapshot()))).rejects.toThrow('assessment_help_confirmation_required');
    await memory.dispatch({ ...command, confirm_assessment_help: true }, expectedFrom(await memory.snapshot()));
    const recovered = await ProgressRepository.open(saved.options); opened.push(recovered);
    expect((await recovered.snapshot()).sessions[0]!.assessment_help_opened_at).toBe(now);
  });
});
