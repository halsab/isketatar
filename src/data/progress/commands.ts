import type { AnswerValue, ReadingHelp, ReviewOrigin, SessionKind } from '../../domain/learning/types';
import type { Bookmark, ResumePosition, Settings } from './model';

export type ObservationTarget = { kind: 'lesson' | 'example' | 'dictionary_entry' | 'rule' | 'reference' | 'reading'; id: string; level?: 'letters' | 'rule' | 'reading' | 'meaning' }
  | { kind: 'reading_line' | 'reading_word'; id: string; reading_id: string; line_id: string; level?: ReadingHelp['kind'] }
  | { kind: 'dictionary_results'; ids: string[] };
export type Command =
  | { type: 'start'; kind: SessionKind; lesson_id?: string; reading_id?: string; early_question_ids?: string[]; restart?: boolean }
  | { type: 'pause' | 'resume'; session_id: string }
  | { type: 'ack' | 'retry' | 'skip'; presentation_id: string }
  | { type: 'show'; presentation_id: string; confirm_assessment_help?: boolean }
  | { type: 'draft'; presentation_id: string; answer: AnswerValue | null }
  | { type: 'submit'; presentation_id: string; answer: AnswerValue; confirm_assessment_help?: boolean }
  | { type: 'help'; presentation_id: string; kind: 'hint' | 'rule' | 'reference' | 'reading' | 'meaning' | 'reveal'; hint_index?: number; confirm_assessment_help?: boolean }
  | { type: 'finish_assessment'; session_id: string; confirm_incomplete: boolean; defer_imla: boolean }
  | { type: 'navigate_question'; session_id: string; question_id: string }
  | { type: 'observe'; target: ObservationTarget; confirm_assessment_help: boolean }
  | { type: 'read_complete'; reading_id: string }
  | { type: 'review_add'; question_id: string; origin: ReviewOrigin }
  | { type: 'review_suspend'; question_id: string }
  | { type: 'settings'; patch: Partial<Omit<Settings, 'revision' | 'updated_at' | 'locale'>> }
  | { type: 'bookmark'; kind: Bookmark['kind']; target_id: string; position: Bookmark['position']; remove?: boolean }
  | { type: 'position'; position: Omit<ResumePosition, 'updated_at'> };
