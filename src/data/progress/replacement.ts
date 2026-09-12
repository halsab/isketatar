import type { Transaction } from './backend';
import { STORE_NAMES, recordBytes } from './model';
import type { Control, ProgressData, ReplacementToken } from './model';

export function checkReplacement(control: Control, expected: ReplacementToken, tabId: string) {
  if (control.data_generation !== expected.data_generation || control.state_revision !== expected.state_revision || control.writer_epoch !== expected.writer_epoch || control.writer_id !== tabId) throw new Error('write_conflict');
  if (control.update_gate !== null) throw new Error('update_in_progress');
}
export async function replaceProgress(tx: Transaction, previous: Control, data: ProgressData, generation: string, tabId: string): Promise<Control> {
  for (const store of STORE_NAMES) await tx.clear(store);
  const sessions = data.sessions.map(session => ({ ...session, data_generation: generation, status: session.status === 'active' ? 'paused' as const : session.status }));
  await tx.put('meta', { key: 'settings', value: data.settings });
  for (const position of data.resume_positions) await tx.put('meta', { key: `position:${position.kind}:${position.target_id}`, value: position });
  for (const session of sessions) await tx.put('sessions', session);
  for (const presentation of data.presentations) await tx.put('presentations', presentation);
  for (const attempt of data.attempts) await tx.put('attempts', attempt);
  for (const exposure of data.exposures) await tx.put('exposures', exposure);
  for (const card of data.review_cards) await tx.put('review_cards', card);
  for (const bookmark of data.bookmarks) await tx.put('bookmarks', bookmark);
  for (const legacy of data.legacy) await tx.put('legacy', legacy);
  const values = [data.settings, ...sessions, ...data.presentations, ...data.attempts, ...data.exposures, ...data.review_cards, ...data.bookmarks, ...data.resume_positions, ...data.legacy];
  const control: Control = { key: 'control', accepted_release_id: previous.accepted_release_id, progress_schema: 1, db_version: 1, data_generation: generation, writer_id: tabId, writer_epoch: previous.writer_epoch + 1, state_revision: previous.state_revision + 1,
    active_session_id: null, update_gate: null, estimated_record_bytes: values.reduce((total, value) => total + recordBytes(value), 0), attempt_count: data.attempts.length };
  await tx.put('meta', control);
  return control;
}
