import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonical, normalizeReading, typographicForm } from '../src/domain/content/canonical.ts';
import { gradingPayload } from '../src/domain/content/revision.ts';
import { graphemeBoundaries, validCore } from '../src/domain/content/validation.ts';
import { POLICIES } from '../src/domain/content/types.ts';

export const digest = value => createHash('sha256').update(value).digest('hex');
const pick = (value, keys) => Object.fromEntries(keys.split(' ').map(key => [key, value[key]]));
export async function loadSources() {
  const manifest = JSON.parse(await readFile('content/manifest.json', 'utf8'));
  const sources = {};
  for (const asset of manifest.assets.filter(asset => asset.required)) {
    const bytes = await readFile(asset.path);
    if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error(`Source integrity: ${asset.path}`);
    sources[asset.path] = JSON.parse(bytes);
  }
  return { manifest, sources };
}

function materials(form, profile, reading, prompt = '') {
  const normalized = typographicForm(form);
  const escapedReading = reading?.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const readingInPrompt = escapedReading != null && new RegExp(`(^|[^\\p{L}\\p{M}\\p{N}])${normalizeReading(escapedReading)}($|[^\\p{L}\\p{M}\\p{N}])`, 'u').test(normalizeReading(prompt));
  return [{
    visual: digest(canonical(['visual', normalized, profile])),
    reading: reading === null ? null : digest(canonical(['reading', normalized, profile, normalizeReading(reading)])),
    reading_in_prompt: readingInPrompt,
  }];
}

