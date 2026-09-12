import { getTestCatalog } from './content-fixture';
import { POLICIES } from '../src/domain/content/types';
import type { AnswerValue, Assistance, Presentation, Session, SessionKind } from '../src/domain/learning/types';

export const catalog = getTestCatalog();
export const now = 1789203600000;
export const noHelp = (): Assistance => ({ hint_indices: [], first_hint_at: null, rule_opened_at: null, reading_opened_at: null, meaning_opened_at: null, answer_revealed_at: null, reference_opened_at: null });
let sequence = 0;
export function fixtureSession(ids: string[], kind: SessionKind = 'lesson_cycle', started = now): { session: Session; presentations: Presentation[] } {
  const sessionId = `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
  const questions = ids.map(id => catalog.question(id));
  const presentations: Presentation[] = questions.map(question => ({
    presentation_id: `20000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    session_id: sessionId, question_id: question.id, grading_revision: question.grading_revision, ordinal: 1, revision: 0,
    status: 'draft', created_at: started, shown_at: started, draft_answer: null, draft_updated_at: null, assistance: noHelp(),
    familiarity_at_show: { question_seen_before: false, material_seen_before: false, reading_exposed_before: false },
    feedback_opened_at: null, feedback_acknowledged_at: null,
  }));
  const session: Session = {
    session_id: sessionId, kind, status: 'active', revision: 0, data_generation: '30000000-0000-4000-8000-000000000001', release_id: 'fixture',
    content_version: catalog.core.content_version, content_schema: 1, policy_versions: POLICIES, lesson_id: kind === 'lesson_cycle' ? questions[0]!.lesson_id : null,
    reading_ids: [...new Set(questions.flatMap(question => question.source_reading_id ? [question.source_reading_id] : []))],
    diagnostic_imla_deferred: false, assessment_help_opened_at: null, reading_help: [], route_at_start: 'arabic_reader',
    question_plan: questions.map((question, index) => ({ question_id: question.id, grading_revision: question.grading_revision, first_presentation_id: presentations[index]!.presentation_id, option_order: question.options.map(option => option.id), assessment_role: question.assessment_role })),
    active_presentation_id: presentations[0]!.presentation_id, started_at: started, updated_at: started, submitted_at: null, abandoned_at: null, incompatibility_reason: null,
  };
  return { session, presentations };
}
export function correctAnswer(id: string): AnswerValue {
  const question = catalog.question(id);
  if (question.type === 'choice') return { kind: 'option', option_id: question.accepted_answers[0]! };
  if (question.type === 'select_many') return { kind: 'set', option_ids: question.accepted_answers };
  return { kind: question.type === 'segment' ? 'segments' : 'text', text: question.accepted_answers[0]! };
}
