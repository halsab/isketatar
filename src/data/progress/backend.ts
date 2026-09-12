import { openDB } from 'idb';
import type { IDBPDatabase, IDBPTransaction } from 'idb';
import { STORE_NAMES } from './model';
import type { ProgressDB, StoreName, StoreRecords } from './model';

export interface Transaction {
  get<K extends StoreName>(store: K, key: string): Promise<StoreRecords[K] | undefined>;
  all<K extends StoreName>(store: K): Promise<StoreRecords[K][]>;
  bySession<K extends 'presentations' | 'attempts'>(store: K, id: string): Promise<StoreRecords[K][]>;
  byQuestion(id: string): Promise<StoreRecords['attempts'][]>;
  unfinishedSessions(): Promise<StoreRecords['sessions'][]>;
  put<K extends StoreName>(store: K, value: StoreRecords[K]): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  clear(store: StoreName): Promise<void>;
  count(store: StoreName): Promise<number>;
}
export interface Backend {
  run<T>(mode: 'readonly' | 'readwrite', body: (transaction: Transaction) => Promise<T>): Promise<T>;
  close(): void;
}
class IndexedTransaction implements Transaction {
  constructor(private readonly transaction: IDBPTransaction<ProgressDB, StoreName[], 'readwrite'>) {}
  async get<K extends StoreName>(store: K, key: string) { return await this.transaction.objectStore(store).get(key) as StoreRecords[K] | undefined; }
  async all<K extends StoreName>(store: K) { return await this.transaction.objectStore(store).getAll() as StoreRecords[K][]; }
  async bySession<K extends 'presentations' | 'attempts'>(store: K, id: string) {
    return await (store === 'presentations' ? this.transaction.objectStore('presentations').index('session_id').getAll(id) : this.transaction.objectStore('attempts').index('session_id').getAll(id)) as StoreRecords[K][];
  }
  async byQuestion(id: string) { return this.transaction.objectStore('attempts').index('question_revision').getAll(IDBKeyRange.bound([id, ''], [id, '\uffff'])); }
  async unfinishedSessions() {
    const index = this.transaction.objectStore('sessions').index('status');
    const [active, paused] = await Promise.all([index.getAll('active'), index.getAll('paused')]);
    return [...active, ...paused];
  }
  async put<K extends StoreName>(store: K, value: StoreRecords[K]) { await this.transaction.objectStore(store).put(value); }
  async delete(store: StoreName, key: string) { await this.transaction.objectStore(store).delete(key); }
  async clear(store: StoreName) { await this.transaction.objectStore(store).clear(); }
  async count(store: StoreName) { return this.transaction.objectStore(store).count(); }
}
export function storageError(error: unknown): Error {
  if (error instanceof DOMException) {
    if (error.name === 'QuotaExceededError') return new Error('storage_full');
    if (error.name === 'VersionError') return new Error('unsupported_storage');
    return new Error('storage_unavailable');
  }
  return error instanceof Error ? error : new Error('storage_unavailable');
}
export class IndexedBackend implements Backend {
  private constructor(private readonly database: IDBPDatabase<ProgressDB>) {}
  static open(name: string, onClosed: () => void = () => {}): Promise<IndexedBackend> {
    return new Promise((resolve, reject) => {
      let blocked = false;
      let connection: IDBPDatabase<ProgressDB> | undefined;
      openDB<ProgressDB>(name, 1, {
        upgrade(database) {
          database.createObjectStore('meta', { keyPath: 'key' });
          const sessions = database.createObjectStore('sessions', { keyPath: 'session_id' });
          sessions.createIndex('status', 'status'); sessions.createIndex('started_at', 'started_at');
          const presentations = database.createObjectStore('presentations', { keyPath: 'presentation_id' });
          presentations.createIndex('session_question_ordinal', ['session_id', 'question_id', 'ordinal'], { unique: true }); presentations.createIndex('session_id', 'session_id');
          const attempts = database.createObjectStore('attempts', { keyPath: 'presentation_id' });
          attempts.createIndex('session_id', 'session_id'); attempts.createIndex('question_revision', ['question_id', 'grading_revision']); attempts.createIndex('submitted_at', 'submitted_at');
          database.createObjectStore('exposures', { keyPath: 'exposure_key' });
          database.createObjectStore('review_cards', { keyPath: 'question_id' }).createIndex('status_due', ['status', 'due_at']);
          database.createObjectStore('bookmarks', { keyPath: 'bookmark_key' }).createIndex('kind', 'kind');
          database.createObjectStore('legacy', { keyPath: 'legacy_id' }).createIndex('origin_kind', 'origin_kind');
        },
        blocked() { blocked = true; reject(new Error('storage_blocked')); },
        blocking() { connection?.close(); onClosed(); },
        terminated: onClosed,
      }).then(database => { connection = database; if (blocked) database.close(); else resolve(new IndexedBackend(database)); }, error => reject(storageError(error)));
    });
  }
  async run<T>(mode: 'readonly' | 'readwrite', body: (transaction: Transaction) => Promise<T>): Promise<T> {
    let transaction: IDBPTransaction<ProgressDB, StoreName[], typeof mode>;
    try { transaction = this.database.transaction(STORE_NAMES, mode); } catch (error) { throw storageError(error); }
    try {
      // Адаптер объединяет режимы; вызывающий readonly-код не получает прав от этого приведения типов.
      const result = await body(new IndexedTransaction(transaction as IDBPTransaction<ProgressDB, StoreName[], 'readwrite'>));
      await transaction.done;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* Транзакция уже могла завершиться отказом. */ }
      await transaction.done.catch(() => {});
      throw storageError(error);
    }
  }
  close() { this.database.close(); }
}
