import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { catalog, correctAnswer, now } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import type { Command } from './commands';
import { DAY_MS } from '../../domain/learning/review';

const opened: ProgressRepository[] = [];
async function open() {
  const repository = await ProgressRepository.open({ catalog, releaseId: 'test-release', name: crypto.randomUUID(), clock: () => now });
  opened.push(repository); return repository;
}
afterEach(() => { opened.splice(0).forEach(repository => repository.close()); });
it('skip keeps the frozen plan and schedule, unknown schedules, and the completed session survives transfer', async () => {
  const repository = await open();
  const run = async (command: Command) => repository.dispatch(command, expectedFrom(await repository.snapshot()));
  for (const question_id of ['Q-V04-01', 'RQ-01-01']) await run({ type: 'review_add', question_id, origin: { kind: 'manual', id: question_id } });
  const cards = (await repository.snapshot()).review_cards;
  const started = await run({ type: 'start', kind: 'review' });
  await run({ type: 'show', presentation_id: started.presentation_id! });
  await run({ type: 'draft', presentation_id: started.presentation_id!, answer: { kind: 'text', text: 'черновик' } });
  const next = await run({ type: 'skip', presentation_id: started.presentation_id! });
  const skipped = await repository.snapshot();
  expect(skipped.attempts).toHaveLength(0); expect(skipped.review_cards).toEqual(cards);
  expect(skipped.presentations.find(item => item.presentation_id === started.presentation_id)).toMatchObject({ status: 'skipped', draft_answer: null, feedback_opened_at: null });
  expect(skipped.sessions[0]!.question_plan).toHaveLength(2);
  await run({ type: 'pause', session_id: started.session_id! }); await run({ type: 'resume', session_id: started.session_id! });
  expect((await repository.snapshot()).sessions[0]!.active_presentation_id).toBe(next.presentation_id);
  await run({ type: 'show', presentation_id: next.presentation_id! });
  await run({ type: 'submit', presentation_id: next.presentation_id!, answer: { kind: 'unknown' } });
  await run({ type: 'ack', presentation_id: next.presentation_id! });
  const finished = await repository.snapshot();
  expect(finished.sessions[0]!.status).toBe('submitted'); expect(finished.attempts).toHaveLength(1);
  expect(finished.review_cards.find(card => card.question_id === finished.attempts[0]!.question_id)).toMatchObject({ step: 0, due_at: now + DAY_MS, unknown_count: 1 });
  const target = await open(); const preview = await target.previewImport(await repository.exportProgress()); await target.commitImport(preview.id, true);
  expect((await target.snapshot()).presentations).toEqual(finished.presentations);
  const forged = JSON.parse(await (await repository.exportProgress()).text());
  forged.data.presentations.find((item: { status: string }) => item.status === 'skipped').draft_answer = { kind: 'unknown' };
  await expect(target.previewImport(new Blob([JSON.stringify(forged)]))).rejects.toThrow();
});
it('rejects skip outside review and retains the date after an early independent answer', async () => {
  const repository = await open();
  const run = async (command: Command) => repository.dispatch(command, expectedFrom(await repository.snapshot()));
  const lesson = await run({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' });
  await run({ type: 'show', presentation_id: lesson.presentation_id! });
  await expect(run({ type: 'skip', presentation_id: lesson.presentation_id! })).rejects.toThrow('invalid_session_state');
  await run({ type: 'review_add', question_id: 'Q-V04-01', origin: { kind: 'manual', id: 'Q-V04-01' } });
  const due = await run({ type: 'start', kind: 'review' });
  await run({ type: 'show', presentation_id: due.presentation_id! }); await run({ type: 'submit', presentation_id: due.presentation_id!, answer: correctAnswer('Q-V04-01') }); await run({ type: 'ack', presentation_id: due.presentation_id! });
  const scheduled = (await repository.snapshot()).review_cards[0]!;
  const early = await run({ type: 'start', kind: 'review', early_question_ids: ['Q-V04-01'] });
  await run({ type: 'show', presentation_id: early.presentation_id! }); await run({ type: 'submit', presentation_id: early.presentation_id!, answer: correctAnswer('Q-V04-01') });
  expect((await repository.snapshot()).review_cards[0]).toMatchObject({ step: scheduled.step, due_at: scheduled.due_at });
});
