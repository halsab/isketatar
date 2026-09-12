import type { Question } from '../content/types';
import { POLICIES } from '../content/types';
import { gradeAnswer } from './grading';
import type { AnswerValue, Assistance, Attempt, Presentation, Session } from './types';

export const emptyAssistance = (): Assistance => ({ hint_indices: [], first_hint_at: null, rule_opened_at: null, reading_opened_at: null, meaning_opened_at: null, answer_revealed_at: null, reference_opened_at: null });
export function hasAssistance(assistance: Assistance): boolean {
  return assistance.hint_indices.length > 0 || Object.entries(assistance).some(([key, value]) => key !== 'hint_indices' && value !== null);
}
export function assistedBeforeSubmit(question: Question, presentation: Presentation, session: Session): boolean {
  // Снимок перед отправкой уже содержит события помощи; часы устройства не задают их порядок.
  return hasAssistance(presentation.assistance)
    || session.assessment_help_opened_at !== null
    || session.reading_help.some(help => question.line_ids.includes(help.line_id));
}
export function makeAttempt(question: Question, presentation: Presentation, session: Session, answer: AnswerValue, at: number): Attempt {
  const item = session.question_plan.find(item => item.question_id === question.id);
  if (!item || item.grading_revision !== question.grading_revision || presentation.grading_revision !== question.grading_revision || presentation.session_id !== session.session_id || presentation.question_id !== question.id) throw new Error('incompatible_session');
  if (session.policy_versions.grading !== POLICIES.grading || session.policy_versions.normalization !== POLICIES.normalization) throw new Error('incompatible_session');
  const unseenUnknown = presentation.shown_at === null && answer.kind === 'unknown' && ['diagnostic', 'final'].includes(session.kind);
  if (presentation.status !== 'draft' || presentation.shown_at === null && !unseenUnknown || presentation.ordinal === 1 && presentation.presentation_id !== item.first_presentation_id) throw new Error('invalid_presentation');
  const grade = gradeAnswer(question, answer);
  return {
    presentation_id: presentation.presentation_id, session_id: session.session_id, question_id: question.id, grading_revision: question.grading_revision,
    ordinal: presentation.ordinal, release_id: session.release_id, content_version: session.content_version, policy_versions: { ...session.policy_versions },
    answer_raw: structuredClone(answer), ...grade, assistance_before_submit: structuredClone(presentation.assistance), familiarity_at_show: { ...presentation.familiarity_at_show },
    first_submission_in_cycle: presentation.ordinal === 1,
    independent_correct: grade.grade === 'correct' && presentation.ordinal === 1 && !assistedBeforeSubmit(question, presentation, session),
    submitted_at: at, elapsed_ms: presentation.shown_at === null ? null : Math.max(0, at - presentation.shown_at),
  };
}
export function pendingAssessments(sessions: readonly Session[]): Session[] {
  return sessions.filter(session => ['diagnostic', 'final'].includes(session.kind) && ['active', 'paused'].includes(session.status));
}
export function markAssessmentHelp(sessions: readonly Session[], at: number): Session[] {
  const pending = new Set(pendingAssessments(sessions).map(session => session.session_id));
  return sessions.map(session => pending.has(session.session_id) && session.assessment_help_opened_at === null ? { ...session, assessment_help_opened_at: at, revision: session.revision + 1, updated_at: at } : session);
}
