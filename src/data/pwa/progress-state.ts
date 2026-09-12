import { openDB } from 'idb';
import type { Control, ProgressDB } from '../progress/model';
import { validateControl, validateSession } from '../../generated/progress-validators';
import { assertStructure } from '../progress/structure';
import type { UpdateState } from './coordination';

// Только control и Session: worker не открывает stores с ответами, черновиками или оценками и ничего не записывает.
export async function readUpdateState(name = 'iske-imla-progress'): Promise<UpdateState | null> {
  let absent = false;
  const database = await openDB<ProgressDB>(name, 1, { upgrade(_database, _old, _next, transaction) { absent = true; void transaction.done.catch(() => {}); transaction.abort(); } }).catch(error => { if (absent) return null; throw error; });
  if (!database) return null;
  try {
    const tx = database.transaction(['meta', 'sessions'], 'readonly');
    const [rawControl, rawSessions] = await Promise.all([tx.objectStore('meta').get('control'), tx.objectStore('sessions').getAll()]);
    await tx.done;
    if (rawControl === undefined && rawSessions.length === 0) return null;
    assertStructure(rawControl, 'storage_corrupt');
    if (rawControl?.key === 'control' && (rawControl.progress_schema !== 1 || rawControl.db_version !== 1)) throw new Error('unsupported_storage');
    if (!validateControl(rawControl) || rawControl?.key !== 'control') throw new Error('storage_corrupt');
    const control = rawControl as Control;
    const sessions = rawSessions.map(value => { assertStructure(value, 'storage_corrupt'); if (!validateSession(value)) throw new Error('storage_corrupt'); return value; });
    if (sessions.some(session => session.data_generation !== control.data_generation)) throw new Error('storage_corrupt');
    const pending = sessions.filter(session => session.status === 'active' || session.status === 'paused');
    return {
      control: { accepted_release_id: control.accepted_release_id, data_generation: control.data_generation, writer_epoch: control.writer_epoch, writer_id: control.writer_id, active_session_id: control.active_session_id, update_gate: control.update_gate },
      pins: pending.map(({ session_id, release_id, content_schema, policy_versions }) => ({ session_id, release_id, content_schema, policy_versions })),
      active: pending.some(session => session.status === 'active'),
    };
  } finally { database.close(); }
}
