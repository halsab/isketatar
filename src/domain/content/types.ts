export type Profile = 'book_jadid_10' | 'book_jadid_6' | 'book_kadimi' | 'book_yanga' | 'loan_original' | 'book_unspecified';
export type RouteId = 'arabic_reader' | 'new_to_script';
export type SourceSpan = [number, number];
export type QuestionType = 'choice' | 'select_many' | 'reading' | 'segment';
export type AssessmentRole = 'practice' | 'transfer' | 'diagnostic' | 'final' | 'reading_practice';
export type PolicyVersions = typeof POLICIES;
export const POLICIES = {
  grading: 'grading/1', normalization: 'tt-reading/1', mastery: 'lesson-mastery/1',
  diagnostic: 'diagnostic/1', final: 'final/1', review: 'review/1', exposure: 'exposure/1',
  release_access: 'release-access/1', search: 'dictionary-search/1', import: 'progress-import/1',
} as const;

export interface QuestionRef {
  id: string; grading_revision: string; assessment_role: AssessmentRole; type: QuestionType;
  lesson_id: string | null; source_reading_id: string | null; resource: string;
}
export interface LessonSummary {
  id: string; module_id: string; title_tt: string; prerequisites: string[];
  source_sections: string[]; required_for_completion: boolean; skills: string[];
  question_ids: string[]; resource: string;
}
export interface ModuleSummary { id: string; title_tt: string; lesson_ids: string[] }
export interface Material { visual: string; reading: string | null; reading_in_prompt: boolean }
interface QuestionBase extends QuestionRef {
  origin: 'course' | 'diagnostic' | 'final' | 'reading'; prompt_tt: string; stimulus: string;
  options: { id: string; text_tt: string }[]; accepted_answers: string[];
  explanation_tt: string; hints_tt: string[]; skill: 'letter' | 'reading' | 'rule' | 'morphology';
  difficulty: number; profile: Profile; rule_ids: string[]; source_example_ids: string[];
  source_lines: SourceSpan; source_form: string; group: string | null;
  recommend_lessons: string[]; line_ids: string[]; allow_terminal_punctuation: boolean;
  visible_context: { id: string; display_form: string; profile: Profile }[]; materials: Material[];
}
export type Question = QuestionBase & (
  | { type: 'choice'; grading: 'exact_option' }
  | { type: 'select_many'; grading: 'set' }
  | { type: 'reading'; grading: 'tt_reading' }
  | { type: 'segment'; grading: 'segments' }
);
export interface Rule { id: string; statement_tt: string; scope_tt: string; source_sections: string[]; lesson_id: string; question_ids: string[] }
export interface Example {
  id: string; source_form: string; display_form: string; reading_tt: string | null;
  meaning_tt: string; explanation_tt: string; source_lines: SourceSpan; profile: Profile;
  status: string; usage: 'demonstration' | 'reference' | 'assessment_source'; reading_note_tt: string | null;
  materials: Material[];
}
export interface Lesson extends LessonSummary {
  goals_tt: string[]; theory_tt: string[]; rules: Rule[]; examples: Example[];
  pitfalls_tt: string[]; outcomes_tt: string[];
  letter_groups: { sun: string[]; moon: string[] } | null;
  component_inventory: { form: string; function_tt: string }[];
  external_sources: { url: string; supports_tt: string }[]; content_revision: string;
}
export interface ReadingWord {
  word_id: string; ordinal: number; range: [number, number]; surface: string;
  reading_tt: string; meaning_tt: string; explanation_tt: string; lexicon_id: string | null;
  materials: Material[];
}
export interface ReadingLine {
  id: string; source_form: string; display_form: string; reading_tt: string; meaning_tt: string;
  source_lines: SourceSpan; reading_status: string; words: ReadingWord[]; content_revision: string;
}
export interface Reading {
  id: string; title_tt: string; level: number; role: string; lesson_ids: string[]; profile: Profile;
  provenance: { kind: string; note_tt: string; source_sections: string[] }; instructions_tt: string;
  lines: ReadingLine[]; help_order: ('letters' | 'rule' | 'reading' | 'meaning')[];
  question_ids: string[]; content_revision: string;
}
export interface Vocabulary {
  id: string; lesson_id: string; source_example_id: string; display_form: string;
  reading_tt: string | null; meaning_tt: string; profile: Profile; source_lines: SourceSpan;
  status: string; kind: string; source_dictionary_ids: string[];
  release: 'with_lesson' | 'after_linked_question'; question_ids: string[]; materials: Material[];
}
export interface DictionaryEntry {
  id: string; source_form: string; display_form: string; reading_tt: string | null; meaning_tt: string;
  section: string; source: { line: number }; profile: Profile; status: string;
  eligibility: { tier: 'active' | 'reference'; dictionary_visible: boolean; practice_allowed: boolean; reason_tt: string };
  constraints: string[]; links: { id: string; type: string }[];
  forms: { form: string; reading_tt: string | null; relationship: string }[];
  editorial_notes_tt: string[]; materials: Material[];
}
export interface SourceSection { id: string; title: string; line_start: number; line_end: number }
export interface Letter {
  id: string; base: string; name_tt: string; joins_previous: boolean; joins_following: boolean;
  function_tt: string; forms: { isolated: string; initial: string; medial: string; final: string };
  source_sections: string[];
}
export interface WritingProfile {
  id: Profile; title_tt: string; description_tt: string; source_sections: string[];
  base_vowel_signs: string[]; is_default: boolean;
}
export interface References {
  letters: Letter[]; letter_notes_tt: string[];
  ligatures: { text: string; components: string[]; name_tt: string; source_sections: string[] }[];
  marks: { text: string; name_tt: string; function_tt: string }[];
  profiles: WritingProfile[]; comparison_note_tt: string;
  vowel_table: { profile: Profile; title_tt: string; note_tt: string; rows: {
    sound_tt: string; initial: string; medial: string; final: string | null; note_tt: string; lesson_ids: string[];
  }[] };
  terms: { id: string; term_tt: string; definition_tt: string; lesson_id: string }[];
}
export interface CoreData {
  content_version: string; content_schema: number; policy_versions: PolicyVersions;
  modules: ModuleSummary[]; routes: Record<RouteId, string[]>; lessons: LessonSummary[];
  questions: QuestionRef[]; source_sections: SourceSection[];
  diagnostic_ids: string[]; final_ids: string[]; reading_ids: string[];
}
export interface ModuleData { lessons: Lesson[]; questions: Question[] }
export interface ReadingData { readings: Reading[]; questions: Question[] }
export interface DictionaryData { entries: DictionaryEntry[]; vocabulary: Vocabulary[] }
export interface AssessmentData { questions: Question[] }
export interface Asset { url: string; sha256: string; bytes: number; kind: 'shell' | 'script' | 'style' | 'font' | 'content' | 'media'; required: boolean }
export interface ReleaseManifest {
  release_id: string; app_version: string; content_version: string; content_schema: number;
  progress_schema: number; min_reader_version: string; base_path: string; built_at: number;
  assets: Asset[]; question_revisions: Record<string, string>; policy_versions: PolicyVersions;
}
