import { describe, expect, it } from 'vitest';
import cases from '../../../docs/production/learning-cases.json';
import { catalog, correctAnswer, fixtureSession, now } from '../../../tests/learning-fixture';
import type { AnswerValue } from './types';
import { makeAttempt } from './attempt';
import { addReviewCard, refreshReviewCard, reviewQueue, scheduleReview } from './review';

describe('review policy', () => {
  const q = catalog.question('Q-V04-07');
  it('LC-20 follows each exact UTC interval and caps at thirty days', () => {
    const fixture = cases.cases.find(item => item.id === 'LC-20')!;
    const input = fixture.input as { submissions: { submitted_at: number; answer_raw: AnswerValue }[] };
    const expected = fixture.expected as { after_each_submission: object[] };
    let card = addReviewCard(null, q, { kind: 'manual', id: q.id }, now);
    input.submissions.forEach((submission, index) => {
      const { session, presentations } = fixtureSession([q.id], 'review', submission.submitted_at);
      const attempt = makeAttempt(q, presentations[0]!, session, submission.answer_raw, submission.submitted_at);
      card = scheduleReview(card, q, attempt, session)!;
      expect(card).toMatchObject(expected.after_each_submission[index]!);
    });
  });
  it('LC-21/22 retains early success schedule and resets incorrect, unknown or assisted to one day', () => {
    const before = { ...addReviewCard(null, q, { kind: 'manual', id: q.id }, now), step: 3, due_at: now + 14 * 86400000 };
    const { session, presentations } = fixtureSession([q.id], 'review');
    const correct = makeAttempt(q, presentations[0]!, session, correctAnswer(q.id), now);
    expect(scheduleReview(before, q, correct, session)).toMatchObject({ step: 3, due_at: before.due_at, attempt_count: 1, independent_success_count: 1 });
    for (const variant of [{ answer: { kind: 'text', text: 'азан' }, help: false, outcome: 'incorrect' }, { answer: { kind: 'unknown' }, help: false, outcome: 'unknown' }, { answer: correctAnswer(q.id), help: true, outcome: 'assisted' }]) {
      const fixture = fixtureSession([q.id], 'review');
      if (variant.help) fixture.presentations[0]!.assistance.rule_opened_at = now;
      const attempt = makeAttempt(q, fixture.presentations[0]!, fixture.session, variant.answer as AnswerValue, now);
      expect(scheduleReview(before, q, attempt, fixture.session)).toMatchObject({ step: 0, due_at: now + 86400000, last_outcome: variant.outcome });
    }
  });
  it('LC-23 deduplicates origins and delivery of the same presentation', () => {
    const lesson = addReviewCard(null, q, { kind: 'lesson', id: 'V04' }, now);
    const dictionary = addReviewCard(lesson, q, { kind: 'dictionary', id: 'COURSE-EX-V04-05' }, now);
    expect(addReviewCard(dictionary, q, dictionary.origins[0]!, now).origins).toHaveLength(2);
    const { session, presentations } = fixtureSession([q.id]);
    const attempt = makeAttempt(q, presentations[0]!, session, { kind: 'unknown' }, now);
    const once = scheduleReview(dictionary, q, attempt, session)!;
    expect(scheduleReview(once, q, attempt, session)).toEqual(once);
    expect(once.attempt_count).toBe(1);
  });
  it('LC-24/25 enrolls only eligible unsuccessful first answers', () => {
    for (const id of [q.id, 'D-01', 'F-01', 'RQ-F01-01']) {
      const question = catalog.question(id);
      const { session, presentations } = fixtureSession([id], question.origin === 'diagnostic' ? 'diagnostic' : question.assessment_role === 'final' ? 'final' : 'lesson_cycle');
      const answer: AnswerValue = id === q.id ? correctAnswer(id) : { kind: 'unknown' };
      expect(scheduleReview(null, question, makeAttempt(question, presentations[0]!, session, answer, now), session)).toBeNull();
    }
  });
  it('LC-29/30 enrolls assisted course and ordinary reading with correct origin', () => {
    const course = fixtureSession([q.id]);
    course.presentations[0]!.assistance.hint_indices = [0];
    course.presentations[0]!.assistance.first_hint_at = now;
    const helped = makeAttempt(q, course.presentations[0]!, course.session, correctAnswer(q.id), now + 1);
    expect(scheduleReview(null, q, helped, course.session)).toMatchObject({ assisted_count: 1, last_outcome: 'assisted' });
    const reading = catalog.question('RQ-01-01');
    const { session, presentations } = fixtureSession([reading.id], 'reading_practice', now + 1000);
    session.reading_help = [{ line_id: 'READ-01-L01', word_id: null, kind: 'reading', opened_at: now }];
    const attempt = makeAttempt(reading, presentations[0]!, session, correctAnswer(reading.id), now + 2000);
    expect(scheduleReview(null, reading, attempt, session)).toMatchObject({ origins: [{ kind: 'reading', id: 'READ-01' }], step: 0, due_at: now + 2000 + 86400000, assisted_count: 1 });
  });
  it('ignores retry/old grading, preserves suspended choice and freezes priority queue', () => {
    const before = { ...addReviewCard(null, q, { kind: 'manual', id: q.id }, now), status: 'suspended' as const, step: 3, due_at: now + 1000 };
    const { session, presentations } = fixtureSession([q.id]);
    const attempt = makeAttempt(q, presentations[0]!, session, { kind: 'unknown' }, now);
    expect(scheduleReview(before, q, { ...attempt, ordinal: 2 }, session)).toEqual(before);
    expect(scheduleReview(before, { ...q, grading_revision: 'f'.repeat(64) }, attempt, session)).toEqual(before);
    expect(scheduleReview(before, q, attempt, session)).toMatchObject({ status: 'suspended', step: 3, due_at: before.due_at });
    const refreshed = refreshReviewCard(before, { ...q, grading_revision: 'f'.repeat(64) }, now);
    expect(refreshed.status).toBe('suspended');
    expect(addReviewCard(before, q, { kind: 'manual', id: q.id }, now)).toMatchObject({ status: 'active', step: -1, due_at: now });
    const clean = { ...before, status: 'active' as const, due_at: now, last_outcome: 'correct' as const };
    const bad = { ...clean, question_id: 'Q-A02-01', last_outcome: 'incorrect' as const };
    expect(reviewQueue([clean, bad, before], now, 1)).toEqual(['Q-A02-01']);
  });
  it('retains assisted scheduling after a clock rollback', () => {
    const reading = catalog.question('RQ-01-01');
    const fixture = fixtureSession([reading.id], 'reading_practice', now - 1000);
    fixture.session.reading_help = [{ line_id: 'READ-01-L01', word_id: null, kind: 'reading', opened_at: now }];
    const attempt = makeAttempt(reading, fixture.presentations[0]!, fixture.session, correctAnswer(reading.id), now - 500);
    expect(scheduleReview(null, reading, attempt, fixture.session)).toMatchObject({ last_outcome: 'assisted', due_at: now - 500 + 86400000, assisted_count: 1 });
  });
});
