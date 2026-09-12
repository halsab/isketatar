import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { catalog, correctAnswer, now } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import { replacementToken } from './transfer';

const opened: ProgressRepository[] = [];
let sequence = 0;
async function open(name = `progress-test-${++sequence}`, tabId: string = crypto.randomUUID()) {
  const repository = await ProgressRepository.open({ catalog, releaseId: 'test-release', name, tabId, clock: () => now, uuid: () => crypto.randomUUID() });
  opened.push(repository);
  return repository;
}
afterEach(() => { for (const repository of opened.splice(0)) repository.close(); vi.unstubAllGlobals(); });
describe('atomic progress commands', () => {
  it('disclosing submitted feedback marks a related paused transfer as assisted without changing old attempts', async () => {
    const repository = await open();
    const run = async (command: Parameters<ProgressRepository['dispatch']>[0]) => repository.dispatch(command, expectedFrom(await repository.snapshot()));
    const final = await run({ type: 'start', kind: 'final' });
    await run({ type: 'finish_assessment', session_id: final.session_id!, confirm_incomplete: true, defer_imla: false });
    const old = (await repository.snapshot()).attempts;
    const lesson = await run({ type: 'start', kind: 'lesson_cycle', lesson_id: 'L09' });
    let active = lesson.presentation_id!;
    while ((await repository.snapshot()).presentations.find(item => item.presentation_id === active)!.question_id !== 'Q-L09-07') {
      await run({ type: 'show', presentation_id: active });
      await run({ type: 'submit', presentation_id: active, answer: { kind: 'unknown' } });
      active = (await run({ type: 'ack', presentation_id: active })).presentation_id!;
    }
    await run({ type: 'show', presentation_id: active });
    await run({ type: 'pause', session_id: lesson.session_id! });
    await run({ type: 'help', kind: 'reveal', presentation_id: old.find(item => item.question_id === 'F-15')!.presentation_id });
    await run({ type: 'resume', session_id: lesson.session_id! });
    const result = await run({ type: 'submit', presentation_id: active, answer: correctAnswer('Q-L09-07') });
    expect(result.attempt?.independent_correct).toBe(false);
    expect(result.attempt?.assistance_before_submit.reference_opened_at).toBe(now);
    expect((await repository.snapshot()).attempts.filter(item => item.session_id === final.session_id)).toEqual(old);
  });
  it('opens compatible submitted feedback across app releases but fences unfinished sessions', async () => {
    const name = `release-feedback-${++sequence}`;
    const previous = await open(name);
    const final = await previous.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await previous.snapshot()));
    await previous.dispatch({ type: 'finish_assessment', session_id: final.session_id!, confirm_incomplete: true, defer_imla: false }, expectedFrom(await previous.snapshot()));
    const active = await previous.dispatch({ type: 'start', kind: 'diagnostic' }, expectedFrom(await previous.snapshot()));
    const next = await ProgressRepository.open({ catalog, releaseId: 'next-release', name, tabId: previous.tabId, clock: () => now });
    opened.push(next);
    await previous.dispatch({ type: 'pause', session_id: active.session_id! }, expectedFrom(await previous.snapshot()));
    const gate = await previous.beginUpdate(replacementToken(await previous.snapshot()), next.options.releaseId);
    await previous.commitUpdate(replacementToken(await previous.snapshot()), gate.update_id);
    await next.finishUpdate(replacementToken(await next.snapshot()), gate.update_id);
    const before = await next.snapshot();
    await next.dispatch({ type: 'help', kind: 'reveal', presentation_id: before.attempts[0]!.presentation_id, confirm_assessment_help: true }, expectedFrom(before));
    await expect(next.dispatch({ type: 'resume', session_id: active.session_id! }, expectedFrom(await next.snapshot()))).rejects.toThrow('incompatible_session');
    expect((await next.snapshot()).attempts).toEqual(before.attempts);
  });
  it('freezes A02 in full practice/transfer order, pauses and resumes without changing IDs/options', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'A02' }, expectedFrom(await repository.snapshot()));
    const before = await repository.snapshot();
    const session = before.sessions[0]!;
    expect(session.question_plan.map(item => item.question_id)).toEqual(catalog.lessonPlan('A02').map(item => item.id));
    await repository.dispatch({ type: 'pause', session_id: session.session_id }, expectedFrom(before));
    await repository.dispatch({ type: 'resume', session_id: session.session_id }, expectedFrom(await repository.snapshot()));
    expect((await repository.snapshot()).sessions[0]!.question_plan).toEqual(session.question_plan);
  });
  it('creates one immutable Attempt and one SRS transition for duplicate submit', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const started = await repository.snapshot();
    const id = started.sessions[0]!.active_presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(started));
    const before = await repository.snapshot();
    const command = { type: 'submit' as const, presentation_id: id, answer: { kind: 'unknown' as const } };
    await repository.dispatch(command, expectedFrom(before));
    await repository.dispatch(command, expectedFrom(before));
    const after = await repository.snapshot();
    expect(after.attempts).toHaveLength(1);
    expect(after.review_cards[0]!.attempt_count).toBe(1);
    expect(after.control.state_revision).toBe(before.control.state_revision + 1);
    await expect(repository.dispatch({ ...command, answer: correctAnswer(after.attempts[0]!.question_id) }, expectedFrom(before))).rejects.toThrow('write_conflict');
  });
  it('prevents an old writer callback after explicit takeover', async () => {
    const name = `shared-${++sequence}`;
    const first = await open(name);
    const stale = await first.snapshot();
    const second = await open(name);
    await second.takeover(stale.control.data_generation, stale.control.writer_epoch);
    await expect(first.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(stale))).rejects.toThrow('write_conflict');
    expect((await second.snapshot()).sessions).toEqual([]);
  });
  it('commits help from a read-only tab before disclosure and rejects stale submit', async () => {
    const name = `help-${++sequence}`;
    const first = await open(name);
    await first.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await first.snapshot()));
    const started = await first.snapshot();
    const id = started.sessions[0]!.active_presentation_id!;
    await first.dispatch({ type: 'show', presentation_id: id }, expectedFrom(started));
    const before = await first.snapshot();
    const second = await open(name);
    await second.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(before));
    expect((await first.snapshot()).sessions[0]!.assessment_help_opened_at).toBe(now);
    await expect(first.dispatch({ type: 'finish_assessment', session_id: before.sessions[0]!.session_id, confirm_incomplete: true, defer_imla: false }, expectedFrom(before))).rejects.toThrow('write_conflict');
  });
  it('finishes an incomplete assessment atomically without pretending unseen questions were shown', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await repository.snapshot()));
    const snapshot = await repository.snapshot();
    const command = { type: 'finish_assessment' as const, session_id: snapshot.sessions[0]!.session_id, confirm_incomplete: false, defer_imla: false };
    await expect(repository.dispatch(command, expectedFrom(snapshot))).rejects.toThrow('incomplete_confirmation_required');
    expect((await repository.snapshot()).attempts).toEqual([]);
    await repository.dispatch({ ...command, confirm_incomplete: true }, expectedFrom(snapshot));
    const final = await repository.snapshot();
    expect(final.attempts).toHaveLength(20);
    expect(final.attempts.every(attempt => attempt.grade === 'unknown' && attempt.elapsed_ms === null)).toBe(true);
    expect(final.sessions[0]!.status).toBe('submitted');
    expect(final.review_cards).toEqual([]);
    expect(final.exposures).toEqual([]);
    expect(final.presentations.every(presentation => presentation.feedback_opened_at === null)).toBe(true);
    await repository.dispatch({ ...command, confirm_incomplete: true }, expectedFrom(snapshot));
    expect((await repository.snapshot()).control.state_revision).toBe(final.control.state_revision);
  });
  it('treats a cleared assessment text draft as unanswered on confirmed completion', async () => {
    const repository = await open();
    const started = await repository.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await repository.snapshot()));
    const questionId = catalog.core.final_ids.find(id => catalog.question(id).type === 'reading')!;
    const selected = await repository.dispatch({ type: 'navigate_question', session_id: started.session_id!, question_id: questionId }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'show', presentation_id: selected.presentation_id! }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'draft', presentation_id: selected.presentation_id!, answer: { kind: 'text', text: '   ' } }, expectedFrom(await repository.snapshot()));
    const before = await repository.snapshot();
    await expect(repository.dispatch({ type: 'finish_assessment', session_id: started.session_id!, confirm_incomplete: false, defer_imla: false }, expectedFrom(before))).rejects.toThrow('incomplete_confirmation_required');
    await repository.dispatch({ type: 'finish_assessment', session_id: started.session_id!, confirm_incomplete: true, defer_imla: false }, expectedFrom(before));
    expect((await repository.snapshot()).attempts.find(attempt => attempt.question_id === questionId)?.answer_raw).toEqual({ kind: 'unknown' });
  });
  it('rolls back successful requests when a later request aborts the transaction', async () => {
    const repository = await open();
    const before = await repository.snapshot();
    await expect(repository.backend.run('readwrite', async tx => {
      await tx.put('meta', { key: 'settings', value: { ...before.settings, theme: 'dark' } });
      await tx.put('meta', { ...before.control, writer_epoch: 999 });
      throw new DOMException('test abort', 'AbortError');
    })).rejects.toThrow('storage_unavailable');
    expect(await repository.snapshot()).toEqual(before);
  });
  it('preserves hint, draft and immutable first result across reopen and retry', async () => {
    const name = `reload-${++sequence}`;
    const repository = await open(name);
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = (await repository.snapshot()).sessions[0]!.active_presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'help', kind: 'hint', hint_index: 0, presentation_id: id }, expectedFrom(await repository.snapshot()));
    const reopened = await open(name, repository.tabId);
    const snapshot = await reopened.snapshot();
    const qid = snapshot.presentations.find(presentation => presentation.presentation_id === id)!.question_id;
    await reopened.dispatch({ type: 'draft', presentation_id: id, answer: correctAnswer(qid) }, expectedFrom(snapshot));
    await reopened.dispatch({ type: 'submit', presentation_id: id, answer: correctAnswer(qid) }, expectedFrom(await reopened.snapshot()));
    const first = (await reopened.snapshot()).attempts[0]!;
    expect(first.independent_correct).toBe(false);
    expect(first.assistance_before_submit.hint_indices).toEqual([0]);
    const retried = await reopened.dispatch({ type: 'retry', presentation_id: id }, expectedFrom(await reopened.snapshot()));
    expect(retried.presentation_id).not.toBe(id);
    expect((await reopened.snapshot()).attempts[0]).toEqual(first);
  });
  it('validates settings and bookmarks and refuses hidden course review origins', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'settings', patch: { theme: 'dark', selected_route: 'new_to_script' } }, expectedFrom(await repository.snapshot()));
    expect((await repository.snapshot()).settings).toMatchObject({ theme: 'dark', selected_route: 'new_to_script' });
    await expect(repository.dispatch({ type: 'settings', patch: { review_batch_size: 99 } }, expectedFrom(await repository.snapshot()))).rejects.toThrow('invalid_settings');
    await repository.dispatch({ type: 'bookmark', kind: 'dictionary', target_id: 'lex-55-001', position: null }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'bookmark', kind: 'dictionary', target_id: 'lex-55-001', position: null }, expectedFrom(await repository.snapshot()));
    expect((await repository.snapshot()).bookmarks).toHaveLength(1);
    await expect(repository.dispatch({ type: 'review_add', question_id: 'Q-V04-07', origin: { kind: 'dictionary', id: 'COURSE-EX-V04-05' } }, expectedFrom(await repository.snapshot()))).rejects.toThrow('invalid_review_origin');
    await expect(repository.dispatch({ type: 'read_complete', reading_id: 'READ-F01' }, expectedFrom(await repository.snapshot()))).rejects.toThrow('reading_unavailable');
  });
  it('rolls back an answer if the expected review-card revision changed', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'review_add', question_id: 'Q-V04-01', origin: { kind: 'manual', id: 'Q-V04-01' } }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = (await repository.snapshot()).sessions[0]!.active_presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    const stale = await repository.snapshot();
    await repository.dispatch({ type: 'review_suspend', question_id: 'Q-V04-01' }, expectedFrom(stale));
    const before = await repository.snapshot();
    await expect(repository.dispatch({ type: 'submit', presentation_id: id, answer: { kind: 'unknown' } }, expectedFrom(stale))).rejects.toThrow('write_conflict');
    expect(await repository.snapshot()).toEqual(before);
  });
  it('keeps feedback help out of the immutable first submission', async () => {
    const repository = await open();
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = (await repository.snapshot()).sessions[0]!.active_presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'submit', presentation_id: id, answer: correctAnswer('Q-V04-01') }, expectedFrom(await repository.snapshot()));
    const attempt = (await repository.snapshot()).attempts[0]!;
    await repository.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: false }, expectedFrom(await repository.snapshot()));
    expect((await repository.snapshot()).attempts[0]).toEqual(attempt);
    expect(attempt.independent_correct).toBe(true);
  });
  it('does not create a current SRS card from an older grading revision', async () => {
    const currentCore = structuredClone(catalog.core);
    currentCore.questions.find(question => question.id === 'Q-V04-01')!.grading_revision = 'f'.repeat(64);
    const repository = await ProgressRepository.open({ catalog, currentCore, releaseId: 'old-release', name: `old-${++sequence}`, clock: () => now });
    opened.push(repository);
    await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = (await repository.snapshot()).sessions[0]!.active_presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'submit', presentation_id: id, answer: { kind: 'unknown' } }, expectedFrom(await repository.snapshot()));
    expect((await repository.snapshot()).attempts).toHaveLength(1);
    expect((await repository.snapshot()).review_cards).toEqual([]);
  });
  it('honors the update commit gate even for cross-tab observations', async () => {
    const repository = await open();
    const before = await repository.snapshot();
    await repository.backend.run('readwrite', tx => tx.put('meta', { ...before.control, update_gate: { update_id: crypto.randomUUID(), target_release_id: 'next', phase: 'commit', coordinator_id: repository.tabId, requested_at: now } }));
    const gated = await repository.snapshot();
    await expect(repository.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(before))).rejects.toThrow('update_in_progress');
    await expect(repository.takeover(gated.control.data_generation, gated.control.writer_epoch)).rejects.toThrow('update_in_progress');
    expect(await repository.snapshot()).toEqual(gated);
  });
  it.each(['hint', 'reading'] as const)('gates %s from a paused lesson before disclosing it during a final', async kind => {
    const repository = await open();
    const lesson = await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = lesson.presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    const final = await repository.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await repository.snapshot()));
    const before = await repository.snapshot();
    const command = { type: 'help' as const, kind, hint_index: 0, presentation_id: id };
    await expect(repository.dispatch(command, expectedFrom(before))).rejects.toThrow('assessment_help_confirmation_required');
    expect(await repository.snapshot()).toEqual(before);
    await repository.dispatch({ ...command, confirm_assessment_help: true }, expectedFrom(before));
    expect((await repository.snapshot()).sessions.find(session => session.session_id === final.session_id)!.assessment_help_opened_at).toBe(now);
  });
  it.each(['show', 'submit'] as const)('gates %s when resuming an ordinary question while an assessment is paused', async type => {
    const repository = await open();
    const lesson = await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'show', presentation_id: lesson.presentation_id! }, expectedFrom(await repository.snapshot()));
    const final = await repository.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'resume', session_id: lesson.session_id! }, expectedFrom(await repository.snapshot()));
    const before = await repository.snapshot();
    const command = { type, presentation_id: lesson.presentation_id!, answer: { kind: 'unknown' as const } };
    await expect(repository.dispatch(command, expectedFrom(before))).rejects.toThrow('assessment_help_confirmation_required');
    expect(await repository.snapshot()).toEqual(before);
    await repository.dispatch({ ...command, confirm_assessment_help: true }, expectedFrom(before));
    expect((await repository.snapshot()).sessions.find(session => session.session_id === final.session_id)!.assessment_help_opened_at).toBe(now);
  });
  it('continues from a revisited acknowledged answer without accepting a stale acknowledgement', async () => {
    const repository = await open();
    const lesson = await repository.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await repository.snapshot()));
    const id = lesson.presentation_id!;
    await repository.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'submit', presentation_id: id, answer: { kind: 'unknown' } }, expectedFrom(await repository.snapshot()));
    const stale = expectedFrom(await repository.snapshot());
    const next = await repository.dispatch({ type: 'ack', presentation_id: id }, stale);
    expect((await repository.dispatch({ type: 'ack', presentation_id: id }, stale)).presentation_id).toBe(next.presentation_id);
    await repository.dispatch({ type: 'navigate_question', session_id: lesson.session_id!, question_id: 'Q-V04-01' }, expectedFrom(await repository.snapshot()));
    await expect(repository.dispatch({ type: 'ack', presentation_id: id }, stale)).rejects.toThrow('write_conflict');
    expect((await repository.dispatch({ type: 'ack', presentation_id: id }, expectedFrom(await repository.snapshot()))).presentation_id).toBe(next.presentation_id);
  });
  it('opens submitted assessment feedback using a fresh ordinary token and gates another pending assessment', async () => {
    const repository = await open();
    const final = await repository.dispatch({ type: 'start', kind: 'final' }, expectedFrom(await repository.snapshot()));
    await repository.dispatch({ type: 'finish_assessment', session_id: final.session_id!, confirm_incomplete: true, defer_imla: false }, expectedFrom(await repository.snapshot()));
    const first = (await repository.snapshot()).attempts;
    await repository.dispatch({ type: 'help', kind: 'reading', presentation_id: final.presentation_id! }, expectedFrom(await repository.snapshot()));
    const diagnostic = await repository.dispatch({ type: 'start', kind: 'diagnostic' }, expectedFrom(await repository.snapshot()));
    const before = await repository.snapshot();
    const command = { type: 'help' as const, kind: 'reveal' as const, presentation_id: final.presentation_id! };
    await expect(repository.dispatch(command, expectedFrom(before))).rejects.toThrow('assessment_help_confirmation_required');
    await repository.dispatch({ ...command, confirm_assessment_help: true }, expectedFrom(before));
    const after = await repository.snapshot();
    expect(after.attempts).toEqual(first);
    expect(after.sessions.find(session => session.session_id === diagnostic.session_id)!.assessment_help_opened_at).toBe(now);
  });
  it('records monotone question help from a non-writer and keeps its time within the presentation after clock rollback', async () => {
    const name = `clock-help-${++sequence}`;
    const first = await open(name);
    const lesson = await first.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await first.snapshot()));
    await first.dispatch({ type: 'show', presentation_id: lesson.presentation_id! }, expectedFrom(await first.snapshot()));
    const second = await ProgressRepository.open({ catalog, name, releaseId: 'test-release', clock: () => now - 1000 });
    opened.push(second);
    await second.dispatch({ type: 'help', kind: 'hint', hint_index: 0, presentation_id: lesson.presentation_id! }, expectedFrom(await second.snapshot()));
    const snapshot = await first.snapshot();
    const shown = snapshot.presentations.find(presentation => presentation.presentation_id === lesson.presentation_id)!;
    expect(shown.assistance.first_hint_at).toBe(shown.shown_at);
    await expect(second.dispatch({ type: 'help', kind: 'reveal', presentation_id: lesson.presentation_id! }, expectedFrom(snapshot))).rejects.toThrow('write_conflict');
    await first.dispatch({ type: 'submit', presentation_id: lesson.presentation_id!, answer: correctAnswer('Q-V04-01') }, expectedFrom(snapshot));
    expect((await first.snapshot()).attempts[0]!.independent_correct).toBe(false);
  });
  it('does not reject a durable commit when its connection and notification channel close in flight', async () => {
    class ClosingChannel {
      onmessage = null;
      closed = false;
      postMessage() { if (this.closed) throw new DOMException('closed', 'InvalidStateError'); }
      close() { this.closed = true; }
    }
    vi.stubGlobal('window', {});
    vi.stubGlobal('BroadcastChannel', ClosingChannel);
    const name = `closing-${++sequence}`;
    const repository = await open(name);
    const token = expectedFrom(await repository.snapshot());
    const run = repository.backend.run.bind(repository.backend);
    vi.spyOn(repository.backend, 'run').mockImplementationOnce((mode, body) => run(mode, async tx => {
      const result = await body(tx);
      repository.close();
      return result;
    }));
    await expect(repository.dispatch({ type: 'settings', patch: { theme: 'dark' } }, token)).resolves.toBeDefined();
    expect((await (await open(name)).snapshot()).settings.theme).toBe('dark');
  });
});
