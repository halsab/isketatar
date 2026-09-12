import { normalizeReading } from './canonical.ts';
import { POLICIES } from './types.ts';
import type { AssessmentData, CoreData, DictionaryData, ModuleData, Question, ReadingData, References } from './types.ts';

const unique = (values: readonly string[]) => new Set(values).size === values.length;
const uniqueIds = (values: readonly { id: string }[]) => unique(values.map(value => value.id));
const validSpan = (span: readonly number[]) => span.length === 2 && Number.isSafeInteger(span[0]) && Number.isSafeInteger(span[1]) && span[0]! >= 1 && span[1]! >= span[0]!;

export function graphemeBoundaries(text: string): Set<number> {
  const boundaries = new Set([0, text.length]);
  for (const segment of new Intl.Segmenter('tt', { granularity: 'grapheme' }).segment(text)) boundaries.add(segment.index);
  return boundaries;
}

export function validQuestion(question: Question): boolean {
  if (!Number.isInteger(question.difficulty) || question.difficulty < 1 || question.difficulty > 3 || !validSpan(question.source_lines)) return false;
  if (!uniqueIds(question.options) || !unique(question.options.map(option => option.text_tt)) || question.accepted_answers.length === 0) return false;
  const options = new Set(question.options.map(option => option.id));
  if (question.grading === 'exact_option' || question.grading === 'set') {
    if (!question.accepted_answers.every(key => options.has(key)) || !unique(question.accepted_answers)) return false;
    if (question.grading === 'exact_option' && question.accepted_answers.length !== 1) return false;
  } else {
    if (question.options.length > 0 || !question.accepted_answers.every(key => key.length <= 4096 && !/\p{Cc}/u.test(key) && normalizeReading(key).length > 0)) return false;
    if (question.grading === 'segments' && !question.accepted_answers.every(key => key.split('+').every(part => normalizeReading(part).length > 0))) return false;
  }
  if (question.origin === 'course' && (!question.lesson_id || question.source_reading_id !== null || !['practice', 'transfer'].includes(question.assessment_role))) return false;
  if (question.origin === 'reading' && (question.lesson_id !== null || !question.source_reading_id || !['reading_practice', 'final'].includes(question.assessment_role))) return false;
  if (['diagnostic', 'final'].includes(question.origin) && (question.assessment_role !== question.origin || question.lesson_id !== null || question.source_reading_id !== null)) return false;
  return unique(question.line_ids) && unique(question.rule_ids) && unique(question.source_example_ids);
}

export function validCore(core: CoreData): boolean {
  if (core.content_schema !== 1 || !Object.entries(POLICIES).every(([key, value]) => Reflect.get(core.policy_versions, key) === value)) return false;
  if (![core.lessons, core.questions, core.modules, core.source_sections].every(uniqueIds)) return false;
  const lessons = new Map(core.lessons.map(lesson => [lesson.id, lesson]));
  const questions = new Map(core.questions.map(question => [question.id, question]));
  const sections = new Set(core.source_sections.map(section => section.id));
  if (!core.source_sections.every(section => validSpan([section.line_start, section.line_end]))) return false;
  if (!core.lessons.every(lesson => lesson.source_sections.every(id => sections.has(id)) && lesson.prerequisites.every(id => lessons.has(id)) && lesson.question_ids.every(id => questions.get(id)?.lesson_id === lesson.id))) return false;
  if (!core.modules.every(module => unique(module.lesson_ids) && module.lesson_ids.every(id => lessons.get(id)?.module_id === module.id))) return false;
  if (!core.lessons.every(lesson => core.modules.filter(module => module.lesson_ids.includes(lesson.id)).length === 1 && core.modules.some(module => module.id === lesson.module_id && module.lesson_ids.includes(lesson.id)))) return false;
  if (!Object.values(core.routes).every(route => route.length > 0 && unique(route) && route.every(id => lessons.has(id)))) return false;
  if (!unique(core.reading_ids) || !unique(core.final_ids) || !unique(core.diagnostic_ids)) return false;
  if (!core.final_ids.every(id => questions.get(id)?.assessment_role === 'final') || !core.diagnostic_ids.every(id => questions.get(id)?.assessment_role === 'diagnostic')) return false;
  return core.questions.every(question => (question.lesson_id === null || lessons.has(question.lesson_id)) && (question.source_reading_id === null || core.reading_ids.includes(question.source_reading_id)));
}

export function validModule(module: ModuleData): boolean {
  if (!uniqueIds(module.lessons) || !uniqueIds(module.questions) || !module.questions.every(validQuestion)) return false;
  const rules = new Set(module.lessons.flatMap(lesson => lesson.rules.map(rule => rule.id)));
  const examples = new Set(module.lessons.flatMap(lesson => lesson.examples.map(example => example.id)));
  if (!uniqueIds(module.lessons.flatMap(lesson => lesson.rules)) || !uniqueIds(module.lessons.flatMap(lesson => lesson.examples))) return false;
  if (!module.questions.every(question => module.lessons.some(lesson => lesson.id === question.lesson_id) && question.rule_ids.every(id => rules.has(id)) && question.source_example_ids.every(id => examples.has(id)))) return false;
  return module.lessons.every(lesson => lesson.examples.every(example => validSpan(example.source_lines)) && unique(lesson.question_ids) && lesson.question_ids.every(id => module.questions.some(question => question.id === id && question.lesson_id === lesson.id)));
}

export function validReadings(data: ReadingData): boolean {
  if (!uniqueIds(data.readings) || !uniqueIds(data.questions) || !data.questions.every(validQuestion) || !uniqueIds(data.readings.flatMap(reading => reading.lines))) return false;
  for (const reading of data.readings) for (const line of reading.lines) {
    if (!validSpan(line.source_lines)) return false;
    const boundaries = graphemeBoundaries(line.display_form);
    let end = 0;
    for (const [ordinal, word] of line.words.entries()) {
      if (word.ordinal !== ordinal || word.word_id !== `${line.id}:${ordinal}` || word.range[0] < end || word.range[1] <= word.range[0] || !boundaries.has(word.range[0]) || !boundaries.has(word.range[1]) || line.display_form.slice(...word.range) !== word.surface) return false;
      end = word.range[1];
    }
  }
  return data.questions.every(question => {
    const reading = data.readings.find(reading => reading.id === question.source_reading_id);
    return reading != null && question.line_ids.every(id => reading.lines.some(line => line.id === id)) && reading.question_ids.includes(question.id);
  }) && data.readings.every(reading => unique(reading.question_ids) && reading.question_ids.every(id => data.questions.some(question => question.id === id && question.source_reading_id === reading.id)));
}

export function validDictionary(data: DictionaryData): boolean {
  return uniqueIds(data.entries) && uniqueIds(data.vocabulary) && data.entries.every(entry => entry.eligibility.dictionary_visible && ['active', 'reference'].includes(entry.eligibility.tier) && entry.source.line >= 1) && data.vocabulary.every(entry => validSpan(entry.source_lines));
}
export function validReferences(data: References): boolean {
  return uniqueIds(data.letters) && uniqueIds(data.profiles) && uniqueIds(data.terms) && data.profiles.filter(profile => profile.is_default).length === 1;
}
export function validAssessments(data: AssessmentData): boolean { return uniqueIds(data.questions) && data.questions.every(validQuestion); }
