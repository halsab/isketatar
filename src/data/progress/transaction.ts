import { canonical } from '../../domain/content/canonical';
import { exportedRecord, KEY_PATHS, recordBytes, SOFT_ATTEMPTS, SOFT_BYTES } from './model';
import type { Control, Expected, MetaRecord, RecordExpectation, StoreName, StoreRecords } from './model';
import type { Transaction } from './backend';

export async function readControl(transaction: Transaction): Promise<Control> {
  const control = await transaction.get('meta', 'control');
  if (!control || control.key !== 'control') throw new Error('storage_corrupt');
  if (control.progress_schema !== 1 || control.db_version !== 1) throw new Error('unsupported_storage');
  return control;
}
export class WriteContext {
  dirty = false;
  private readonly checked = new Set<string>();
  private readonly revisions = new Map<string, RecordExpectation>();
  private readonly historyAlreadyFull: boolean;
  constructor(readonly tx: Transaction, readonly control: Control, readonly expected: Expected, readonly observation = false) {
    this.historyAlreadyFull = control.estimated_record_bytes >= SOFT_BYTES || control.attempt_count >= SOFT_ATTEMPTS;
  }
  private revision(store: StoreName, record: StoreRecords[StoreName]): number | null {
    if (store === 'meta') {
      const meta = record as MetaRecord;
      return meta.key === 'settings' ? meta.value.revision : null;
    }
    return 'revision' in record ? record.revision : null;
  }
  check(store: StoreName, key: string, record: StoreRecords[StoreName]) {
    const revision = this.revision(store, record);
    const identity = `${store}:${key}`;
    if (this.observation || revision === null || this.checked.has(identity)) return;
    if (!this.expected.revisions.some(item => item.store === store && item.key === key && item.revision === revision)) throw new Error('write_conflict');
    this.checked.add(identity);
  }
  async put<K extends StoreName>(store: K, record: StoreRecords[K]) {
    const key = String(record[KEY_PATHS[store]]);
    const previous = await this.tx.get(store, key);
    if (previous && canonical(previous) === canonical(record)) return;
    if (previous) this.check(store, key, previous);
    else this.checked.add(`${store}:${key}`);
    this.control.estimated_record_bytes += recordBytes(exportedRecord(store, record)) - (previous ? recordBytes(exportedRecord(store, previous)) : 0);
    if (store === 'attempts' && !previous) this.control.attempt_count++;
    if (!previous) {
      const limits: Partial<Record<StoreName, number>> = { sessions: 100000, presentations: 200000, attempts: 100000, exposures: 100000, bookmarks: 100000, legacy: 100000, meta: 10002 };
      const limit = limits[store];
      if (limit !== undefined && await this.tx.count(store) >= limit) throw new Error('history_full');
    }
    await this.tx.put(store, record);
    const revision = this.revision(store, record);
    if (revision !== null && ['meta', 'sessions', 'presentations', 'review_cards'].includes(store)) this.revisions.set(`${store}:${key}`, { store: store as RecordExpectation['store'], key, revision });
    this.dirty = true;
  }
  async delete(store: StoreName, key: string) {
    const previous = await this.tx.get(store, key);
    if (!previous) return;
    this.check(store, key, previous);
    this.control.estimated_record_bytes -= recordBytes(exportedRecord(store, previous));
    if (store === 'attempts') this.control.attempt_count--;
    await this.tx.delete(store, key);
    this.dirty = true;
  }
  async finish(history: boolean) {
    if (!this.dirty) return;
    if (history && (this.historyAlreadyFull || this.control.estimated_record_bytes > SOFT_BYTES || this.control.attempt_count > SOFT_ATTEMPTS)) throw new Error('history_full');
    this.control.state_revision++;
    await this.tx.put('meta', this.control);
  }
  nextExpected(): Expected {
    const revisions = new Map(this.expected.revisions.map(item => [`${item.store}:${item.key}`, item]));
    for (const [key, value] of this.revisions) revisions.set(key, value);
    return { data_generation: this.control.data_generation, writer_epoch: this.control.writer_epoch, revisions: [...revisions.values()] };
  }
}
