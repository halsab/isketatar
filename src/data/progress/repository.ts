import type { ContentCatalog } from '../../domain/content/catalog';
import type { CoreData } from '../../domain/content/types';
import { defaultSettings, recordBytes, STORE_NAMES } from './model';
import type { Control, Expected, ImportPreview, ProgressData, ProgressSnapshot, ReplacementToken } from './model';
import { IndexedBackend } from './backend';
import type { Backend } from './backend';
import { readControl, WriteContext } from './transaction';
import { CommandEngine } from './engine';
import type { CommandResult } from './engine';
import type { Command } from './commands';
import { observe } from './observation';
import { bookmarkCommand, markReadingComplete, positionCommand, settingsCommand, validateReviewOrigin } from './preferences';
import { decodeImport, encodeExport, replacementToken } from './transfer';
import { prepareProgress } from './import-content';
import { checkReplacement, replaceProgress } from './replacement';
import { integrity } from './import-integrity';
import packageInfo from '../../../package.json';
import { MemoryBackend } from './memory-backend';
import { exportData } from './transfer';
import { markAssessmentHelp, pendingAssessments } from '../../domain/learning/attempt';

interface Options { catalog: ContentCatalog; currentCore?: CoreData; releaseId: string; availableReleaseIds?: string[]; tabId?: string; name?: string; clock?: () => number; uuid?: () => string }
interface KnownProtection { generation: string }
interface DurableProtection extends KnownProtection { source: ProgressRepository }
export function expectedFrom(snapshot: ProgressSnapshot): Expected {
  const unfinished = snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status));
  const ids = new Set(unfinished.map(session => session.session_id));
  return { data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch, revisions: [
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
      const control: Control = { key: 'control', progress_schema: 1, db_version: 1, data_generation: this.uuid(), writer_id: this.tabId, writer_epoch: 1, state_revision: 0, active_session_id: null, update_gate: null, estimated_record_bytes: recordBytes(settings), attempt_count: 0 };
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
    return encodeExport(snapshot, packageInfo.version, this.options.catalog.core.content_version, this.clock());
  }
  async previewImport(file: Blob): Promise<ImportPreview> {
    const sequence = ++this.importSequence; this.preparedImport = null;
    const decoded = await decodeImport(file);
    const data = prepareProgress(decoded, this.options.catalog, this.options.availableReleaseIds ?? [this.options.releaseId], this.clock());
    const snapshot = await this.snapshot();
    if (sequence !== this.importSequence) throw new Error('invalid_preview');
    const preview: ImportPreview = { id: this.uuid(), recognized_attempts: data.attempts.length, legacy_records: data.legacy.length, bookmarks: data.bookmarks.length, route: data.settings.selected_route, expected: replacementToken(snapshot) };
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
        const current = await readControl(tx);
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
        const current = await readControl(tx); checkReplacement(current, token, this.tabId);
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
        const control = await readControl(tx);
        if (control.data_generation !== generation || control.writer_epoch !== epoch) throw new Error('write_conflict');
        if (control.update_gate) throw new Error('update_in_progress');
        if (control.writer_id !== this.tabId) { control.writer_id = this.tabId; control.writer_epoch++; control.state_revision++; await tx.put('meta', control); }
        return control;
      });
      this.changed(control);
    });
  }
  dispatch(command: Command, expected: Expected): Promise<CommandResult> {
    if (this.detached) return Promise.reject(new Error('repository_detached'));
    const captured = structuredClone(command); const token = structuredClone(expected); const at = this.clock();
    return this.enqueue(async () => {
      if (this.detached) throw new Error('repository_detached');
      if (!Number.isSafeInteger(at) || at < 0) throw new Error('invalid_clock');
      const committed = await this.backend.run('readwrite', async tx => {
        const control = await readControl(tx);
        const helpObservation = captured.type === 'help' && (captured.kind !== 'reveal' || (await tx.get('presentations', captured.presentation_id))?.status === 'submitted');
        const observation = captured.type === 'observe' || captured.type === 'show' || helpObservation;
        if (control.data_generation !== token.data_generation || !observation && (control.writer_epoch !== token.writer_epoch || control.writer_id !== this.tabId)) throw new Error('write_conflict');
        if (control.update_gate?.phase === 'commit' || control.update_gate?.phase === 'quiescing' && !observation && !['draft', 'pause'].includes(captured.type)) throw new Error('update_in_progress');
        const context = new WriteContext(tx, control, token, observation);
        const engine = new CommandEngine(context, this.options.catalog, this.options.currentCore ?? this.options.catalog.core, this.options.releaseId, at, this.uuid);
        const result = await this.execute(engine, captured);
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
        if (control.update_gate?.phase === 'commit') throw new Error('update_in_progress');
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
  private async execute(engine: CommandEngine, command: Command): Promise<CommandResult> {
    switch (command.type) {
      case 'start': return engine.start(command);
      case 'pause': case 'resume': return engine.pauseResume(command.session_id, command.type === 'resume');
      case 'show': return engine.show(command.presentation_id, command.confirm_assessment_help);
      case 'draft': return engine.draft(command.presentation_id, command.answer);
      case 'submit': return engine.submit(command.presentation_id, command.answer, false, command.confirm_assessment_help);
      case 'finish_assessment': return engine.finishAssessment(command);
      case 'ack': case 'retry': return engine.ack(command.presentation_id, command.type === 'retry');
      case 'skip': return engine.skip(command.presentation_id);
      case 'navigate_question': return engine.navigate(command.session_id, command.question_id);
      case 'help': return engine.help(command);
      case 'observe': return observe(engine, command.target, command.confirm_assessment_help);
      case 'read_complete': return markReadingComplete(engine, command.reading_id);
      case 'review_add': await validateReviewOrigin(engine, command); return engine.reviewAdd(command);
      case 'settings': return settingsCommand(engine, command);
      case 'bookmark': return bookmarkCommand(engine, command);
      case 'position': return positionCommand(engine, command);
      case 'review_suspend': {
        const card = await engine.tx.get('review_cards', command.question_id);
        if (!card) throw new Error('unknown_review_card');
        if (card.status === 'active') await engine.context.put('review_cards', { ...card, status: 'suspended', revision: card.revision + 1, updated_at: engine.at });
        return {};
      }
    }
  }
  close() { this.closed = true; this.channel?.close(); this.channel = null; this.listeners.clear(); this.backend.close(); }
}
