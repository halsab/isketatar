import type { AssessmentRole, PolicyVersions, RouteId } from '../content/types';

export type AnswerValue = { kind: 'option'; option_id: string } | { kind: 'set'; option_ids: string[] } | { kind: 'text' | 'segments'; text: string } | { kind: 'unknown' };
export type NormalizedAnswer = string | string[] | null;
export type Grade = 'correct' | 'incorrect' | 'unknown';
export type SessionKind = 'lesson_cycle' | 'review' | 'diagnostic' | 'final' | 'reading_practice';
export type SessionStatus = 'active' | 'paused' | 'submitted' | 'abandoned' | 'incompatible';
export interface PlanItem {
  question_id: string; grading_revision: string; first_presentation_id: string;
  option_order: string[]; assessment_role: AssessmentRole;
}
export interface ReadingHelp { line_id: string; word_id: string | null; kind: 'letters' | 'rule' | 'reading' | 'meaning'; opened_at: number }
export interface Session {
  session_id: string; kind: SessionKind; status: SessionStatus; revision: number; data_generation: string;
  release_id: string; content_version: string; content_schema: number; policy_versions: PolicyVersions;
  lesson_id: string | null; reading_ids: string[]; diagnostic_imla_deferred: boolean;
  assessment_help_opened_at: number | null; reading_help: ReadingHelp[]; route_at_start: RouteId | null;
  question_plan: PlanItem[]; active_presentation_id: string | null; started_at: number; updated_at: number;
  submitted_at: number | null; abandoned_at: number | null; incompatibility_reason: string | null;
}
export interface Assistance {
  hint_indices: number[]; first_hint_at: number | null; rule_opened_at: number | null;
  reading_opened_at: number | null; meaning_opened_at: number | null; answer_revealed_at: number | null;
  reference_opened_at: number | null;
}
export interface Familiarity { question_seen_before: boolean; material_seen_before: boolean; reading_exposed_before: boolean }
export interface Presentation {
  presentation_id: string; session_id: string; question_id: string; grading_revision: string;
  ordinal: number; revision: number; status: 'draft' | 'submitted'; created_at: number; shown_at: number | null;
  draft_answer: AnswerValue | null; draft_updated_at: number | null; assistance: Assistance;
  familiarity_at_show: Familiarity; feedback_opened_at: number | null; feedback_acknowledged_at: number | null;
}
export interface Attempt {
  presentation_id: string; session_id: string; question_id: string; grading_revision: string;
  ordinal: number; release_id: string; content_version: string; policy_versions: PolicyVersions;
  answer_raw: AnswerValue; answer_normalized: NormalizedAnswer; grade: Grade;
  assistance_before_submit: Assistance; familiarity_at_show: Familiarity; first_submission_in_cycle: boolean;
  independent_correct: boolean; submitted_at: number; elapsed_ms: number | null;
}
export interface Exposure {
  exposure_key: string; kind: 'lesson' | 'reading' | 'question' | 'example' | 'reading_line' | 'reading_word' | 'dictionary_entry' | 'material';
  resource_id: string | null; material_key: string | null; exposure_policy: string; first_seen_at: number; last_seen_at: number;
  first_reading_exposed_at: number | null; first_meaning_exposed_at: number | null; first_answer_exposed_at: number | null; first_completed_at: number | null;
}
export interface ReviewOrigin { kind: 'lesson' | 'reading' | 'dictionary' | 'manual'; id: string }
export interface ReviewCard {
  question_id: string; grading_revision: string; revision: number; status: 'active' | 'suspended'; origins: ReviewOrigin[];
  step: number; due_at: number; created_at: number; updated_at: number; last_scheduled_presentation_id: string | null;
  last_outcome: Grade | 'assisted' | null; attempt_count: number; independent_success_count: number;
  incorrect_count: number; unknown_count: number; assisted_count: number; policy_version: string;
}
export interface LearningRecords { sessions: Session[]; presentations: Presentation[]; attempts: Attempt[]; exposures: Exposure[] }
export type LessonState = 'not_started' | 'in_progress' | 'practiced' | 'mastered';
export interface LessonProgress {
  lesson_id: string; state: LessonState; first_started_at: number | null; practiced_at: number | null; first_mastered_at: number | null;
  latest_completed_session_id: string | null; required_question_ids: string[]; covered_question_ids: string[];
  current_revision_question_ids: string[]; independent_practice_correct: number; practice_count: number;
  independent_transfer_correct: number; transfer_count: number; needs_refresh: boolean; refresh_question_ids: string[];
}
