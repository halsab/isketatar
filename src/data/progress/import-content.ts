import { canonical } from '../../domain/content/canonical';
import { lessonAnchors } from '../../domain/content/anchors';
import type { ContentCatalog } from '../../domain/content/catalog';
import { POLICIES } from '../../domain/content/types';
import { hasAssistance, makeAttempt } from '../../domain/learning/attempt';
import { canSubmit, isAnswerValue } from '../../domain/learning/grading';
import { reviewEligible } from '../../domain/learning/review';
import type { Session } from '../../domain/learning/types';
import type { HistoryRecord, Legacy, ProgressData, ProgressExport } from './model';
import { integrity, originalId, requireImport } from './import-integrity';

type Reason = Legacy['reason'];
export function prepareProgress(envelope: ProgressExport, catalog: ContentCatalog, availableReleases: readonly string[], at: number): ProgressData {
  if (catalog.core.questions.some(question => !catalog.questions.has(question.id)) || catalog.core.lessons.some(lesson => !catalog.lessons.has(lesson.id)) || catalog.core.reading_ids.some(id => !catalog.readings.has(id)) || !catalog.references || !catalog.lexicon.size) throw new Error('content_unavailable');
  const data = structuredClone(envelope.data);
  const linked = integrity(data);
  for (const presentation of linked.presentations.values()) {
    const question = catalog.questions.get(presentation.question_id);
    if (question?.grading_revision !== presentation.grading_revision) continue;
    requireImport(presentation.draft_answer === null || isAnswerValue(presentation.draft_answer, question));
    requireImport(presentation.assistance.hint_indices.every(index => index < question.hints_tt.length));
  }
  for (const attempt of linked.attempts.values()) {
    const question = catalog.questions.get(attempt.question_id);
    if (question?.grading_revision === attempt.grading_revision) requireImport(isAnswerValue(attempt.answer_raw, question));
  }
  const legacyIds = new Set(data.legacy.map(item => item.legacy_id));
  function retain(kind: Legacy['origin_kind'], record: HistoryRecord, reason: Reason) {
    const id = originalId(kind, record);
    const legacyId = `${kind}:${id}:${'grading_revision' in record ? record.grading_revision : ''}`;
    requireImport(!legacyIds.has(legacyId)); legacyIds.add(legacyId);
    data.legacy.push({ legacy_id: legacyId, origin_kind: kind, original_id: id, source_content_version: envelope.content_version, reason, record, imported_at: at });
  }
  const lines = new Map([...catalog.readings.values()].flatMap(reading => reading.lines.map(line => [line.id, { reading, line }] as const)));
  const words = new Map([...lines.values()].flatMap(({ reading, line }) => line.words.map(word => [word.word_id, { reading, line, word }] as const)));
  const materials = new Set([...catalog.questions.values()].flatMap(question => question.materials.flatMap(material => [material.visual, material.reading].filter((value): value is string => value !== null))));
  for (const material of [...catalog.examples.values(), ...catalog.lexicon.values(), ...catalog.vocabulary.values(), ...words.values()].flatMap(item => 'word' in item ? item.word.materials : item.materials)) { materials.add(material.visual); if (material.reading !== null) materials.add(material.reading); }
  const referenceIds = new Set(['letters', 'profiles', 'rules', 'terms', ...catalog.rules.keys(), ...catalog.references.letters.map(item => item.id), ...catalog.references.profiles.map(item => item.id), ...catalog.references.terms.map(item => item.id)]);
  function known(kind: string, id: string) {
    if (kind === 'lesson') return catalog.lessons.has(id);
    if (kind === 'reading') return catalog.readings.has(id);
    if (kind === 'question') return catalog.questions.has(id);
    if (kind === 'example') return catalog.examples.has(id);
    if (kind === 'reading_line') return lines.has(id);
    if (kind === 'reading_word') return words.has(id);
    if (kind === 'dictionary' || kind === 'dictionary_entry') return catalog.lexicon.has(id) || catalog.vocabulary.has(id);
    if (kind === 'rule') return catalog.rules.has(id);
    if (kind === 'reference') return referenceIds.has(id);
    if (kind === 'material') return materials.has(id);
    return false;
  }
  function sessionReason(session: Session): Reason | null {
    if (session.policy_versions.grading !== POLICIES.grading || session.policy_versions.normalization !== POLICIES.normalization) return 'unknown_policy_version';
    if (session.lesson_id !== null && !catalog.lessons.has(session.lesson_id) || session.reading_ids.some(id => !catalog.readings.has(id)) || session.question_plan.some(item => !catalog.questions.has(item.question_id))) return 'unknown_content_id';
    if (session.question_plan.some(item => catalog.question(item.question_id).grading_revision !== item.grading_revision)) return 'unknown_grading_revision';
    for (const item of session.question_plan) {
      const question = catalog.question(item.question_id);
      requireImport(item.assessment_role === question.assessment_role && canonical([...item.option_order].sort()) === canonical(question.options.map(option => option.id).sort()));
      if (session.kind === 'lesson_cycle') requireImport(question.lesson_id === session.lesson_id && ['practice', 'transfer'].includes(question.assessment_role));
      if (session.kind === 'review') requireImport(reviewEligible(question));
      if (session.kind === 'reading_practice') requireImport(question.assessment_role === 'reading_practice' && question.source_reading_id === session.reading_ids[0]);
      if (session.kind === 'diagnostic') requireImport(question.assessment_role === 'diagnostic');
      if (session.kind === 'final') requireImport(catalog.core.final_ids.includes(question.id));
    }
    if (session.content_version === catalog.core.content_version) {
      const expected = session.kind === 'lesson_cycle' ? catalog.lessonPlan(session.lesson_id!).map(item => item.id) : session.kind === 'diagnostic' ? catalog.core.diagnostic_ids : session.kind === 'final' ? catalog.core.final_ids : session.kind === 'reading_practice' ? catalog.readings.get(session.reading_ids[0]!)!.question_ids : null;
      if (expected) requireImport(canonical(session.question_plan.map(item => item.question_id)) === canonical(expected));
      else requireImport(session.question_plan.length <= 10);
    }
    for (const help of session.reading_help) {
      const line = lines.get(help.line_id);
      requireImport(line && session.reading_ids.includes(line.reading.id) && (help.word_id === null || line.line.words.some(word => word.word_id === help.word_id)));
    }
    if (session.status === 'incompatible' || ['active', 'paused'].includes(session.status) && (session.content_schema !== 1 || !availableReleases.includes(session.release_id) || Object.entries(POLICIES).some(([key, version]) => Reflect.get(session.policy_versions, key) !== version))) return 'incompatible_draft';
    return null;
  }
  const reasons = new Map(data.sessions.map(session => [session.session_id, sessionReason(session)]));
  data.sessions = data.sessions.filter(session => { const reason = reasons.get(session.session_id); if (reason) { retain('session', session, reason); return false; } if (session.status === 'active') session.status = 'paused'; return true; });
  data.presentations = data.presentations.filter(presentation => {
    const reason = reasons.get(presentation.session_id);
    if (reason) { retain('presentation', presentation, reason); return false; }
    requireImport(reasons.has(presentation.session_id));
    const question = catalog.question(presentation.question_id);
    requireImport(presentation.draft_answer === null || isAnswerValue(presentation.draft_answer, question));
    requireImport(presentation.assistance.hint_indices.every(index => index < question.hints_tt.length));
    return true;
  });
  data.attempts = data.attempts.flatMap(attempt => {
    const reason = reasons.get(attempt.session_id);
    if (reason) { retain('attempt', attempt, reason); return []; }
    requireImport(reasons.has(attempt.session_id));
    const presentation = linked.presentations.get(attempt.presentation_id)!;
    const session = linked.sessions.get(attempt.session_id)!;
    const question = catalog.question(attempt.question_id);
    requireImport(canSubmit(question, attempt.answer_raw) || attempt.answer_raw.kind === 'set' && isAnswerValue(attempt.answer_raw, question));
    // Поздняя помощь retry не относится к старому Attempt: его снимок уже самодостаточен.
    const graded = makeAttempt(question, { ...presentation, status: 'draft', assistance: attempt.assistance_before_submit }, { ...session, reading_help: [] }, attempt.answer_raw, attempt.submitted_at);
    return [{ ...graded, elapsed_ms: attempt.elapsed_ms }];
  });
  const graded = new Map(data.attempts.map(attempt => [attempt.presentation_id, attempt]));
  const evidence = new Map<string, { total: number; unknownRevision: number; independent: number; incorrect: number; unknown: number; assisted: number }>();
  for (const original of linked.attempts.values()) {
    if (original.ordinal !== 1 || !['lesson_cycle', 'review', 'reading_practice'].includes(linked.sessions.get(original.session_id)!.kind)) continue;
    const facts = evidence.get(original.question_id) ?? { total: 0, unknownRevision: 0, independent: 0, incorrect: 0, unknown: 0, assisted: 0 };
    facts.total++;
    const attempt = graded.get(original.presentation_id);
    if (!attempt) facts.unknownRevision++;
    else { facts.independent += Number(attempt.independent_correct); facts.incorrect += Number(attempt.grade === 'incorrect'); facts.unknown += Number(attempt.grade === 'unknown'); facts.assisted += Number(hasAssistance(attempt.assistance_before_submit)); }
    evidence.set(original.question_id, facts);
  }
  data.exposures = data.exposures.filter(exposure => {
    const reason = exposure.exposure_policy !== POLICIES.exposure ? 'unknown_policy_version' : !known(exposure.kind, exposure.resource_id ?? exposure.material_key!) ? 'unknown_content_id' : null;
    if (reason) { retain('exposure', exposure, reason); return false; } return true;
  });
  requireImport(data.review_cards.length <= [...catalog.questions.values()].filter(reviewEligible).length);
  data.review_cards = data.review_cards.filter(card => {
    const question = catalog.questions.get(card.question_id);
    const last = card.last_scheduled_presentation_id === null ? null : linked.attempts.get(card.last_scheduled_presentation_id)!;
    const reason = !question ? 'unknown_content_id' : card.policy_version !== POLICIES.review ? 'unknown_policy_version' : card.grading_revision !== question.grading_revision ? 'unknown_grading_revision' : last ? reasons.get(last.session_id) ?? (graded.has(last.presentation_id) ? null : 'unknown_grading_revision') : null;
    if (reason) { retain('review_card', card, reason); return false; }
    requireImport(question && reviewEligible(question));
    const facts = evidence.get(question.id) ?? { total: 0, unknownRevision: 0, independent: 0, incorrect: 0, unknown: 0, assisted: 0 };
    requireImport(card.attempt_count <= facts.total && card.independent_success_count <= facts.independent + facts.unknownRevision && card.incorrect_count <= facts.incorrect + facts.unknownRevision && card.unknown_count <= facts.unknown + facts.unknownRevision && card.assisted_count <= facts.assisted + facts.unknownRevision);
    requireImport(Math.max(0, card.independent_success_count - facts.independent) + Math.max(0, card.incorrect_count - facts.incorrect) + Math.max(0, card.unknown_count - facts.unknown) <= facts.unknownRevision);
    for (const origin of card.origins) {
      if (origin.kind === 'manual') requireImport(origin.id === question.id);
      else if (origin.kind === 'lesson') requireImport(origin.id === question.lesson_id);
      else if (origin.kind === 'reading') requireImport(origin.id === question.source_reading_id);
      else requireImport(known('dictionary', origin.id) && [...catalog.vocabulary.values()].some(entry => (entry.id === origin.id || entry.source_dictionary_ids.includes(origin.id)) && entry.question_ids.includes(question.id)));
    }
    if (last) {
      const current = graded.get(last.presentation_id);
      requireImport(current && current.ordinal === 1);
      requireImport(current.grade !== 'correct' || card.attempt_count - card.incorrect_count - card.unknown_count >= 1);
      requireImport(current.grade !== 'incorrect' || card.incorrect_count >= 1);
      requireImport(current.grade !== 'unknown' || card.unknown_count >= 1);
      requireImport(!current.independent_correct || card.independent_success_count >= 1);
      requireImport(!hasAssistance(current.assistance_before_submit) || card.assisted_count >= 1);
      card.last_outcome = hasAssistance(current.assistance_before_submit) ? 'assisted' : current.grade;
    }
    return true;
  });
  data.bookmarks = data.bookmarks.filter(bookmark => {
    let reason: Reason | null = known(bookmark.kind, bookmark.target_id) ? null : 'unknown_content_id';
    if (!reason && bookmark.position) {
      const line = lines.get(bookmark.position.line_id);
      if (!line || line.reading.id !== bookmark.target_id) reason = 'unknown_content_id';
      else if (line.line.content_revision !== bookmark.position.line_revision) reason = 'unknown_grading_revision';
      else requireImport(bookmark.position.word_ordinal === null || line.line.words.some(word => word.ordinal === bookmark.position!.word_ordinal));
    }
    if (reason) { retain('bookmark', bookmark, reason); return false; } return true;
  });
  data.resume_positions = data.resume_positions.filter(position => {
    if (!known(position.kind, position.target_id)) { retain('resume_position', position, 'unknown_content_id'); return false; }
    const lesson = catalog.lessons.get(position.target_id); const reading = catalog.readings.get(position.target_id);
    if (position.content_revision === (lesson?.content_revision ?? reading?.content_revision) && position.anchor_id !== null) {
      const anchors = lesson ? lessonAnchors(lesson) : reading!.lines.map(line => line.id);
      requireImport(anchors.includes(position.anchor_id));
    }
    return true;
  });
  if (data.settings.last_location && !known(data.settings.last_location.kind, data.settings.last_location.id)) data.settings.last_location = null;
  requireImport(data.legacy.length <= 100000);
  integrity(data);
  return data;
}