export function projectCorpus({ manifest, sources }) {
  const curriculum = sources['content/curriculum.json'];
  const lessonSources = Object.entries(sources).filter(([path]) => path.startsWith('content/lessons/')).flatMap(([, data]) => data.lessons);
  const exampleMap = new Map(lessonSources.flatMap(lesson => lesson.examples.map(example => [example.id, example])));
  const rulesIndex = new Map(sources['content/reference/rules-index.json'].rules.map(rule => [rule.id, rule]));
  const readings = sources['content/readings/texts.json'].texts.map(source => {
    const reading = pick(source, 'id title_tt level role lesson_ids profile instructions_tt help_order question_ids');
    reading.provenance = pick(source.provenance, 'kind note_tt source_sections');
    reading.lines = source.lines.map(line => {
      const boundaries = graphemeBoundaries(line.display_form);
      let cursor = 0;
      const words = line.words.map((word, ordinal) => {
        const start = line.display_form.indexOf(word.surface, cursor);
        const end = start + word.surface.length;
        if (start < cursor || !boundaries.has(start) || !boundaries.has(end)) throw new Error(`Invalid word range: ${line.id}:${ordinal}`);
        cursor = end;
        return { ...pick(word, 'surface reading_tt meaning_tt explanation_tt lexicon_id'), word_id: `${line.id}:${ordinal}`, ordinal, range: [start, end], materials: materials(word.surface, source.profile, word.reading_tt) };
      });
      return { ...pick(line, 'id source_form display_form reading_tt meaning_tt source_lines reading_status'), words, content_revision: digest(canonical([line.id, line.display_form, source.profile, words.map(word => [word.surface, word.range])])) };
    });
    reading.content_revision = digest(canonical(reading.lines.map(line => [line.id, line.content_revision])));
    return reading;
  });
  const readingMap = new Map(readings.map(reading => [reading.id, reading]));
  const rawQuestions = [
    ...Object.entries(sources).filter(([path]) => path.startsWith('content/exercises/')).flatMap(([, data]) => data.items.map(item => ({ ...item, origin: 'course' }))),
    ...sources['content/assessment/diagnostic.json'].items.map(item => ({ ...item, origin: 'diagnostic' })),
    ...sources['content/assessment/final.json'].items.map(item => ({ ...item, origin: 'final' })),
    ...sources['content/readings/questions.json'].items.map(item => ({ ...item, origin: 'reading' })),
  ];
  const questions = rawQuestions.map(source => {
    const reading = readingMap.get(source.source_reading_id);
    const profile = source.profile ?? reading.profile;
    const module = curriculum.lessons.find(lesson => lesson.id === source.lesson_id)?.module_id;
    const visible = (source.line_ids ?? []).map(id => {
      const line = reading.lines.find(line => line.id === id);
      return { id, display_form: line.display_form, profile };
    });
    const matching = (source.source_example_ids ?? []).map(id => exampleMap.get(id)).filter(example => example.display_form === source.stimulus);
    const readingsForStimulus = source.type === 'reading' ? source.accepted_answers : matching.map(example => example.reading_tt).filter(reading => reading !== null);
    const question = {
      ...pick(source, 'id origin type grading prompt_tt stimulus accepted_answers explanation_tt hints_tt skill difficulty assessment_role'),
      options: source.options.map(option => pick(option, 'id text_tt')),
      lesson_id: source.lesson_id ?? null, source_reading_id: source.source_reading_id ?? null,
      profile, source_lines: source.source_lines ?? [Math.min(...reading.lines.map(line => line.source_lines[0])), Math.max(...reading.lines.map(line => line.source_lines[1]))],
      source_form: source.source_form ?? source.stimulus, rule_ids: source.rule_ids ?? [], source_example_ids: source.source_example_ids ?? [],
      group: source.group ?? null, recommend_lessons: source.recommend_lessons ?? reading?.lesson_ids ?? [],
      line_ids: source.line_ids ?? [], allow_terminal_punctuation: false, visible_context: visible,
      resource: module ? `module-${module}.json` : source.origin === 'reading' ? 'readings.json' : 'assessments.json',
      // Ссылка на пример не означает показ всего примера: H03 спрашивает отдельное слово из предложения.
      materials: [...(readingsForStimulus.length ? [...new Set(readingsForStimulus)].flatMap(reading => materials(source.stimulus, profile, reading, source.prompt_tt)) : materials(source.stimulus, profile, null)), ...visible.filter(context => context.display_form !== source.stimulus).flatMap(context => materials(context.display_form, context.profile, null))],
    };
    question.grading_revision = digest(gradingPayload(question));
    return question;
  });
  const questionRefs = questions.map(q => pick(q, 'id grading_revision assessment_role type lesson_id source_reading_id resource'));
  const summaries = curriculum.lessons.map(lesson => ({
    ...pick(lesson, 'id module_id title_tt prerequisites source_sections required_for_completion skills'),
    resource: `module-${lesson.module_id}.json`,
    source_sections: [...new Set([...lesson.source_sections, ...lessonSources.find(source => source.id === lesson.id).source_sections])],
    question_ids: questions.filter(q => q.lesson_id === lesson.id).sort((a, b) => Number(a.assessment_role === 'transfer') - Number(b.assessment_role === 'transfer')).map(q => q.id),
  }));
  const lessons = lessonSources.map(source => {
    const summary = summaries.find(lesson => lesson.id === source.id);
    for (const key of ['title_tt', 'prerequisites']) if (canonical(source[key]) !== canonical(summary[key])) throw new Error(`Lesson disagreement: ${source.id}:${key}`);
    const lesson = {
      ...summary, ...pick(source, 'goals_tt theory_tt pitfalls_tt outcomes_tt'),
      rules: source.rules.map(rule => ({ ...pick(rule, 'id statement_tt scope_tt source_sections'), lesson_id: source.id, question_ids: rulesIndex.get(rule.id).question_ids })),
      examples: source.examples.map(example => ({ ...pick(example, 'id source_form display_form reading_tt meaning_tt explanation_tt source_lines profile status usage'), reading_note_tt: example.reading_note_tt ?? null, materials: materials(example.display_form, example.profile, example.reading_tt) })),
      letter_groups: source.letter_groups ? pick(source.letter_groups, 'sun moon') : null, component_inventory: (source.component_inventory ?? []).map(item => pick(item, 'form function_tt')), external_sources: (source.external_sources ?? []).map(item => pick(item, 'url supports_tt')),
    };
    lesson.content_revision = digest(canonical(lesson));
    return lesson;
  });
  const entries = sources['content/lexicon/lexicon.json'].entries.filter(entry => entry.eligibility.dictionary_visible && entry.eligibility.tier !== 'archive');
  const visibleIds = new Set(entries.map(entry => entry.id));
  const dictionary = {
    entries: entries.map(entry => ({
      ...pick(entry, 'id source_form display_form reading_tt meaning_tt section status constraints editorial_notes_tt'),
      eligibility: pick(entry.eligibility, 'tier dictionary_visible practice_allowed reason_tt'),
      source: { line: entry.source.line }, profile: entry.origin.profile,
      forms: (entry.forms ?? []).map(form => pick(form, 'form reading_tt relationship')), links: entry.links.filter(link => visibleIds.has(link.id)).map(link => pick(link, 'id type')),
      materials: materials(entry.display_form, entry.origin.profile, entry.reading_tt),
    })),
    vocabulary: sources['content/lexicon/course-vocabulary.json'].entries.map(entry => ({ ...pick(entry, 'id lesson_id source_example_id display_form reading_tt meaning_tt profile source_lines status kind source_dictionary_ids release question_ids'), materials: materials(entry.display_form, entry.profile, entry.reading_tt) })),
  };
  const letters = sources['content/reference/letters.json'];
  const profiles = sources['content/reference/profiles.json'];
  const references = {
    letters: letters.letters.map(letter => ({ ...pick(letter, 'id base name_tt joins_previous joins_following function_tt source_sections'), forms: pick(letter.forms, 'isolated initial medial final') })),
    letter_notes_tt: letters.notes_tt, ligatures: letters.ligatures.map(item => pick(item, 'text components name_tt source_sections')), marks: letters.marks.map(item => pick(item, 'text name_tt function_tt')),
    profiles: profiles.profiles.map(profile => ({ ...pick(profile, 'id title_tt description_tt source_sections is_default'), base_vowel_signs: profile.base_vowel_signs ?? [] })),
    comparison_note_tt: profiles.comparison_note_tt, vowel_table: { ...pick(profiles.vowel_table, 'profile title_tt note_tt'), rows: profiles.vowel_table.rows.map(row => pick(row, 'sound_tt initial medial final note_tt lesson_ids')) },
    terms: sources['content/reference/terms.json'].entries.map(term => pick(term, 'id term_tt definition_tt lesson_id')),
  };
  const final = sources['content/assessment/final.json'];
  const core = {
    content_version: manifest.content_version, content_schema: 1, policy_versions: POLICIES,
    modules: curriculum.modules.map(module => pick(module, 'id title_tt lesson_ids')), routes: pick(curriculum.routes, 'arabic_reader new_to_script'),
    lessons: summaries, questions: questionRefs, source_sections: sources['sources/sections.json'].sections.map(section => pick(section, 'id title line_start line_end')),
    diagnostic_ids: questions.filter(q => q.origin === 'diagnostic').map(q => q.id),
    final_ids: [...final.items.map(q => q.id), ...final.reading_text_ids.flatMap(id => readingMap.get(id).question_ids)],
    reading_ids: readings.map(reading => reading.id),
  };
  if (!validCore(core)) throw new Error('Invalid core relationships');
  const modules = core.modules.map(module => ({ lessons: lessons.filter(lesson => lesson.module_id === module.id), questions: questions.filter(q => q.resource === `module-${module.id}.json`) }));
  return { core, modules, readings: { readings, questions: questions.filter(q => q.origin === 'reading') }, dictionary, references, assessments: { questions: questions.filter(q => q.origin === 'diagnostic' || q.origin === 'final') } };
}
