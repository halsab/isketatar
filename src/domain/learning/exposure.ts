import type { ContentCatalog } from '../content/catalog';
import type { Example, Material, Question, Reading, Vocabulary } from '../content/types';
import { POLICIES } from '../content/types';
import type { Attempt, Exposure, Familiarity, Session } from './types';

type Levels = { reading?: boolean; meaning?: boolean; answer?: boolean; completed?: boolean };
export function recordExposure(exposures: readonly Exposure[], kind: Exposure['kind'], id: string, at: number, levels: Levels = {}): Exposure[] {
  const key = `${kind}:${id}`;
  const previous = exposures.find(exposure => exposure.exposure_key === key);
  const first = (old: number | null | undefined, shown: boolean | undefined) => old ?? (shown ? at : null);
  const exposure: Exposure = {
    exposure_key: key, kind, resource_id: kind === 'material' ? null : id, material_key: kind === 'material' ? id : null,
    exposure_policy: POLICIES.exposure, first_seen_at: Math.min(previous?.first_seen_at ?? at, at), last_seen_at: Math.max(previous?.last_seen_at ?? at, at),
    first_reading_exposed_at: first(previous?.first_reading_exposed_at, levels.reading), first_meaning_exposed_at: first(previous?.first_meaning_exposed_at, levels.meaning),
    first_answer_exposed_at: first(previous?.first_answer_exposed_at, levels.answer), first_completed_at: first(previous?.first_completed_at, kind === 'reading' && levels.completed),
  };
  return [...exposures.filter(item => item.exposure_key !== key), exposure];
}
export function exposeMaterials(exposures: readonly Exposure[], materials: readonly Material[], at: number, levels: Levels = {}): Exposure[] {
  let result = [...exposures];
  for (const material of materials) {
    result = recordExposure(result, 'material', material.visual, at, { meaning: levels.meaning });
    if (material.reading !== null && (levels.reading || material.reading_in_prompt)) result = recordExposure(result, 'material', material.reading, at, { reading: true });
  }
  return result;
}
export function exposeQuestion(exposures: readonly Exposure[], question: Question, at: number): { exposures: Exposure[]; familiarity: Familiarity } {
  const seen = new Map(exposures.filter(exposure => exposure.exposure_policy === POLICIES.exposure).map(exposure => [exposure.exposure_key, exposure]));
  const familiarity = {
    question_seen_before: seen.has(`question:${question.id}`),
    material_seen_before: question.materials.some(material => seen.has(`material:${material.visual}`)),
    reading_exposed_before: question.materials.some(material => material.reading !== null && seen.get(`material:${material.reading}`)?.first_reading_exposed_at != null),
  };
  return { familiarity, exposures: exposeMaterials(recordExposure(exposures, 'question', question.id, at), question.materials, at) };
}
export interface ReleaseFacts { exposures: readonly Exposure[]; attempts: readonly Attempt[] }
export function releasedVocabulary(entry: Vocabulary, facts: ReleaseFacts): boolean {
  if (entry.release === 'with_lesson') return facts.exposures.some(exposure => exposure.kind === 'lesson' && exposure.resource_id === entry.lesson_id);
  return facts.attempts.some(attempt => entry.question_ids.includes(attempt.question_id)) || facts.exposures.some(exposure => exposure.kind === 'question' && entry.question_ids.includes(exposure.resource_id ?? '') && exposure.first_answer_exposed_at !== null);
}
export function releasedExample(example: Example, catalog: ContentCatalog, facts: ReleaseFacts): boolean {
  return example.usage !== 'assessment_source' || [...catalog.vocabulary.values()].some(entry => entry.source_example_id === example.id && releasedVocabulary(entry, facts));
}
export function readingAvailable(reading: Reading, sessions: readonly Session[], assessmentSessionId: string | null = null): boolean {
  if (reading.role !== 'final') return true;
  return sessions.some(session => session.kind === 'final' && (session.status === 'submitted' || session.session_id === assessmentSessionId && session.status === 'active' && session.reading_ids.includes(reading.id)));
}
export function preparedReviewQuestions(entryId: string, catalog: ContentCatalog, facts: ReleaseFacts): string[] {
  const direct = catalog.vocabulary.get(entryId);
  const entries = direct ? [direct] : [...catalog.vocabulary.values()].filter(entry => entry.source_dictionary_ids.includes(entryId));
  return [...new Set(entries.filter(entry => releasedVocabulary(entry, facts)).flatMap(entry => entry.question_ids))].filter(id => {
    const question = catalog.core.questions.find(question => question.id === id);
    return question != null && ['practice', 'transfer', 'reading_practice'].includes(question.assessment_role);
  });
}
