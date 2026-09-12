import type { Backend, Transaction } from './backend';
import { storageError } from './backend';
import { KEY_PATHS, STORE_NAMES } from './model';
import type { StoreName, StoreRecords } from './model';
import { checkedRecord } from './store-validation';

type Tables = Map<StoreName, Map<string, StoreRecords[StoreName]>>;
class MemoryTransaction implements Transaction {
  private active = true;
  private ordinals: Map<string, string> | null = null;
  constructor(private readonly tables: Tables, private readonly writable: boolean) {}
  finish() { this.active = false; }
  private requireActive() { if (!this.active) throw new Error('storage_unavailable'); }
  private ordinalKey(value: StoreRecords['presentations']) { return `${value.session_id}:${value.question_id}:${value.ordinal}`; }
  private presentationIndex() {
    this.ordinals ??= new Map([...this.tables.get('presentations')!.values()].map(value => { const presentation = value as StoreRecords['presentations']; return [this.ordinalKey(presentation), presentation.presentation_id]; }));
    return this.ordinals;
  }
  async get<K extends StoreName>(store: K, key: string): Promise<StoreRecords[K] | undefined> {
    this.requireActive();
    const value = this.tables.get(store)!.get(key);
    return value === undefined ? undefined : structuredClone(checkedRecord(store, value));
  }
  private read<K extends StoreName>(store: K, predicate: (value: StoreRecords[K]) => boolean = () => true): StoreRecords[K][] {
    this.requireActive();
    return [...this.tables.get(store)!.entries()].filter(([, value]) => predicate(value as StoreRecords[K])).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => structuredClone(checkedRecord(store, value)));
  }
  async all<K extends StoreName>(store: K) { return this.read(store); }
  async bySession<K extends 'presentations' | 'attempts'>(store: K, id: string) { return this.read(store, item => item.session_id === id); }
  async byQuestion(id: string) { return this.read('attempts', item => item.question_id === id); }
  async unfinishedSessions() { return this.read('sessions', item => ['active', 'paused'].includes(item.status)); }
  private requireWrite() { this.requireActive(); if (!this.writable) throw new Error('storage_unavailable'); }
  async put<K extends StoreName>(store: K, value: StoreRecords[K]) {
    this.requireWrite(); checkedRecord(store, value);
    const key = String(value[KEY_PATHS[store]]);
    if (store === 'presentations') {
      const presentation = value as StoreRecords['presentations'];
      const index = this.presentationIndex(); const owner = index.get(this.ordinalKey(presentation));
      if (owner !== undefined && owner !== key) throw new Error('storage_unavailable');
      const previous = this.tables.get(store)!.get(key) as StoreRecords['presentations'] | undefined;
      if (previous) index.delete(this.ordinalKey(previous));
      index.set(this.ordinalKey(presentation), key);
    }
    this.tables.get(store)!.set(key, structuredClone(value));
  }
  async delete(store: StoreName, key: string) {
    this.requireWrite();
    const previous = this.tables.get(store)!.get(key);
    if (store === 'presentations' && previous) this.presentationIndex().delete(this.ordinalKey(previous as StoreRecords['presentations']));
    this.tables.get(store)!.delete(key);
  }
  async clear(store: StoreName) { this.requireWrite(); this.tables.get(store)!.clear(); if (store === 'presentations') this.ordinals = new Map(); }
  async count(store: StoreName) { this.requireActive(); return this.tables.get(store)!.size; }
}
export class MemoryBackend implements Backend {
  readonly mode = 'memory' as const;
  private tables: Tables = new Map(STORE_NAMES.map(store => [store, new Map()]));
  private serial: Promise<unknown> = Promise.resolve();
  private closed = false;
  run<T>(mode: 'readonly' | 'readwrite', body: (transaction: Transaction) => Promise<T>): Promise<T> {
    const operation = this.serial.then(async () => {
      if (this.closed) throw new Error('storage_unavailable');
      const tables = mode === 'readwrite' ? new Map([...this.tables].map(([name, records]) => [name, new Map(records)])) : this.tables;
      const transaction = new MemoryTransaction(tables, mode === 'readwrite');
      try {
        const result = await body(transaction);
        if (mode === 'readwrite') this.tables = tables;
        return result;
      } catch (error) { throw storageError(error); } finally { transaction.finish(); }
    });
    this.serial = operation.catch(() => {});
    return operation;
  }
  close() { this.closed = true; }
}
