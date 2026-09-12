import { describe, expect, it } from 'vitest';
import cases from '../../../docs/production/learning-cases.json';
import { catalog, correctAnswer, fixtureSession, now } from '../../../tests/learning-fixture';
import type { AnswerValue, Attempt, LearningRecords, SessionStatus } from './types';
import { makeAttempt } from './attempt';
import { lessonProgress, routeProgress, scoreDiagnostic, scoreFinal } from './progress';

interface CycleCase { question_plan: string[]; session_status: SessionStatus; attempts: { question_id: string; ordinal: number; grade: string; independent_correct: boolean }[]; feedback_acknowledged_question_ids: string[] }
function cycle(input: CycleCase, started = now): LearningRecords {
  const { session, presentations } = fixtureSession(input.question_plan, 'lesson_cycle', started);
  const attempts: Attempt[] = input.attempts.map((fragment, index) => {
    const first = presentations.find(item => item.question_id === fragment.question_id)!;
    const presentation = fragment.ordinal === 1 ? first : { ...first, status: 'draft' as const, ordinal: fragment.ordinal, presentation_id: first.presentation_id + '-retry' };
    if (fragment.ordinal > 1) presentations.push(presentation);
    if (fragment.grade === 'correct' && !fragment.independent_correct && fragment.ordinal === 1) presentation.assistance.rule_opened_at = started;
    const attempt = makeAttempt(catalog.question(fragment.question_id), presentation, session, fragment.grade === 'correct' ? correctAnswer(fragment.question_id) : { kind: 'unknown' }, started + index + 1);
    presentation.status = 'submitted';
    if (input.feedback_acknowledged_question_ids.includes(fragment.question_id)) presentation.feedback_acknowledged_at = started + 100;
    return attempt;
  });
  session.status = input.session_status;
  session.submitted_at = input.session_status === 'submitted' ? started + 101 : null;
  return { sessions: [session], presentations, attempts, exposures: [] };
}
describe('lesson and route projections', () => {
  for (const fixture of cases.cases.filter(item => item.kind === 'lesson_mastery')) {
    const input = fixture.input as { lesson_id: string; variants: CycleCase[] };
    const expected = fixture.expected as { variants: object[] };
    it(fixture.id + ' ' + fixture.description, () => input.variants.forEach((variant, index) => {
      expect(lessonProgress(catalog.core, input.lesson_id, cycle(variant))).toMatchObject(expected.variants[index]!);
    }));
  }
  it('retains mastery during a new partial cycle, downgrades a completed failure, preserves history after revision', () => {
    const ids = catalog.lessonPlan('V04').map(item => item.id);
    const input: CycleCase = { question_plan: ids, session_status: 'submitted', attempts: ids.map(question_id => ({ question_id, ordinal: 1, grade: 'correct', independent_correct: true })), feedback_acknowledged_question_ids: ids };
    const original = cycle(input);
    const partial = fixtureSession(ids, 'lesson_cycle', now + 200);
    const combined = { ...original, sessions: [...original.sessions, partial.session], presentations: [...original.presentations, ...partial.presentations] };
    expect(lessonProgress(catalog.core, 'V04', combined).state).toBe('mastered');
    const failed = cycle({ ...input, attempts: input.attempts.map(item => ({ ...item, grade: 'unknown', independent_correct: false })) }, now + 300);
    const records = { sessions: [...original.sessions, ...failed.sessions], presentations: [...original.presentations, ...failed.presentations], attempts: [...original.attempts, ...failed.attempts], exposures: [] };
    expect(lessonProgress(catalog.core, 'V04', records)).toMatchObject({ state: 'practiced', first_mastered_at: now + 101, latest_completed_session_id: failed.sessions[0]!.session_id });
    const revised = structuredClone(catalog.core);
    revised.questions.find(item => item.id === ids[0])!.grading_revision = 'f'.repeat(64);
    expect(lessonProgress(revised, 'V04', records)).toMatchObject({ state: 'in_progress', needs_refresh: true, refresh_question_ids: [ids[0]], first_mastered_at: now + 101 });
  });
  it('does not infer completion without feedback and distinguishes route completion from final passing', () => {
    const ids = catalog.lessonPlan('V04').map(item => item.id);
    const records = cycle({ question_plan: ids, session_status: 'submitted', attempts: ids.map(question_id => ({ question_id, ordinal: 1, grade: 'correct', independent_correct: true })), feedback_acknowledged_question_ids: [] });
    expect(lessonProgress(catalog.core, 'V04', records).state).toBe('in_progress');
    const states = new Map(catalog.core.lessons.map(lesson => [lesson.id, { state: 'practiced' as const }]));
    expect(routeProgress(catalog.core, 'arabic_reader', states, true, false)).toMatchObject({ completed: true, final_completed: true, final_passed: false, practiced_count: 46 });
    expect(routeProgress(catalog.core, 'new_to_script', states, false, false)).toMatchObject({ completed: false, practiced_count: 53 });
  });
});

describe('diagnostic and final rubrics', () => {
  for (const fixture of cases.cases.filter(item => ['diagnostic', 'final_rubric', 'assessment_assistance'].includes(item.kind))) {
    const input = fixture.input as { question_plan: string[]; answers: { question_id: string; answer_raw: AnswerValue }[]; diagnostic_imla_deferred?: boolean; assessment_help_opened_at?: number };
    it(fixture.id + ' ' + fixture.description, () => {
      const kind = fixture.kind === 'diagnostic' ? 'diagnostic' : 'final';
      const { session, presentations } = fixtureSession(input.question_plan, kind);
      session.diagnostic_imla_deferred = input.diagnostic_imla_deferred ?? false;
      session.assessment_help_opened_at = input.assessment_help_opened_at ?? null;
      const attempts = input.answers.map(answer => makeAttempt(catalog.question(answer.question_id), presentations.find(item => item.question_id === answer.question_id)!, session, answer.answer_raw, now + 3000));
      session.status = 'submitted'; session.submitted_at = now + 3000;
      const result = kind === 'diagnostic' ? scoreDiagnostic(catalog, session, attempts) : scoreFinal(catalog.core, session, attempts);
      const { description: _description, review_cards_created: _cards, draft_answers_preserved: _drafts, ...expected } = fixture.expected as Record<string, unknown>;
      expect(result).toMatchObject(expected);
    });
  }
});
