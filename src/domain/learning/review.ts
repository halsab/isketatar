import { POLICIES } from '../content/types';
import type { Question } from '../content/types';
import { hasAssistance } from './attempt';
import type { Attempt, ReviewCard, ReviewOrigin, Session } from './types';

export const DAY_MS = 86_400_000;
export const REVIEW_INTERVALS = [1, 3, 7, 14, 30] as const;
export const reviewEligible = (question: Question) => question.origin === 'course' || question.origin === 'reading' && question.assessment_role === 'reading_practice';
export function addReviewCard(previous: ReviewCard | null, question: Question, origin: ReviewOrigin, at: number): ReviewCard {
  if (!reviewEligible(question)) throw new Error('review_ineligible');
  if (previous && previous.question_id !== question.id) throw new Error('wrong_review_card');
  if (previous) {
    const current = refreshReviewCard(previous, question, at);
    const origins = current.origins.some(item => item.kind === origin.kind && item.id === origin.id) ? current.origins : [...current.origins, origin];
    if (origins === current.origins && current.status === 'active') return current;
    return { ...current, origins, revision: current.revision + 1, updated_at: at, ...(current.status === 'suspended' ? { status: 'active', step: -1, due_at: at } : {}) };
  }
  return {
    question_id: question.id, grading_revision: question.grading_revision, revision: 0, status: 'active', origins: [{ ...origin }], step: -1, due_at: at,
    created_at: at, updated_at: at, last_scheduled_presentation_id: null, last_outcome: null,
    attempt_count: 0, independent_success_count: 0, incorrect_count: 0, unknown_count: 0, assisted_count: 0, policy_version: POLICIES.review,
  };
}
export function refreshReviewCard(card: ReviewCard, question: Question, at: number): ReviewCard {
  if (card.grading_revision === question.grading_revision && card.policy_version === POLICIES.review) return card;
  return { ...card, grading_revision: question.grading_revision, policy_version: POLICIES.review, revision: card.revision + 1, updated_at: at,
    ...(card.status === 'active' ? { step: -1, due_at: at } : {}) };
}
export function scheduleReview(previous: ReviewCard | null, question: Question, attempt: Attempt, session: Session): ReviewCard | null {
  // Session — снимок той же отправки, а не поздней истории с дополнительно открытой помощью.
  if (attempt.question_id !== question.id || attempt.session_id !== session.session_id || previous && previous.question_id !== question.id) throw new Error('wrong_review_card');
  if (!reviewEligible(question) || !['lesson_cycle', 'review', 'reading_practice'].includes(session.kind) || attempt.ordinal !== 1 || !attempt.first_submission_in_cycle || attempt.grading_revision !== question.grading_revision || attempt.policy_versions.review !== POLICIES.review) return previous;
  if (previous && (previous.grading_revision !== question.grading_revision || previous.last_scheduled_presentation_id === attempt.presentation_id)) return previous;
  const assisted = hasAssistance(attempt.assistance_before_submit) || session.reading_help.some(help => question.line_ids.includes(help.line_id));
  const independent = attempt.grade === 'correct' && attempt.independent_correct && !assisted;
  if (!previous && independent) return null;
  const at = attempt.submitted_at;
  const origin: ReviewOrigin = question.origin === 'reading' ? { kind: 'reading', id: question.source_reading_id! } : { kind: 'lesson', id: question.lesson_id! };
  const card = previous ?? addReviewCard(null, question, origin, at);
  const step = independent ? Math.min(4, card.step + 1) : 0;
  const schedule = card.status === 'active' && (!independent || card.due_at <= at) ? { step, due_at: at + REVIEW_INTERVALS[step]! * DAY_MS } : {};
  return {
    ...card, ...schedule, revision: card.revision + 1, updated_at: at,
    origins: card.origins.some(item => item.kind === origin.kind && item.id === origin.id) ? card.origins : [...card.origins, origin],
    last_scheduled_presentation_id: attempt.presentation_id, last_outcome: assisted ? 'assisted' : attempt.grade,
    attempt_count: card.attempt_count + 1, independent_success_count: card.independent_success_count + Number(independent),
    incorrect_count: card.incorrect_count + Number(attempt.grade === 'incorrect'), unknown_count: card.unknown_count + Number(attempt.grade === 'unknown'), assisted_count: card.assisted_count + Number(assisted),
  };
}
export function reviewQueue(cards: readonly ReviewCard[], at: number, batchSize = 10): string[] {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 10) throw new Error('invalid_review_batch');
  const priority = (card: ReviewCard) => Number(!['incorrect', 'unknown', 'assisted'].includes(card.last_outcome ?? ''));
  return cards.filter(card => card.status === 'active' && card.due_at <= at).sort((a, b) => priority(a) - priority(b) || a.due_at - b.due_at || (a.question_id < b.question_id ? -1 : a.question_id > b.question_id ? 1 : 0)).slice(0, batchSize).map(card => card.question_id);
}
