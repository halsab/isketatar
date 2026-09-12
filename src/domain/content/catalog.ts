import type { AssessmentData, CoreData, DictionaryData, DictionaryEntry, Example, Lesson, ModuleData, Question, Reading, ReadingData, References, Rule, Vocabulary } from './types.ts';

export class ContentCatalog {
  readonly lessons = new Map<string, Lesson>();
  readonly questions = new Map<string, Question>();
  readonly rules = new Map<string, Rule>();
  readonly examples = new Map<string, Example>();
  readonly readings = new Map<string, Reading>();
  readonly lexicon = new Map<string, DictionaryEntry>();
  readonly vocabulary = new Map<string, Vocabulary>();
  references: References | null = null;
  constructor(readonly core: CoreData) {}

  addModule(data: ModuleData) {
    for (const lesson of data.lessons) {
      this.lessons.set(lesson.id, lesson);
      for (const rule of lesson.rules) this.rules.set(rule.id, rule);
      for (const example of lesson.examples) this.examples.set(example.id, example);
    }
    this.addQuestions(data);
  }
  addQuestions(data: AssessmentData) { for (const question of data.questions) this.questions.set(question.id, question); }
  addReadings(data: ReadingData) { for (const reading of data.readings) this.readings.set(reading.id, reading); this.addQuestions(data); }
  addDictionary(data: DictionaryData) {
    for (const entry of data.entries) if (entry.eligibility.dictionary_visible) this.lexicon.set(entry.id, entry);
    for (const entry of data.vocabulary) this.vocabulary.set(entry.id, entry);
  }
  question(id: string): Question {
    const question = this.questions.get(id);
    if (!question) throw new Error('content_unavailable');
    return question;
  }
  lessonPlan(id: string) { return this.core.questions.filter(q => q.lesson_id === id).sort((a, b) => Number(a.assessment_role === 'transfer') - Number(b.assessment_role === 'transfer')); }
}
