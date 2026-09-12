import { canonical } from '../../domain/content/canonical';
import { hasAssistance } from '../../domain/learning/attempt';
import type { Attempt, Presentation, Session } from '../../domain/learning/types';
import type { HistoryRecord, Legacy, ProgressData } from './model';

export function requireImport(condition: unknown): asserts condition { if (!condition) throw new Error('invalid_import'); }
export function uniqueMap<T>(items: readonly T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>();
  for (const item of items) { const id = key(item); requireImport(!map.has(id)); map.set(id, item); }
  return map;
}
export function originalId(kind: Legacy['origin_kind'], record: HistoryRecord): string {
  if (kind === 'session' && 'session_id' in record) return record.session_id;
  if ((kind === 'presentation' || kind === 'attempt') && 'presentation_id' in record) return record.presentation_id;
  if (kind === 'exposure' && 'exposure_key' in record) return record.exposure_key;
  if (kind === 'review_card' && 'question_id' in record) return record.question_id;
  if (kind === 'bookmark' && 'bookmark_key' in record) return record.bookmark_key;
  if (kind === 'resume_position' && 'anchor_id' in record) return `${record.kind}:${record.target_id}`;
  throw new Error('invalid_import');
}
export function integrity(data: ProgressData) {
  uniqueMap(data.legacy, item => item.legacy_id);
  for (const item of data.legacy) requireImport(item.original_id === originalId(item.origin_kind, item.record));
  const historySessions = data.legacy.filter(item => item.origin_kind === 'session').map(item => item.record as Session);
  const historyPresentations = data.legacy.filter(item => item.origin_kind === 'presentation').map(item => item.record as Presentation);
  const historyAttempts = data.legacy.filter(item => item.origin_kind === 'attempt').map(item => item.record as Attempt);
  const sessions = uniqueMap([...data.sessions, ...historySessions], session => session.session_id);
  const presentations = uniqueMap([...data.presentations, ...historyPresentations], item => item.presentation_id);
  const attempts = uniqueMap([...data.attempts, ...historyAttempts], item => item.presentation_id);
  const currentSessions = new Set(data.sessions.map(item => item.session_id));
  const currentPresentations = new Set(data.presentations.map(item => item.presentation_id));
  const currentAttempts = new Set(data.attempts.map(item => item.presentation_id));
  for (const session of data.sessions) {
    if (session.active_presentation_id !== null) requireImport(currentPresentations.has(session.active_presentation_id));
    for (const item of session.question_plan) requireImport(currentPresentations.has(item.first_presentation_id));
  }
  for (const presentation of data.presentations) requireImport(currentSessions.has(presentation.session_id) && (presentation.status !== 'submitted' || currentAttempts.has(presentation.presentation_id)));
  for (const attempt of data.attempts) requireImport(currentSessions.has(attempt.session_id) && currentPresentations.has(attempt.presentation_id));
  const ordinals = uniqueMap([...presentations.values()], item => `${item.session_id}:${item.question_id}:${item.ordinal}`);
  uniqueMap(data.exposures, item => item.exposure_key); uniqueMap(data.review_cards, item => item.question_id);
  uniqueMap(data.bookmarks, item => item.bookmark_key); uniqueMap(data.resume_positions, item => `${item.kind}:${item.target_id}`);
  const goals = data.sessions.filter(session => ['active', 'paused'].includes(session.status));
  requireImport(goals.filter(session => session.status === 'active').length <= 1);
  uniqueMap(goals, session => `${session.kind}:${session.lesson_id ?? ''}:${session.kind === 'reading_practice' ? session.reading_ids[0] : ''}`);
  const plans = new Map<string, Map<string, Session['question_plan'][number]>>();
  for (const session of sessions.values()) {
    const plan = uniqueMap(session.question_plan, item => item.question_id); plans.set(session.session_id, plan);
    requireImport((session.kind === 'lesson_cycle') === (session.lesson_id !== null));
    requireImport(!session.diagnostic_imla_deferred || session.kind === 'diagnostic');
    requireImport(['diagnostic', 'final'].includes(session.kind) || session.assessment_help_opened_at === null);
    requireImport(session.kind === 'reading_practice' || session.reading_help.length === 0);
    requireImport(session.kind !== 'reading_practice' || session.reading_ids.length === 1);
    requireImport((session.status === 'submitted') === (session.submitted_at !== null));
    requireImport((session.status === 'abandoned') === (session.abandoned_at !== null));
    requireImport((session.status === 'incompatible') === (session.incompatibility_reason !== null));
    if (session.status === 'submitted') requireImport(session.active_presentation_id === null);
    if (['active', 'paused'].includes(session.status)) requireImport(session.active_presentation_id !== null);
    if (session.active_presentation_id !== null) requireImport(presentations.get(session.active_presentation_id)?.session_id === session.session_id && presentations.get(session.active_presentation_id)?.status !== 'skipped');
    for (const item of plan.values()) {
      const first = presentations.get(item.first_presentation_id);
      requireImport(first?.session_id === session.session_id && first.question_id === item.question_id && first.grading_revision === item.grading_revision && first.ordinal === 1);
      if (session.status === 'submitted') requireImport(attempts.has(item.first_presentation_id) || session.kind === 'review' && first.status === 'skipped');
    }
  }
  for (const presentation of presentations.values()) {
    const session = sessions.get(presentation.session_id); const item = plans.get(presentation.session_id)?.get(presentation.question_id);
    requireImport(session && item && item.grading_revision === presentation.grading_revision);
    if (['diagnostic', 'final'].includes(session.kind)) requireImport(presentation.ordinal === 1);
    const attempt = attempts.get(presentation.presentation_id);
    requireImport((presentation.status === 'submitted') === !!attempt);
    if (presentation.status === 'skipped') requireImport(session.kind === 'review' && presentation.shown_at !== null && presentation.draft_answer === null && presentation.draft_updated_at !== null);
    requireImport(presentation.feedback_acknowledged_at === null || presentation.status === 'submitted' && presentation.feedback_opened_at !== null);
    requireImport(presentation.feedback_opened_at === null || presentation.status === 'submitted');
    const assistance = presentation.assistance;
    requireImport((assistance.hint_indices.length === 0) === (assistance.first_hint_at === null));
    for (const [key, at] of Object.entries(assistance)) if (key !== 'hint_indices' && at !== null) requireImport(presentation.shown_at !== null && typeof at === 'number' && at >= presentation.shown_at);
    if (presentation.shown_at === null) requireImport(!hasAssistance(assistance) && !Object.values(presentation.familiarity_at_show).some(Boolean));
    if (presentation.ordinal > 1) {
      const previous = ordinals.get(`${presentation.session_id}:${presentation.question_id}:${presentation.ordinal - 1}`);
      requireImport(previous?.status === 'submitted');
      if (currentPresentations.has(presentation.presentation_id)) requireImport(currentPresentations.has(previous.presentation_id));
    }
  }
  for (const attempt of attempts.values()) {
    const presentation = presentations.get(attempt.presentation_id); const session = sessions.get(attempt.session_id);
    requireImport(presentation && session && presentation.session_id === attempt.session_id && presentation.question_id === attempt.question_id && presentation.grading_revision === attempt.grading_revision && presentation.ordinal === attempt.ordinal);
    requireImport(attempt.release_id === session.release_id && attempt.content_version === session.content_version && canonical(attempt.policy_versions) === canonical(session.policy_versions));
    requireImport(canonical(attempt.answer_raw) === canonical(presentation.draft_answer) && canonical(attempt.assistance_before_submit) === canonical(presentation.assistance) && canonical(attempt.familiarity_at_show) === canonical(presentation.familiarity_at_show));
    requireImport(presentation.shown_at !== null || ['diagnostic', 'final'].includes(session.kind) && attempt.answer_raw.kind === 'unknown' && attempt.elapsed_ms === null);
  }
  for (const exposure of data.exposures) {
    requireImport(exposure.first_seen_at <= exposure.last_seen_at);
    requireImport(exposure.exposure_key === `${exposure.kind}:${exposure.kind === 'material' ? exposure.material_key : exposure.resource_id}`);
    requireImport(exposure.kind === 'material' ? exposure.resource_id === null && exposure.material_key !== null : exposure.material_key === null && exposure.resource_id !== null);
    requireImport(exposure.kind === 'reading' || exposure.first_completed_at === null);
  }
  for (const bookmark of data.bookmarks) requireImport(bookmark.bookmark_key === `${bookmark.kind}:${bookmark.target_id}` && (bookmark.position === null || bookmark.kind === 'reading'));
  for (const card of data.review_cards) {
    requireImport(card.independent_success_count <= card.attempt_count && card.incorrect_count <= card.attempt_count && card.unknown_count <= card.attempt_count && card.assisted_count <= card.attempt_count);
    requireImport(card.independent_success_count + card.incorrect_count + card.unknown_count <= card.attempt_count);
    requireImport(card.independent_success_count + card.assisted_count <= card.attempt_count);
    if (card.last_scheduled_presentation_id !== null) {
      const attempt = attempts.get(card.last_scheduled_presentation_id);
      requireImport(attempt?.question_id === card.question_id && attempt.ordinal === 1 && card.attempt_count >= 1);
    } else requireImport(card.attempt_count === 0 && card.last_outcome === null);
  }
  return { sessions, presentations, attempts, plans };
}
