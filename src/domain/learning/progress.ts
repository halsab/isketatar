import type { ContentCatalog } from '../content/catalog';
import { POLICIES } from '../content/types';
import type { CoreData, QuestionRef, RouteId } from '../content/types';
import type { Attempt, LearningRecords, LessonProgress, LessonState, PlanItem, Session } from './types';

function firstAnswers(session: Session, attempts: ReadonlyMap<string, Attempt>): Map<string, Attempt> {
  const result = new Map<string, Attempt>();
  for (const item of session.question_plan) {
    const attempt = attempts.get(item.first_presentation_id);
    if (attempt && attempt.session_id === session.session_id && attempt.question_id === item.question_id && attempt.grading_revision === item.grading_revision && attempt.ordinal === 1) result.set(item.question_id, attempt);
  }
  return result;
}
function samePlan(plan: readonly PlanItem[], expected: readonly QuestionRef[]): boolean {
  return plan.length === expected.length && plan.every((item, index) => item.question_id === expected[index]!.id && item.grading_revision === expected[index]!.grading_revision && item.assessment_role === expected[index]!.assessment_role);
}
function rubric(session: Session, attempts: ReadonlyMap<string, Attempt>) {
  const first = firstAnswers(session, attempts);
  const practice = session.question_plan.filter(item => item.assessment_role === 'practice');
  const transfer = session.question_plan.filter(item => item.assessment_role === 'transfer');
  const correct = (items: PlanItem[]) => items.filter(item => first.get(item.question_id)?.independent_correct).length;
  const score = { practice_count: practice.length, independent_practice_correct: correct(practice), required_practice_correct: Math.ceil(practice.length * 0.8), transfer_count: transfer.length, independent_transfer_correct: correct(transfer) };
  return { ...score, passed: practice.length > 0 && transfer.length > 0 && score.independent_practice_correct >= score.required_practice_correct && score.independent_transfer_correct === transfer.length };
}
const minimum = (values: number[]) => values.length ? Math.min(...values) : null;
export function lessonProgress(core: CoreData, lessonId: string, records: LearningRecords): LessonProgress & { required_practice_correct: number } {
  const required = core.questions.filter(question => question.lesson_id === lessonId).sort((a, b) => Number(a.assessment_role === 'transfer') - Number(b.assessment_role === 'transfer'));
  if (!core.lessons.some(lesson => lesson.id === lessonId) || required.length === 0) throw new Error('unknown_lesson');
  const cycles = records.sessions.filter(session => session.kind === 'lesson_cycle' && session.lesson_id === lessonId);
  const cycleIds = new Set(cycles.map(session => session.session_id));
  const presentations = new Map(records.presentations.map(item => [item.presentation_id, item]));
  const attempts = records.attempts.filter(attempt => cycleIds.has(attempt.session_id));
  const byPresentation = new Map(attempts.map(attempt => [attempt.presentation_id, attempt]));
  const current = attempts.filter(attempt => required.some(question => question.id === attempt.question_id && question.grading_revision === attempt.grading_revision) && attempt.policy_versions.grading === POLICIES.grading && attempt.policy_versions.normalization === POLICIES.normalization);
  const coverage = new Map(required.flatMap(question => {
    const acknowledged = current.filter(attempt => attempt.question_id === question.id).flatMap(attempt => {
      const at = presentations.get(attempt.presentation_id)?.feedback_acknowledged_at;
      return at == null ? [] : [at];
    });
    return acknowledged.length ? [[question.id, Math.min(...acknowledged)] as const] : [];
  }));
  const completed = cycles.filter(session => session.status === 'submitted' && session.policy_versions.mastery === POLICIES.mastery && session.question_plan.every(item => {
    const first = presentations.get(item.first_presentation_id);
    return first?.feedback_acknowledged_at != null && byPresentation.has(first.presentation_id);
  }));
  const currentCompleted = completed.filter(session => samePlan(session.question_plan, required)).sort((a, b) => (b.submitted_at ?? 0) - (a.submitted_at ?? 0) || b.session_id.localeCompare(a.session_id));
  const latest = currentCompleted[0];
  const score = latest ? rubric(latest, byPresentation) : { practice_count: required.filter(question => question.assessment_role === 'practice').length, independent_practice_correct: 0, required_practice_correct: Math.ceil(required.filter(question => question.assessment_role === 'practice').length * .8), transfer_count: required.filter(question => question.assessment_role === 'transfer').length, independent_transfer_correct: 0, passed: false };
  const started = minimum([...cycles.map(session => session.started_at), ...records.exposures.filter(exposure => exposure.kind === 'lesson' && exposure.resource_id === lessonId).map(exposure => exposure.first_seen_at)]);
  const covered = required.filter(question => coverage.has(question.id)).map(question => question.id);
  const practiced = covered.length === required.length;
  const changedCycle = cycles.some(session => !samePlan(session.question_plan, required));
  const refresh = changedCycle ? required.filter(question => !coverage.has(question.id)).map(question => question.id) : [];
  return {
    lesson_id: lessonId, state: practiced ? score.passed ? 'mastered' : 'practiced' : started !== null ? 'in_progress' : 'not_started',
    first_started_at: started, practiced_at: practiced ? Math.max(...coverage.values()) : null,
    first_mastered_at: minimum(completed.filter(session => rubric(session, byPresentation).passed).flatMap(session => session.submitted_at === null ? [] : [session.submitted_at])),
    latest_completed_session_id: latest?.session_id ?? null, required_question_ids: required.map(question => question.id), covered_question_ids: covered,
    current_revision_question_ids: required.filter(question => current.some(attempt => attempt.question_id === question.id)).map(question => question.id),
    practice_count: score.practice_count, independent_practice_correct: score.independent_practice_correct, required_practice_correct: score.required_practice_correct,
    transfer_count: score.transfer_count, independent_transfer_correct: score.independent_transfer_correct, needs_refresh: refresh.length > 0, refresh_question_ids: refresh,
  };
}
export function routeProgress(core: CoreData, route: RouteId, lessons: ReadonlyMap<string, { state: LessonState }>, finalCompleted: boolean, finalPassed: boolean) {
  const required = core.routes[route].filter(id => core.lessons.find(lesson => lesson.id === id)?.required_for_completion);
  const practiced = required.filter(id => ['practiced', 'mastered'].includes(lessons.get(id)?.state ?? 'not_started'));
  return { route, required_lesson_ids: required, practiced_count: practiced.length, mastered_count: required.filter(id => lessons.get(id)?.state === 'mastered').length,
    next_lesson_id: required.find(id => !practiced.includes(id)) ?? null, final_completed: finalCompleted, final_passed: finalPassed,
    completed: practiced.length === required.length && finalCompleted };
}
function assessmentAnswers(core: CoreData, session: Session, attempts: readonly Attempt[], kind: 'diagnostic' | 'final') {
  const ids = kind === 'final' ? core.final_ids : core.diagnostic_ids;
  const refs = ids.map(id => core.questions.find(question => question.id === id)!);
  if (session.kind !== kind || session.policy_versions[kind] !== POLICIES[kind] || session.policy_versions.grading !== POLICIES.grading || session.policy_versions.normalization !== POLICIES.normalization || !samePlan(session.question_plan, refs)) throw new Error('incompatible_session');
  const answers = firstAnswers(session, new Map(attempts.map(attempt => [attempt.presentation_id, attempt])));
  return { answers, completed: session.status === 'submitted' && ids.every(id => answers.has(id)) };
}
export function scoreFinal(core: CoreData, session: Session, attempts: readonly Attempt[]) {
  const { answers, completed } = assessmentAnswers(core, session, attempts, 'final');
  const independent = (id: string) => session.assessment_help_opened_at === null && answers.get(id)?.independent_correct === true;
  const total = core.final_ids.length;
  if (total !== 20) throw new Error('invalid_final_plan');
  const independentCorrect = core.final_ids.filter(independent).length;
  const vowels = ['F-01', 'F-02', 'F-03', 'F-04'].filter(independent).length;
  const morphology = ['F-07', 'F-08', 'F-09', 'F-10'].filter(independent).length;
  const reading = core.final_ids.filter(id => core.questions.find(question => question.id === id)?.source_reading_id !== null).filter(independent).length;
  return { completed, correct: [...answers.values()].filter(answer => answer.grade === 'correct').length, independent_correct: independentCorrect, total,
    vowels_correct: vowels, morphology_correct: morphology, reading_correct: reading,
    passed: completed && independentCorrect >= 16 && vowels >= 3 && morphology >= 3 && reading >= 3 && session.assessment_help_opened_at === null };
}
export function scoreDiagnostic(catalog: ContentCatalog, session: Session, attempts: readonly Attempt[]) {
  const { answers, completed } = assessmentAnswers(catalog.core, session, attempts, 'diagnostic');
  const questions = catalog.core.diagnostic_ids.map(id => catalog.question(id));
  const script = questions.filter(question => question.group === 'script');
  const independent = (id: string) => session.assessment_help_opened_at === null && answers.get(id)?.independent_correct === true;
  const correct = script.filter(question => independent(question.id)).length;
  const critical = ['D-01', 'D-03', 'D-04', 'D-07'].every(independent);
  const imla = session.diagnostic_imla_deferred ? [] : questions.filter(question => question.group === 'imla' && answers.get(question.id)?.answer_raw.kind !== 'unknown' && answers.has(question.id));
  const missed = questions.filter(question => !(session.diagnostic_imla_deferred && question.group === 'imla') && answers.has(question.id) && !independent(question.id));
  const recommended = new Set(missed.flatMap(question => question.recommend_lessons));
  return { completed, script_correct: correct, script_total: script.length, all_critical_correct: critical,
    recommended_route: correct >= 7 && critical ? 'arabic_reader' as const : 'new_to_script' as const,
    imla_score: imla.length ? { correct: imla.filter(question => independent(question.id)).length, total: imla.length } : null,
    recommend_lessons: catalog.core.lessons.filter(lesson => recommended.has(lesson.id)).map(lesson => lesson.id),
    automatically_mastered_lesson_ids: [], deferred_imla_used_for_recommendations: false };
}
