import type { DBSchema } from 'idb';
import type { RouteId } from '../../domain/content/types';
import type { Attempt, Exposure, Presentation, ReviewCard, Session } from '../../domain/learning/types';

export interface Settings {
  selected_route: RouteId | null; onboarding_completed: boolean; locale: 'tt-Cyrl'; theme: 'system' | 'light' | 'dark';
  arabic_size_px: 28 | 32 | 40 | 48; text_size_px: 18 | 20 | 22 | 24; reduced_motion: 'system' | 'reduce'; review_batch_size: number;
  last_location: { kind: 'lesson' | 'reading' | 'dictionary' | 'reference'; id: string } | null; revision: number; updated_at: number;
}
export interface Bookmark {
  bookmark_key: string; kind: 'lesson' | 'reading' | 'dictionary' | 'rule'; target_id: string; created_at: number; updated_at: number;
  position: { line_id: string; line_revision: string; word_ordinal: number | null } | null;
}
export interface ResumePosition {
  kind: 'lesson' | 'reading' | 'reference'; target_id: string; anchor_id: string | null; within_block_ratio: number; content_revision: string; updated_at: number;
}
export interface UpdateGate { update_id: string; target_release_id: string; phase: 'quiescing' | 'commit'; coordinator_id: string; requested_at: number }
export interface Control {
  key: 'control'; accepted_release_id: string; progress_schema: number; db_version: number; data_generation: string; writer_id: string | null;
  writer_epoch: number; state_revision: number; active_session_id: string | null; update_gate: UpdateGate | null;
  estimated_record_bytes: number; attempt_count: number;
}
export type HistoryRecord = Session | Presentation | Attempt | Exposure | ReviewCard | Bookmark | ResumePosition;
export interface Legacy {
  legacy_id: string; origin_kind: 'session' | 'presentation' | 'attempt' | 'exposure' | 'review_card' | 'bookmark' | 'resume_position';
  original_id: string; source_content_version: string; reason: 'unknown_content_id' | 'unknown_grading_revision' | 'unknown_policy_version' | 'incompatible_draft';
  record: HistoryRecord; imported_at: number;
}
export type MetaRecord = Control | { key: 'settings'; value: Settings } | { key: `position:${string}`; value: ResumePosition };
export interface StoreRecords {
  meta: MetaRecord; sessions: Session; presentations: Presentation; attempts: Attempt;
  exposures: Exposure; review_cards: ReviewCard; bookmarks: Bookmark; legacy: Legacy;
}
export type StoreName = keyof StoreRecords;
export const STORE_NAMES: StoreName[] = ['meta', 'sessions', 'presentations', 'attempts', 'exposures', 'review_cards', 'bookmarks', 'legacy'];
export const KEY_PATHS: { [K in StoreName]: keyof StoreRecords[K] } = { meta: 'key', sessions: 'session_id', presentations: 'presentation_id', attempts: 'presentation_id', exposures: 'exposure_key', review_cards: 'question_id', bookmarks: 'bookmark_key', legacy: 'legacy_id' };
export interface ProgressDB extends DBSchema {
  meta: { key: string; value: MetaRecord };
  sessions: { key: string; value: Session; indexes: { status: string; started_at: number } };
  presentations: { key: string; value: Presentation; indexes: { session_question_ordinal: [string, string, number]; session_id: string } };
  attempts: { key: string; value: Attempt; indexes: { session_id: string; question_revision: [string, string]; submitted_at: number } };
  exposures: { key: string; value: Exposure };
  review_cards: { key: string; value: ReviewCard; indexes: { status_due: [string, number] } };
  bookmarks: { key: string; value: Bookmark; indexes: { kind: string } };
  legacy: { key: string; value: Legacy; indexes: { origin_kind: string } };
}
export interface ProgressData {
  settings: Settings; sessions: Session[]; presentations: Presentation[]; attempts: Attempt[];
  exposures: Exposure[]; review_cards: ReviewCard[]; bookmarks: Bookmark[]; resume_positions: ResumePosition[]; legacy: Legacy[];
}
export interface ProgressSnapshot extends ProgressData { control: Control }
export interface ProgressExport { format: 'iske-imla-progress'; schema_version: 1; content_version: string; app_version: string; exported_at: number; data: ProgressData }
export interface ReplacementToken { data_generation: string; writer_epoch: number; state_revision: number }
export interface ImportPreview { id: string; recognized_lessons: number; recognized_attempts: number; legacy_records: number; legacy_reasons: Record<Legacy['reason'], number>; bookmarks: number; route: RouteId | null; expected: ReplacementToken }
export interface RecordExpectation { store: 'sessions' | 'presentations' | 'review_cards' | 'meta'; key: string; revision: number | null }
export interface Expected { data_generation: string; writer_epoch: number; update_id?: string | null; revisions: RecordExpectation[] }
export const defaultSettings = (at: number): Settings => ({ selected_route: null, onboarding_completed: false, locale: 'tt-Cyrl', theme: 'system', arabic_size_px: 32, text_size_px: 18, reduced_motion: 'system', review_batch_size: 10, last_location: null, revision: 0, updated_at: at });
export function exportedRecord(store: StoreName, record: StoreRecords[StoreName]): unknown {
  if (store !== 'meta') return record;
  const meta = record as MetaRecord;
  return meta.key === 'control' ? null : meta.value;
}
export const recordBytes = (value: unknown) => value === null ? 0 : new TextEncoder().encode(JSON.stringify(value)).length;
export const SOFT_BYTES = 16 * 1024 * 1024;
export const SOFT_ATTEMPTS = 90_000;
