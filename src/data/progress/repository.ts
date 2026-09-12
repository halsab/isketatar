import type { ContentCatalog } from '../../domain/content/catalog';
import type { CoreData } from '../../domain/content/types';
import { defaultSettings, recordBytes, STORE_NAMES } from './model';
import type { Control, Expected, ImportPreview, ProgressData, ProgressSnapshot, ReplacementToken, UpdateGate } from './model';
import { IndexedBackend } from './backend';
import type { Backend, Transaction } from './backend';
import { readControl, WriteContext } from './transaction';
import type { CommandResult } from './engine';
import type { Command } from './commands';
import { exportData, replacementToken } from './model';
import { checkReplacement, replaceProgress } from './replacement';
import { integrity } from './import-integrity';
import { version as appVersion } from '../../../package.json';
import { MemoryBackend } from './memory-backend';
import { markAssessmentHelp, pendingAssessments } from '../../domain/learning/attempt';

interface Options { catalog: ContentCatalog; catalogs?: Map<string, ContentCatalog>; currentCore?: CoreData; releaseId: string; availableReleaseIds?: string[]; tabId?: string; name?: string; clock?: () => number; uuid?: () => string }
interface KnownProtection { generation: string }
interface DurableProtection extends KnownProtection { source: ProgressRepository }
export function expectedFrom(snapshot: ProgressSnapshot): Expected {
  const unfinished = snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status));
  const ids = new Set(unfinished.map(session => session.session_id));
  return { data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch, update_id: snapshot.control.update_gate?.update_id ?? null, revisions: [
    { store: 'meta', key: 'settings', revision: snapshot.settings.revision },
    ...unfinished.map(session => ({ store: 'sessions' as const, key: session.session_id, revision: session.revision })),
    ...snapshot.presentations.filter(presentation => ids.has(presentation.session_id)).map(presentation => ({ store: 'presentations' as const, key: presentation.presentation_id, revision: presentation.revision })),
    ...snapshot.review_cards.map(card => ({ store: 'review_cards' as const, key: card.question_id, revision: card.revision })),
  ] };
}
export class ProgressRepository {
  readonly tabId: string;
  private readonly clock: () => number;
  private readonly uuid: () => string;
  private readonly listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private serial: Promise<unknown> = Promise.resolve();
  private closed = false;
  private importSequence = 0;
  private preparedImport: { preview: ImportPreview; data: ProgressData } | null = null;
  private detached = false;
  private lastProtection: KnownProtection | null = null;
  private protection: DurableProtection | null = null;
  private successfulResetGeneration: string | null = null;
  private constructor(readonly backend: Backend, readonly options: Options) {
    this.uuid = options.uuid ?? (() => crypto.randomUUID()); this.clock = options.clock ?? (() => Date.now()); this.tabId = options.tabId ?? this.uuid();
  }
  static async open(options: Options) {
    let repository: ProgressRepository | undefined;
    const backend = await IndexedBackend.open(options.name ?? 'iske-imla-progress', () => repository?.connectionClosed());
    repository = new ProgressRepository(backend, options);
    const opened = repository;
    try { await repository.initialize(); } catch (error) { backend.close(); throw error; }
    if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      repository.channel = new BroadcastChannel(options.name ?? 'iske-imla-progress');
      repository.channel.onmessage = event => {
        const value: unknown = event.data;
        if (value && typeof value === 'object' && Object.keys(value).sort().join(',') === 'data_generation,state_revision,type' && Reflect.get(value, 'type') === 'changed' && typeof Reflect.get(value, 'data_generation') === 'string' && Number.isSafeInteger(Reflect.get(value, 'state_revision'))) opened.notify();
      };
    }
    return repository;
  }
  static async memory(options: Options): Promise<ProgressRepository> {
    const repository = new ProgressRepository(new MemoryBackend(), options);
    await repository.initialize(); return repository;
  }
  get mode() { return this.backend.mode; }
  async branchToMemory(): Promise<ProgressRepository> {
    if (this.mode !== 'durable') throw new Error('already_memory');
    this.detached = true;
    await this.serial;
    let snapshot: ProgressSnapshot | null = null;
    try { snapshot = await this.snapshot(); } catch { /* При недоступной БД новая ветвь пуста; прежняя БД не удаляется. */ }
    const branch = await ProgressRepository.memory({ ...this.options, tabId: this.uuid() });
    if (snapshot) await branch.backend.run('readwrite', async tx => replaceProgress(tx, await readControl(tx), exportData(snapshot), branch.uuid(), branch.tabId));
    if (this.lastProtection) branch.protection = { ...this.lastProtection, source: this };
    return branch;
  }
  private async initialize() {
    await this.backend.run('readwrite', async tx => {
      const previous = await tx.get('meta', 'control');
      if (previous) { await readControl(tx); return; }
      if ((await Promise.all(STORE_NAMES.map(store => tx.count(store)))).some(count => count !== 0)) throw new Error('storage_corrupt');
      const at = this.clock();
      if (!Number.isSafeInteger(at) || at < 0) throw new Error('invalid_clock');
      const settings = defaultSettings(at);
      const control: Control = { key: 'control', accepted_release_id: this.options.releaseId, progress_schema: 1, db_version: 1, data_generation: this.uuid(), writer_id: this.tabId, writer_epoch: 1, state_revision: 0, active_session_id: null, update_gate: null, estimated_record_bytes: recordBytes(settings), attempt_count: 0 };
      await tx.put('meta', { key: 'settings', value: settings });
      await tx.put('meta', control);
    });
  }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.serial.then(() => { if (this.closed) throw new Error('storage_unavailable'); return operation(); });
    this.serial = next.catch(() => {});
    return next;
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() {
    // Ошибка подписчика не отменяет уже подтверждённую запись в БД.
    for (const listener of this.listeners) try { listener(); } catch (error) { queueMicrotask(() => { throw error; }); }
  }
  private connectionClosed() { this.closed = true; this.channel?.close(); this.channel = null; this.notify(); }
  get available() { return !this.closed; }
  get acceptsCommands() { return !this.closed && !this.detached; }
  private changed(control: Control) { this.channel?.postMessage({ type: 'changed', data_generation: control.data_generation, state_revision: control.state_revision }); this.notify(); }
  snapshot(): Promise<ProgressSnapshot> {
    return this.enqueue(() => this.backend.run('readonly', async tx => {
      const [control, meta, sessions, presentations, attempts, exposures, review_cards, bookmarks, legacy] = await Promise.all([readControl(tx), tx.all('meta'), tx.all('sessions'), tx.all('presentations'), tx.all('attempts'), tx.all('exposures'), tx.all('review_cards'), tx.all('bookmarks'), tx.all('legacy')]);
      const settings = meta.find(record => record.key === 'settings');
      if (!settings || settings.key !== 'settings') throw new Error('storage_corrupt');
      const snapshot = { control, settings: settings.value, sessions, presentations, attempts, exposures, review_cards, bookmarks, legacy, resume_positions: meta.flatMap(record => record.key !== 'control' && record.key !== 'settings' ? [record.value] : []) };
      try { integrity(snapshot); } catch { throw new Error('storage_corrupt'); }
      if (attempts.length !== control.attempt_count || (sessions.find(session => session.status === 'active')?.session_id ?? null) !== control.active_session_id || sessions.some(session => session.data_generation !== control.data_generation)) throw new Error('storage_corrupt');
      const pending = pendingAssessments(sessions).filter(session => session.assessment_help_opened_at === null);
      this.lastProtection = pending.length ? { generation: control.data_generation } : null;
      return snapshot;
    }));
  }
  async exportProgress(): Promise<Blob> {
    const snapshot = await this.snapshot();
    const { encodeExport } = await import('./transfer');
    return encodeExport(snapshot, appVersion, this.options.catalog.core.content_version, this.clock());
  }
  async previewImport(file: Blob, prepareContent?: (releaseIds: string[]) => Promise<void>): Promise<ImportPreview> {
    const sequence = ++this.importSequence; this.preparedImport = null;
    const [{ decodeImport }, { prepareProgress }] = await Promise.all([import('./transfer'), import('./import-content')]);
    const decoded = await decodeImport(file);
    await prepareContent?.([...new Set(decoded.data.sessions.map(session => session.release_id))]);
    if (sequence !== this.importSequence) throw new Error('invalid_preview');
    const data = prepareProgress(decoded, this.options.catalog, this.options.availableReleaseIds ?? [...new Set([this.options.releaseId, ...(this.options.catalogs?.keys() ?? [])])], this.clock(), this.options.catalogs);
    const snapshot = await this.snapshot();
    if (sequence !== this.importSequence) throw new Error('invalid_preview');
    const legacy_reasons: ImportPreview['legacy_reasons'] = { unknown_content_id: 0, unknown_grading_revision: 0, unknown_policy_version: 0, incompatible_draft: 0 };
    for (const record of data.legacy) legacy_reasons[record.reason]++;
    const preview: ImportPreview = { id: this.uuid(), recognized_lessons: new Set(data.sessions.flatMap(session => session.lesson_id ? [session.lesson_id] : [])).size, recognized_attempts: data.attempts.length, legacy_records: data.legacy.length, legacy_reasons, bookmarks: data.bookmarks.length, route: data.settings.selected_route, expected: replacementToken(snapshot) };
    this.preparedImport = { preview, data };
    return structuredClone(preview);
  }
  cancelImport() { this.importSequence++; this.preparedImport = null; }
  commitImport(id: string, confirmed: boolean): Promise<void> {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    const prepared = this.preparedImport;
    if (!confirmed) return Promise.reject(new Error('confirmation_required'));
    if (!prepared || prepared.preview.id !== id) return Promise.reject(new Error('invalid_preview'));
    const generation = this.uuid();
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      if (this.preparedImport !== prepared) throw new Error('invalid_preview');
      const control = await this.backend.run('readwrite', async tx => {
        const current = await readControl(tx); this.checkShell(current);
        checkReplacement(current, prepared.preview.expected, this.tabId);
        return replaceProgress(tx, current, prepared.data, generation, this.tabId);
      });
      this.lastProtection = pendingAssessments(prepared.data.sessions).some(session => session.assessment_help_opened_at === null) ? { generation: control.data_generation } : null;
      this.cancelImport(); this.changed(control);
    });
  }
  reset(expected: ReplacementToken, confirmed: boolean): Promise<void> {
    if (this.mode === 'memory') return Promise.reject(new Error('durable_reset_required'));
    return this.clearData(expected, confirmed);
  }
  discardMemory(expected: ReplacementToken, confirmed: boolean): Promise<void> {
    if (this.mode !== 'memory') return Promise.reject(new Error('not_memory'));
    return this.clearData(expected, confirmed);
  }
  async confirmDurableReset(recoveredSource?: ProgressRepository): Promise<void> {
    const protection = this.protection;
    if (!protection) return;
    const source = recoveredSource ?? protection.source;
    if (source.mode !== 'durable' || (source.options.name ?? 'iske-imla-progress') !== (protection.source.options.name ?? 'iske-imla-progress')) throw new Error('durable_reset_required');
    const snapshot = await source.snapshot();
    if (source.successfulResetGeneration !== snapshot.control.data_generation || pendingAssessments(snapshot.sessions).some(session => session.assessment_help_opened_at === null)) throw new Error('durable_reset_required');
    this.protection = null;
  }
  private clearData(expected: ReplacementToken, confirmed: boolean): Promise<void> {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    if (!confirmed) return Promise.reject(new Error('confirmation_required'));
    const token = structuredClone(expected); const generation = this.uuid(); const at = this.clock();
    const data: ProgressData = { settings: defaultSettings(at), sessions: [], presentations: [], attempts: [], exposures: [], review_cards: [], bookmarks: [], resume_positions: [], legacy: [] };
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      const control = await this.backend.run('readwrite', async tx => {
        const current = await readControl(tx); this.checkShell(current); checkReplacement(current, token, this.tabId);
        return replaceProgress(tx, current, data, generation, this.tabId);
      });
      if (this.mode === 'durable') this.successfulResetGeneration = control.data_generation;
      this.lastProtection = null;
      this.cancelImport(); this.changed(control);
    });
  }
  takeover(generation: string, epoch: number): Promise<void> {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      const control = await this.backend.run('readwrite', async tx => {
        const control = await readControl(tx); this.checkShell(control);
        if (control.data_generation !== generation || control.writer_epoch !== epoch) throw new Error('write_conflict');
        if (control.update_gate) throw new Error('update_in_progress');
        if (control.writer_id !== this.tabId) { control.writer_id = this.tabId; control.writer_epoch++; control.state_revision++; await tx.put('meta', control); }
        return control;
      });
      this.changed(control);
    });
  }
  private checkShell(control: Control) { if (control.accepted_release_id !== this.options.releaseId) throw new Error('release_not_current'); }
  private changeGate(expected: ReplacementToken, mutate: (control: Control, tx: Transaction) => Promise<void> | void, targetReader = false) {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    if (this.mode !== 'durable') return Promise.reject(new Error('update_memory_mode'));
    const token = structuredClone(expected);
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      const control = await this.backend.run('readwrite', async tx => {
        const control = await readControl(tx);
        if (!targetReader) this.checkShell(control);
        if (control.data_generation !== token.data_generation || control.writer_epoch !== token.writer_epoch || control.state_revision !== token.state_revision) throw new Error('write_conflict');
        await mutate(control, tx); control.state_revision++; await tx.put('meta', control); return control;
      });
      this.changed(control); return control;
    });
  }
  async beginUpdate(expected: ReplacementToken, targetReleaseId: string, purpose?: 'remove_offline'): Promise<UpdateGate> {
    const id = this.uuid(); const at = this.clock();
    if (!targetReleaseId || targetReleaseId.length > 256 || !Number.isSafeInteger(at) || at < 0 || at > 8_640_000_000_000_000) throw new Error('invalid_update');
    const control = await this.changeGate(expected, control => {
      if (control.writer_id !== this.tabId) throw new Error('write_conflict');
      if (control.update_gate) throw new Error('update_in_progress');
      if (purpose && (purpose !== 'remove_offline' || targetReleaseId !== control.accepted_release_id)) throw new Error('invalid_update');
      control.update_gate = { update_id: id, target_release_id: targetReleaseId, phase: 'quiescing', coordinator_id: this.tabId, requested_at: at, ...(purpose ? { purpose } : {}) };
    });
    return control.update_gate!;
  }
  private ownGate(control: Control, updateId: string) {
    if (control.writer_id !== this.tabId || control.update_gate?.coordinator_id !== this.tabId) throw new Error('write_conflict');
    if (control.update_gate.update_id !== updateId) throw new Error('stale_update');
    return control.update_gate;
  }
  async commitUpdate(expected: ReplacementToken, updateId: string) {
    await this.changeGate(expected, async (control, tx) => {
      const gate = this.ownGate(control, updateId);
      if (gate.purpose) throw new Error('invalid_update');
      if (gate.phase !== 'quiescing') throw new Error('update_already_committed');
      if (control.active_session_id !== null || (await tx.unfinishedSessions()).some(session => session.status === 'active')) throw new Error('update_not_quiet');
      gate.phase = 'commit';
    });
  }
  async cancelUpdate(expected: ReplacementToken, updateId: string) {
    await this.changeGate(expected, control => {
      if (this.ownGate(control, updateId).phase !== 'quiescing') throw new Error('update_already_committed');
      control.update_gate = null;
    });
  }
  async finishUpdate(expected: ReplacementToken, updateId: string) {
    await this.changeGate(expected, control => {
      const gate = control.update_gate;
      if (!gate || gate.update_id !== updateId || gate.phase !== 'commit') throw new Error('stale_update');
      if (this.options.releaseId !== gate.target_release_id) throw new Error('unsupported_release');
      control.accepted_release_id = gate.target_release_id; control.update_gate = null;
    }, true);
  }
  async recoverUpdate(expected: ReplacementToken, updateId: string, confirmed: boolean) {
    if (!confirmed) throw new Error('confirmation_required');
    await this.changeGate(expected, control => {
      if (control.update_gate?.update_id !== updateId) throw new Error('stale_update');
      if (![control.accepted_release_id, control.update_gate.target_release_id].includes(this.options.releaseId)) throw new Error('release_not_current');
      control.writer_id = this.tabId; control.writer_epoch++; control.update_gate.coordinator_id = this.tabId;
    }, true);
  }
  catalogForRelease(id: string): ContentCatalog {
    const catalog = id === this.options.releaseId ? this.options.catalog : this.options.catalogs?.get(id);
    if (!catalog) throw new Error('content_unavailable'); return catalog;
  }
  dispatch(command: Command, expected: Expected, contentReleaseId = this.options.releaseId): Promise<CommandResult> {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    const captured = structuredClone(command); const token = structuredClone(expected); const at = this.clock();
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      if (!Number.isSafeInteger(at) || at < 0) throw new Error('invalid_clock');
      // Сетевое ожидание модуля завершается до открытия IDB-транзакции.
      const { CommandEngine } = await import('./engine');
      if (this.closed) throw new Error('storage_unavailable');
      if (this.detached) throw new Error('repository_detached');
      const committed = await this.backend.run('readwrite', async tx => {
        const control = await readControl(tx); this.checkShell(control);
        const helpObservation = captured.type === 'help' && (captured.kind !== 'reveal' || (await tx.get('presentations', captured.presentation_id))?.status === 'submitted');
        const observation = captured.type === 'observe' || captured.type === 'show' || helpObservation;
        if (control.data_generation !== token.data_generation || !observation && (control.writer_epoch !== token.writer_epoch || control.writer_id !== this.tabId)) throw new Error('write_conflict');
        if (control.update_gate?.phase === 'commit' || control.update_gate?.phase === 'quiescing' && !(observation && token.update_id === null) && !['draft', 'pause', 'position'].includes(captured.type)) throw new Error('update_in_progress');
        const context = new WriteContext(tx, control, token, observation);
        const sessionId = 'session_id' in captured ? captured.session_id : 'presentation_id' in captured ? (await tx.get('presentations', captured.presentation_id))?.session_id : undefined;
        const session = sessionId ? await tx.get('sessions', sessionId) : undefined;
        const requestedId = session?.release_id ?? (['observe', 'bookmark', 'position', 'read_complete'].includes(captured.type) ? contentReleaseId : this.options.releaseId);
        const source = requestedId === this.options.releaseId ? this.options.catalog : this.options.catalogs?.get(requestedId);
        if (!source && !session) throw new Error('content_unavailable');
        const engine = new CommandEngine(context, source ?? this.options.catalog, this.options.currentCore ?? this.options.catalog.core, source ? requestedId : this.options.releaseId, at, this.uuid, this.options.catalogs);
        const result = await engine.execute(captured);
        await context.finish(captured.type !== 'settings', this.mode === 'durable');
        if (this.mode === 'memory' && context.disclosure && this.protection) {
          // Ожидание допустимо только в транзакции памяти; durable-транзакция здесь ещё не открыта.
          const confirmed = 'confirm_assessment_help' in captured && captured.confirm_assessment_help === true;
          await this.protectDurableHelp(this.protection, confirmed, at);
          this.protection = null;
        }
        const pending = pendingAssessments(await tx.unfinishedSessions()).some(session => session.assessment_help_opened_at === null);
        return { result: { ...result, expected: context.nextExpected() }, control, dirty: context.dirty, pending };
      });
      this.lastProtection = committed.pending ? { generation: committed.control.data_generation } : null;
      if (committed.dirty) this.changed(committed.control);
      return committed.result;
    });
  }
  private async protectDurableHelp(protection: DurableProtection, confirmed: boolean, at: number) {
    let transient: Backend | null = null;
    try {
      const backend = protection.source.available ? protection.source.backend : transient = await IndexedBackend.open(protection.source.options.name ?? 'iske-imla-progress');
      const committed = await backend.run('readwrite', async tx => {
        const control = await readControl(tx);
        if (control.data_generation !== protection.generation) throw new Error('write_conflict');
        if (control.update_gate) throw new Error('update_in_progress');
        protection.source.checkShell(control);
        const pending = await tx.unfinishedSessions();
        const needsHelp = pendingAssessments(pending).filter(session => session.assessment_help_opened_at === null);
        if (needsHelp.length && !confirmed) throw new Error('assessment_help_confirmation_required');
        const context = new WriteContext(tx, control, { data_generation: protection.generation, writer_epoch: control.writer_epoch, revisions: [] }, true);
        for (const session of markAssessmentHelp(pending, at)) await context.put('sessions', session);
        await context.finish(true);
        return { control, dirty: context.dirty };
      });
      protection.source.lastProtection = null;
      if (committed.dirty) protection.source.changed(committed.control);
    } catch (error) {
      if (error instanceof Error && ['assessment_help_confirmation_required', 'write_conflict', 'update_in_progress'].includes(error.message)) throw error;
      throw new Error('durable_help_required');
    } finally { transient?.close(); }
  }
  close() { this.closed = true; this.channel?.close(); this.channel = null; this.listeners.clear(); this.backend.close(); }
}
