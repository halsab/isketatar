import { canonical } from '../../domain/content/canonical';
import type { ContentCatalog } from '../../domain/content/catalog';
import { POLICIES } from '../../domain/content/types';
import type { CoreData, Question } from '../../domain/content/types';
import { emptyAssistance, makeAttempt, markAssessmentHelp, pendingAssessments } from '../../domain/learning/attempt';
import { canSubmit, isAnswerValue } from '../../domain/learning/grading';
import { exposeMaterials, exposeQuestion, recordExposure } from '../../domain/learning/exposure';
import { addReviewCard, reviewEligible, reviewQueue, scheduleReview } from '../../domain/learning/review';
import type { AnswerValue, Attempt, Exposure, Presentation, Session } from '../../domain/learning/types';
import type { Command } from './commands';
import type { WriteContext } from './transaction';
import type { Expected } from './model';

export type CommandResult = { session_id?: string; presentation_id?: string; attempt?: Attempt; expected?: Expected };
export class CommandEngine {
  constructor(readonly context: WriteContext, readonly catalog: ContentCatalog, readonly currentCore: CoreData, readonly releaseId: string, readonly at: number, readonly uuid: () => string) {}
  get tx() { return this.context.tx; }
  async session(id: string, check = true): Promise<Session> {
    const session = await this.tx.get('sessions', id);
    if (!session) throw new Error('unknown_session');
    if (check) this.context.check('sessions', id, session);
    if (session.data_generation !== this.context.control.data_generation) throw new Error('write_conflict');
    if (session.release_id !== this.releaseId || session.content_schema !== 1 || !Object.entries(POLICIES).every(([key, version]) => Reflect.get(session.policy_versions, key) === version)) throw new Error('incompatible_session');
    for (const item of session.question_plan) if (this.catalog.core.questions.find(question => question.id === item.question_id)?.grading_revision !== item.grading_revision) throw new Error('incompatible_session');
    return session;
  }
  async presentation(id: string, check = true) {
    const presentation = await this.tx.get('presentations', id);
    if (!presentation) throw new Error('unknown_presentation');
    if (check) this.context.check('presentations', id, presentation);
    const session = await this.session(presentation.session_id, check);
    const question = this.catalog.question(presentation.question_id);
    return { presentation, session, question };
  }
  private newPresentation(sessionId: string, question: Question, ordinal = 1): Presentation {
    return { presentation_id: this.uuid(), session_id: sessionId, question_id: question.id, grading_revision: question.grading_revision, ordinal, revision: 0,
      status: 'draft', created_at: this.at, shown_at: null, draft_answer: null, draft_updated_at: null, assistance: emptyAssistance(),
      familiarity_at_show: { question_seen_before: false, material_seen_before: false, reading_exposed_before: false }, feedback_opened_at: null, feedback_acknowledged_at: null };
  }
  private async settings() {
    const record = await this.tx.get('meta', 'settings');
    if (!record || record.key !== 'settings') throw new Error('storage_corrupt');
    return record.value;
  }
  async exposures(keys: readonly string[]): Promise<Exposure[]> {
    const records = await Promise.all([...new Set(keys)].map(key => this.tx.get('exposures', key)));
    return records.filter((record): record is Exposure => record !== undefined);
  }
  async putExposures(exposures: readonly Exposure[]) { for (const exposure of exposures) await this.context.put('exposures', exposure); }
  async exposeResource(kind: Exposure['kind'], id: string, levels: { reading?: boolean; meaning?: boolean; answer?: boolean; completed?: boolean } = {}) {
    await this.putExposures(recordExposure(await this.exposures([`${kind}:${id}`]), kind, id, this.at, levels));
  }
  async confirmDisclosure(confirmed: boolean) {
    const pending = await this.tx.unfinishedSessions();
    if (pendingAssessments(pending).some(session => session.assessment_help_opened_at === null) && !confirmed) throw new Error('assessment_help_confirmation_required');
    for (const session of markAssessmentHelp(pending, this.at)) await this.context.put('sessions', session);
  }
  async start(command: Extract<Command, { type: 'start' }>): Promise<CommandResult> {
    let ids: string[];
    if (command.kind === 'lesson_cycle') {
      if (!command.lesson_id || !this.catalog.core.lessons.some(lesson => lesson.id === command.lesson_id)) throw new Error('unknown_lesson');
      ids = this.catalog.lessonPlan(command.lesson_id).map(question => question.id);
    } else if (command.kind === 'diagnostic') ids = this.catalog.core.diagnostic_ids;
    else if (command.kind === 'final') ids = this.catalog.core.final_ids;
    else if (command.kind === 'reading_practice') {
      const reading = this.catalog.readings.get(command.reading_id ?? '');
      if (!reading || reading.role === 'final') throw new Error('reading_unavailable');
      ids = reading.question_ids;
    } else {
      const cards = await this.tx.all('review_cards');
      ids = command.early_question_ids ?? reviewQueue(cards, this.at, (await this.settings()).review_batch_size);
      if (command.early_question_ids && ids.some(id => !cards.some(card => card.question_id === id && card.status === 'active'))) throw new Error('review_ineligible');
      if (ids.length > 10) throw new Error('invalid_review_batch');
    }
    if (!ids.length || new Set(ids).size !== ids.length) throw new Error('empty_plan');
    if (command.kind === 'final' && ids.length !== 20 || command.kind === 'diagnostic' && ids.length !== 18) throw new Error('invalid_assessment_plan');
    const questions = ids.map(id => this.catalog.question(id));
    if (command.kind === 'review' && questions.some(question => !reviewEligible(question))) throw new Error('review_ineligible');
    const unfinished = await this.tx.unfinishedSessions();
    const sameGoal = unfinished.find(session => session.kind === command.kind && (command.kind !== 'lesson_cycle' || session.lesson_id === command.lesson_id) && (command.kind !== 'reading_practice' || session.reading_ids[0] === command.reading_id));
    if (sameGoal && !command.restart) throw new Error('resume_required');
    for (const previous of unfinished.filter(session => session.status === 'active' || session.session_id === sameGoal?.session_id)) {
      this.context.check('sessions', previous.session_id, previous);
      const abandoned = previous.session_id === sameGoal?.session_id;
      await this.context.put('sessions', { ...previous, status: abandoned ? 'abandoned' : 'paused', abandoned_at: abandoned ? this.at : null, updated_at: this.at, revision: previous.revision + 1 });
    }
    const sessionId = this.uuid();
    const presentations = questions.map(question => this.newPresentation(sessionId, question));
    const session: Session = {
      session_id: sessionId, kind: command.kind, status: 'active', revision: 0, data_generation: this.context.control.data_generation,
      release_id: this.releaseId, content_version: this.catalog.core.content_version, content_schema: 1, policy_versions: { ...POLICIES },
      lesson_id: command.kind === 'lesson_cycle' ? command.lesson_id! : null, reading_ids: [...new Set(questions.flatMap(question => question.source_reading_id ? [question.source_reading_id] : []))],
      diagnostic_imla_deferred: false, assessment_help_opened_at: null, reading_help: [], route_at_start: (await this.settings()).selected_route,
      question_plan: questions.map((question, index) => ({ question_id: question.id, grading_revision: question.grading_revision, first_presentation_id: presentations[index]!.presentation_id, option_order: question.options.map(option => option.id), assessment_role: question.assessment_role })),
      active_presentation_id: presentations[0]!.presentation_id, started_at: this.at, updated_at: this.at, submitted_at: null, abandoned_at: null, incompatibility_reason: null,
    };
    if (await this.tx.get('sessions', sessionId)) throw new Error('duplicate_local_id');
    await this.context.put('sessions', session);
    for (const presentation of presentations) {
      if (await this.tx.get('presentations', presentation.presentation_id)) throw new Error('duplicate_local_id');
      await this.context.put('presentations', presentation);
    }
    this.context.control.active_session_id = sessionId;
    return { session_id: sessionId, presentation_id: session.active_presentation_id! };
  }
  async pauseResume(id: string, resume: boolean): Promise<CommandResult> {
    const session = await this.session(id);
    if (!['active', 'paused'].includes(session.status)) throw new Error('invalid_session_state');
    if (resume) for (const active of (await this.tx.unfinishedSessions()).filter(item => item.status === 'active' && item.session_id !== id)) {
      await this.context.put('sessions', { ...active, status: 'paused', revision: active.revision + 1, updated_at: this.at });
    }
    if (session.status !== (resume ? 'active' : 'paused')) await this.context.put('sessions', { ...session, status: resume ? 'active' : 'paused', revision: session.revision + 1, updated_at: this.at });
    this.context.control.active_session_id = resume ? id : this.context.control.active_session_id === id ? null : this.context.control.active_session_id;
    return { session_id: id, presentation_id: session.active_presentation_id ?? undefined };
  }
  async show(id: string, confirmation = false) {
    const { presentation, session, question } = await this.presentation(id);
    if (session.status !== 'active' || session.active_presentation_id !== id) throw new Error('invalid_session_state');
    if (!['diagnostic', 'final'].includes(session.kind)) await this.confirmDisclosure(confirmation);
    if (presentation.shown_at !== null) return {};
    const keys = [`question:${question.id}`, ...question.materials.flatMap(material => [`material:${material.visual}`, ...(material.reading === null ? [] : [`material:${material.reading}`])])];
    const shown = exposeQuestion(await this.exposures(keys), question, this.at);
    await this.context.put('presentations', { ...presentation, shown_at: this.at, familiarity_at_show: shown.familiarity, revision: presentation.revision + 1 });
    await this.putExposures(shown.exposures);
    return {};
  }
  async draft(id: string, answer: AnswerValue | null) {
    const { presentation, session, question } = await this.presentation(id);
    if (session.status !== 'active' || session.active_presentation_id !== id || presentation.status !== 'draft' || presentation.shown_at === null) throw new Error('invalid_session_state');
    if (answer !== null && !isAnswerValue(answer, question)) throw new Error('invalid_answer');
    if (canonical(presentation.draft_answer) !== canonical(answer)) await this.context.put('presentations', { ...presentation, draft_answer: structuredClone(answer), draft_updated_at: this.at, revision: presentation.revision + 1 });
    return {};
  }
  async submit(id: string, answer: AnswerValue, assessment = false, confirmation = false): Promise<CommandResult> {
    const existing = await this.tx.get('attempts', id);
    if (existing) {
      if (canonical(existing.answer_raw) !== canonical(answer)) throw new Error('write_conflict');
      const session = await this.session(existing.session_id, false);
      if (['diagnostic', 'final'].includes(session.kind) !== assessment) throw new Error('assessment_bulk_required');
      if (!assessment) await this.confirmDisclosure(confirmation);
      return { attempt: existing, session_id: existing.session_id, presentation_id: id };
    }
    const { presentation, session, question } = await this.presentation(id);
    if (session.status !== 'active' || !assessment && session.active_presentation_id !== id || presentation.status !== 'draft') throw new Error('invalid_session_state');
    if (['diagnostic', 'final'].includes(session.kind) !== assessment) throw new Error('assessment_bulk_required');
    if (!canSubmit(question, answer)) throw new Error('invalid_answer');
    if (!assessment) await this.confirmDisclosure(confirmation);
    const attempt = makeAttempt(question, presentation, session, answer, this.at);
    await this.context.put('attempts', attempt);
    await this.context.put('presentations', { ...presentation, status: 'submitted', draft_answer: structuredClone(answer), draft_updated_at: this.at, feedback_opened_at: assessment ? null : this.at, revision: presentation.revision + 1 });
    await this.context.put('sessions', { ...session, revision: session.revision + 1, updated_at: this.at });
    if (!assessment) {
      await this.exposeResource('question', question.id, { answer: true });
      if (question.type === 'reading') {
        const keys = question.materials.flatMap(material => [`material:${material.visual}`, ...(material.reading === null ? [] : [`material:${material.reading}`])]);
        await this.putExposures(exposeMaterials(await this.exposures(keys), question.materials, this.at, { reading: true }));
      }
    }
    if (!assessment && this.currentCore.questions.find(item => item.id === question.id)?.grading_revision === question.grading_revision) {
      const previous = await this.tx.get('review_cards', question.id);
      const card = scheduleReview(previous ?? null, question, attempt, session);
      if (card) await this.context.put('review_cards', card);
    }
    return { attempt, session_id: session.session_id, presentation_id: id };
  }
  async finishAssessment(command: Extract<Command, { type: 'finish_assessment' }>) {
    const session = await this.session(command.session_id, false);
    if (session.status === 'submitted' && ['diagnostic', 'final'].includes(session.kind)) {
      if (session.diagnostic_imla_deferred !== command.defer_imla) throw new Error('write_conflict');
      return { session_id: session.session_id };
    }
    this.context.check('sessions', session.session_id, session);
    if (session.status !== 'active' || !['diagnostic', 'final'].includes(session.kind)) throw new Error('invalid_session_state');
    const presentations = await this.tx.bySession('presentations', session.session_id);
    const first = session.question_plan.map(item => presentations.find(presentation => presentation.presentation_id === item.first_presentation_id)!);
    if (first.some(presentation => !presentation)) throw new Error('storage_corrupt');
    if (first.some(presentation => presentation.draft_answer === null) && !command.confirm_incomplete) throw new Error('incomplete_confirmation_required');
    if (command.defer_imla && session.kind !== 'diagnostic') throw new Error('invalid_session_state');
    await this.context.put('sessions', { ...session, diagnostic_imla_deferred: command.defer_imla, revision: session.revision + 1 });
    for (const presentation of first) await this.submit(presentation.presentation_id, command.defer_imla && this.catalog.question(presentation.question_id).group === 'imla' ? { kind: 'unknown' } : presentation.draft_answer ?? { kind: 'unknown' }, true);
    const updated = await this.session(session.session_id);
    await this.context.put('sessions', { ...updated, status: 'submitted', submitted_at: this.at, active_presentation_id: null, revision: updated.revision + 1, updated_at: this.at });
    this.context.control.active_session_id = null;
    return { session_id: session.session_id };
  }
  async ack(id: string, retry: boolean): Promise<CommandResult> {
    const previous = await this.tx.get('presentations', id);
    if (!retry && previous?.feedback_acknowledged_at !== null && previous?.feedback_acknowledged_at !== undefined) {
      const owner = await this.session(previous.session_id, false);
      if (owner.status !== 'active' || owner.active_presentation_id !== id) return { session_id: owner.session_id, presentation_id: owner.active_presentation_id ?? undefined };
    }
    const { presentation, session, question } = await this.presentation(id);
    if (session.status !== 'active' || session.active_presentation_id !== id || presentation.status !== 'submitted' || ['diagnostic', 'final'].includes(session.kind)) throw new Error('invalid_session_state');
    if (presentation.feedback_acknowledged_at === null) await this.context.put('presentations', { ...presentation, feedback_acknowledged_at: this.at, revision: presentation.revision + 1 });
    const all = await this.tx.bySession('presentations', session.session_id);
    if (retry) {
      const next = this.newPresentation(session.session_id, question, Math.max(...all.filter(item => item.question_id === question.id).map(item => item.ordinal)) + 1);
      await this.context.put('presentations', next);
      await this.context.put('sessions', { ...session, active_presentation_id: next.presentation_id, revision: session.revision + 1, updated_at: this.at });
      return { presentation_id: next.presentation_id, session_id: session.session_id };
    }
    const next = session.question_plan.find(item => !all.some(presentation => presentation.question_id === item.question_id && presentation.status === 'submitted' && presentation.feedback_acknowledged_at !== null));
    await this.context.put('sessions', { ...session, active_presentation_id: next?.first_presentation_id ?? null, status: next ? 'active' : 'submitted', submitted_at: next ? null : this.at, revision: session.revision + 1, updated_at: this.at });
    if (!next) this.context.control.active_session_id = null;
    return { session_id: session.session_id, presentation_id: next?.first_presentation_id };
  }
  async navigate(sessionId: string, questionId: string) {
    const session = await this.session(sessionId);
    if (session.status !== 'active') throw new Error('invalid_session_state');
    const item = session.question_plan.find(item => item.question_id === questionId);
    if (!item) throw new Error('unknown_question');
    const presentations = await this.tx.bySession('presentations', sessionId);
    const target = presentations.filter(presentation => presentation.question_id === questionId).sort((a, b) => b.ordinal - a.ordinal)[0]!;
    if (!['diagnostic', 'final'].includes(session.kind) && target.shown_at === null && target.presentation_id !== session.active_presentation_id) throw new Error('question_not_reached');
    await this.context.put('sessions', { ...session, active_presentation_id: target.presentation_id, revision: session.revision + 1, updated_at: this.at });
    return { presentation_id: target.presentation_id, session_id: sessionId };
  }
  async help(command: Extract<Command, { type: 'help' }>) {
    const { presentation, session, question } = await this.presentation(command.presentation_id, false);
    if (['diagnostic', 'final'].includes(session.kind) && session.status !== 'submitted') throw new Error('assessment_help_disabled');
    if (presentation.status === 'draft' && presentation.shown_at === null) throw new Error('invalid_presentation');
    if (command.kind === 'hint' && (!Number.isInteger(command.hint_index) || command.hint_index! < 0 || command.hint_index! >= question.hints_tt.length)) throw new Error('invalid_hint');
    if (presentation.status === 'draft') {
      this.context.check('presentations', presentation.presentation_id, presentation);
      this.context.check('sessions', session.session_id, session);
    }
    await this.confirmDisclosure(command.confirm_assessment_help ?? false);
    if (presentation.status === 'draft') {
      // Перевод часов назад не должен создавать помощь до фактического показа.
      const helpedAt = Math.max(this.at, presentation.shown_at!);
      const assistance = structuredClone(presentation.assistance);
      if (command.kind === 'hint') {
        if (!assistance.hint_indices.includes(command.hint_index!)) assistance.hint_indices.push(command.hint_index!);
        assistance.first_hint_at ??= helpedAt;
      } else {
        const field = command.kind === 'reveal' ? 'answer_revealed_at' : `${command.kind}_opened_at` as const;
        assistance[field] ??= helpedAt;
      }
      if (canonical(assistance) !== canonical(presentation.assistance)) await this.context.put('presentations', { ...presentation, assistance, revision: presentation.revision + 1 });
      if (command.kind === 'reveal') return this.submit(presentation.presentation_id, { kind: 'unknown' }, false, command.confirm_assessment_help);
    } else if (presentation.feedback_opened_at === null) {
      await this.context.put('presentations', { ...presentation, feedback_opened_at: this.at, revision: presentation.revision + 1 });
    }
    if (command.kind === 'reveal') await this.exposeResource('question', question.id, { answer: true });
    const keys = question.materials.flatMap(material => [`material:${material.visual}`, ...(material.reading === null ? [] : [`material:${material.reading}`])]);
    await this.putExposures(exposeMaterials(await this.exposures(keys), question.materials, this.at, { reading: ['reading', 'reveal'].includes(command.kind), meaning: command.kind === 'meaning' }));
    return {};
  }
  async reviewAdd(command: Extract<Command, { type: 'review_add' }>) {
    const question = this.catalog.question(command.question_id);
    const previous = await this.tx.get('review_cards', question.id);
    await this.context.put('review_cards', addReviewCard(previous ?? null, question, command.origin, this.at));
    return {};
  }
}
