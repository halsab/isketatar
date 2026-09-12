import { ContentRepository } from '../data/content/repository';
import { ProgressRepository } from '../data/progress/repository';
import type { Expected, ProgressSnapshot, ReplacementToken, UpdateGate } from '../data/progress/model';
import { expectedFrom } from '../data/progress/repository';
import { replacementToken } from '../data/progress/transfer';
import type { Command } from '../data/progress/commands';
import { applyPreferences } from '../ui/preferences';
import { POLICIES } from '../domain/content/types';
import type { ContentCatalog } from '../domain/content/catalog';
import { currentReleaseId, readerSupported } from './release';
import { tabIdentity } from './tab-identity';

export interface AppState { phase: 'loading' | 'ready' | 'error' | 'storage_error'; snapshot: ProgressSnapshot | null; error: string | null; mode: 'durable' | 'memory'; editorRevision: number; recoveryText: string | null; quiescing: string | null; acceptedShell: string | null }
export type UpdatePreparation = UpdateGate & { data_generation: string; writer_epoch: number };
export interface UpdateReady { tab_id: string; release_id: string; mode: 'durable' | 'memory'; closed: boolean; memory_loss_accepted: boolean }
export interface CommandScope { repository: ProgressRepository; expected: Expected; contentReleaseId?: string }
export interface ActiveEditor {
  readonly dirty: boolean; flush(): Promise<void>; leave(): Promise<void>;
  readonly composingInput: boolean; beginUpdate(): void; cancelUpdate(): void;
  suspend(): Promise<void>;
  prepareUpdate(): Promise<void>;
  prepareMemory(): Promise<{ text: string; restore: (branch: ProgressRepository) => Promise<boolean> }>;
}
export const errorCode = (error: unknown) => error instanceof Error ? error.message : 'storage_unavailable';
export class AppRuntime {
  content: ContentRepository | null = null;
  progress: ProgressRepository | null = null;
  releaseId = '';
  private readonly contents = new Map<string, ContentRepository>();
  private readonly catalogs = new Map<string, ContentCatalog>();
  private readonly loadingReleases = new Map<string, Promise<ContentRepository>>();
  private tabId = '';
  private opening: Promise<void> | null = null;
  private stopListening: (() => void) | null = null;
  private switching: Promise<void> | null = null;
  private readonly pendingCommands = new Set<Promise<unknown>>();
  private preparedUpdate: UpdatePreparation | null = null;
  private preparation: { request: UpdatePreparation; promise: Promise<UpdateReady> } | null = null;
  private preparationReady = false;
  private cancellation: Promise<void> | null = null;
  private closedForUpdate = false;
  private memorySource: ProgressRepository | null = null;
  private memoryLossAccepted: string | null = null;
  private positionCollector: { scope: CommandScope; read: () => Extract<Command, { type: 'position' }> | null } | null = null;
  editor: ActiveEditor | null = null;
  registerEditor(editor: ActiveEditor) { this.editor = editor; if (this.state.quiescing) editor.beginUpdate(); return () => { if (this.editor === editor) this.editor = null; }; }
  private state: AppState = { phase: 'loading', snapshot: null, error: null, mode: 'durable', editorRevision: 0, recoveryText: null, quiescing: null, acceptedShell: null };
  private readonly listeners = new Set<() => void>();
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AppState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  start(): Promise<void> {
    if (this.state.quiescing) return Promise.reject(new Error('update_in_progress'));
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = null; });
    return this.opening;
  }
  private async open() {
    this.publish({ phase: 'loading', error: null });
    try {
      if (!this.content) {
        const [content, releaseId, tabId] = await Promise.all([ContentRepository.open(), currentReleaseId(), tabIdentity()]);
        this.content = content; this.releaseId = releaseId; this.tabId = tabId; this.contents.set(releaseId, content); this.catalogs.set(releaseId, content.catalog);
      }
      if (!this.progress || !this.progress.acceptsCommands) {
        if (import.meta.env.PROD) {
          const { offline } = await import('../data/pwa/client');
          offline.bind({ identify: () => this.updateIdentity(), prepare: (request, discard) => this.prepareUpdate(request, discard), commit: request => this.commitReleaseUpdate(request), cancel: request => this.cancelReleaseUpdate(request), cancelled: id => this.cancelPreparation(id), reconcile: () => this.reconcileUpdate() });
          await (await import('./bootstrap')).prepareBoot(this.releaseId);
        }
        const progress = await ProgressRepository.open({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId, tabId: this.tabId });
        if (import.meta.env.PROD) {
          try { const gate = await (await import('./bootstrap')).finishBoot(this.releaseId, progress); this.publish({ quiescing: gate?.update_id ?? null }); }
          catch (error) { progress.close(); throw error; }
        }
        this.attach(progress);
      }
      await this.refresh();
    } catch (error) { this.publish({ phase: errorCode(error) === 'release_not_current' ? 'error' : this.content ? 'storage_error' : 'error', error: errorCode(error), acceptedShell: error && typeof error === 'object' && typeof Reflect.get(error, 'accepted') === 'string' ? Reflect.get(error, 'accepted') : null }); }
  }
  private attach(progress: ProgressRepository) {
    this.stopListening?.();
    this.progress = progress;
    this.stopListening = progress.subscribe(() => { void this.refresh().catch(() => {}); });
  }
  async refresh(): Promise<void> {
    if (this.closedForUpdate) return;
    const progress = this.progress;
    if (!progress) throw new Error('storage_unavailable');
    try {
      const snapshot = await progress.snapshot();
      if (this.progress !== progress) return;
      applyPreferences(snapshot.settings);
      this.publish({ phase: 'ready', snapshot, mode: progress.mode });
    } catch (error) { if (this.progress === progress) this.publish({ error: errorCode(error), phase: this.state.snapshot ? 'ready' : 'storage_error' }); throw error; }
  }
  async command(command: Command, scope: CommandScope) {
    if (this.state.quiescing) throw new Error('update_in_progress');
    const pending = this.executeCommand(command, scope); this.pendingCommands.add(pending);
    try { return await pending; } finally { this.pendingCommands.delete(pending); }
  }
  private async executeCommand(command: Command, scope: CommandScope) {
    const progress = scope.repository;
    if (progress !== this.progress) throw new Error('write_conflict');
    try {
      const content = this.content!;
      const snapshot = await progress.snapshot();
      const sessionId = 'session_id' in command ? command.session_id : 'presentation_id' in command ? snapshot.presentations.find(item => item.presentation_id === command.presentation_id)?.session_id : undefined;
      const session = snapshot.sessions.find(item => item.session_id === sessionId);
      const questions = async (source: ContentRepository, ids: string[]) => {
        const missing = ids.filter(id => !source.catalog.questions.has(id));
        if (missing.length) await source.questions(missing);
      };
      if (session && command.type !== 'leave_historical') {
        const source = await this.contentForRelease(session.release_id);
        await questions(source, session.question_plan.map(item => item.question_id));
        if (session.reading_ids.some(id => !source.catalog.readings.has(id))) await source.load('readings.json');
      }
      if (command.type === 'start') {
        if (command.kind === 'lesson_cycle') await questions(content, content.catalog.lessonPlan(command.lesson_id!).map(item => item.id));
        else if (command.kind === 'reading_practice') { if (!content.catalog.readings.has(command.reading_id!)) await content.load('readings.json'); await questions(content, content.catalog.readings.get(command.reading_id!)!.question_ids); }
        else if (command.kind === 'diagnostic' || command.kind === 'final') await questions(content, command.kind === 'diagnostic' ? content.catalog.core.diagnostic_ids : content.catalog.core.final_ids);
        else await questions(content, snapshot.review_cards.filter(card => card.status === 'active').map(card => card.question_id));
      }
      if (command.type === 'review_add') await questions(content, [command.question_id]);
      if (command.type === 'help' || command.type === 'observe') {
        const pending = new Map(snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status) && !['diagnostic', 'final'].includes(session.kind)).map(session => [session.session_id, session]));
        const groups = new Map<string, string[]>();
        for (const item of snapshot.presentations) {
          const session = pending.get(item.session_id);
          if (!session || item.status !== 'draft' || session.kind !== 'reading_practice' && (item.shown_at === null || session.active_presentation_id !== item.presentation_id)) continue;
          const ids = groups.get(session.release_id) ?? []; ids.push(item.question_id); groups.set(session.release_id, ids);
        }
        for (const [id, ids] of groups) { const source = await this.contentForRelease(id); const missing = [...new Set(ids)].filter(id => !source.catalog.questions.has(id)); if (missing.length) await source.questions(missing); }
      }
      if (progress !== this.progress) throw new Error('write_conflict');
      const result = await progress.dispatch(command, scope.expected, scope.contentReleaseId);
      if (progress !== this.progress) throw new Error('write_conflict');
      await this.refresh(); return result;
    } catch (error) { if (progress === this.progress) this.publish({ error: errorCode(error) }); throw error; }
  }
  clearError() { this.publish({ error: null }); }
  async retry() {
    if (this.state.quiescing) throw new Error('update_in_progress');
    if (!this.content) return this.start();
    await this.editor?.suspend();
    try {
      if (!this.progress?.acceptsCommands) this.attach(await ProgressRepository.open({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId, tabId: this.tabId }));
      await this.refresh(); this.publish({ editorRevision: this.state.editorRevision + 1, error: null });
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async takeover(progress: ProgressRepository, expected: ReplacementToken) {
    if (this.state.quiescing) throw new Error('update_in_progress');
    if (progress !== this.progress) throw new Error('write_conflict');
    try { await this.editor?.suspend(); await progress.takeover(expected.data_generation, expected.writer_epoch); await this.refresh(); this.publish({ editorRevision: this.state.editorRevision + 1, error: null }); }
    catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async refreshAfterReplacement(progress: ProgressRepository) {
    if (progress !== this.progress) throw new Error('write_conflict');
    await this.refresh();
    if (progress !== this.progress) throw new Error('write_conflict');
    this.publish({ error: null, recoveryText: null, editorRevision: this.state.editorRevision + 1 });
  }
  useMemory(): Promise<void> {
    if (this.state.quiescing) return Promise.reject(new Error('update_in_progress'));
    if (!this.switching) this.switching = this.switchToMemory().finally(() => { this.switching = null; });
    return this.switching;
  }
  private async switchToMemory() {
    if (!this.content) throw new Error('content_unavailable');
    if (this.progress?.mode === 'memory') return;
    try {
      const recovery = await this.editor?.prepareMemory();
      const branch = this.progress ? await this.progress.branchToMemory() : await ProgressRepository.memory({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId });
      this.memorySource = this.progress;
      let restored = !recovery;
      try { restored = await recovery?.restore(branch) ?? true; } catch { /* Исходный ввод остаётся отдельно от пустой или частично восстановленной ветви. */ }
      this.attach(branch); await this.refresh(); this.publish({ error: null, recoveryText: restored ? this.state.recoveryText : recovery!.text });
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  contentForRelease(id: string): Promise<ContentRepository> {
    const existing = this.contents.get(id); if (existing) return Promise.resolve(existing);
    const pending = this.loadingReleases.get(id); if (pending) return pending;
    const task = (async () => {
      const { offline } = await import('../data/pwa/client'); await offline.start(this.releaseId);
      const { manifest } = await offline.retainedManifest(id);
      if (manifest.content_schema !== 1 || manifest.progress_schema !== 1 || !readerSupported(manifest.min_reader_version) || Object.entries(POLICIES).some(([key, value]) => Reflect.get(manifest.policy_versions, key) !== value)) throw new Error('unsupported_release');
      const content = await ContentRepository.open(manifest);
      if (content.catalog.core.content_version !== manifest.content_version) throw new Error('content_corrupt');
      this.contents.set(id, content); this.catalogs.set(id, content.catalog); return content;
    })().finally(() => this.loadingReleases.delete(id));
    this.loadingReleases.set(id, task); return task;
  }
  async loadAllContent(releaseIds: string[] = []) {
    if (!this.content) throw new Error('content_unavailable');
    const sources = new Set([this.content]);
    if (import.meta.env.PROD) {
      const { offline } = await import('../data/pwa/client'); await offline.start(this.releaseId);
      const previous = offline.getState().registry?.previous_release_id;
      if (previous && releaseIds.includes(previous)) {
        try { sources.add(await this.contentForRelease(previous)); }
        catch (error) { if (!(error instanceof Error && error.message === 'unsupported_release')) throw error; }
      }
    }
    await Promise.all([...sources].flatMap(content => [...new Set(content.catalog.core.lessons.map(lesson => lesson.resource)), 'readings.json', 'dictionary.json', 'references.json', 'assessments.json'].map(resource => content.load(resource))));
  }
  registerPosition(scope: CommandScope, read: () => Extract<Command, { type: 'position' }> | null) {
    const collector = { scope, read }; this.positionCollector = collector;
    return () => { if (this.positionCollector === collector) this.positionCollector = null; };
  }
  private checkPreparation(snapshot: ProgressSnapshot, request: UpdatePreparation) {
    const { control } = snapshot; const gate = control.update_gate;
    if (control.data_generation !== request.data_generation || control.writer_epoch !== request.writer_epoch || control.writer_id !== request.coordinator_id || gate?.update_id !== request.update_id || gate.target_release_id !== request.target_release_id || gate.coordinator_id !== request.coordinator_id || gate.purpose !== request.purpose) throw new Error('stale_update');
  }
  updateIdentity() { return { tab_id: this.tabId, release_id: this.releaseId, mode: this.progress?.mode ?? 'durable' }; }
  async beginReleaseUpdate(target: string, expected: ReplacementToken, purpose?: 'remove_offline'): Promise<UpdatePreparation> {
    const repository = this.progress;
    if (!repository || repository.mode !== 'durable') throw new Error('update_memory_mode');
    if (this.state.quiescing) throw new Error('update_in_progress');
    const snapshot = await repository.snapshot();
    if (snapshot.control.data_generation !== expected.data_generation || snapshot.control.writer_epoch !== expected.writer_epoch || snapshot.control.writer_id !== repository.tabId) throw new Error('write_conflict');
    const gate = await repository.beginUpdate(replacementToken(snapshot), target, purpose);
    this.publish({ quiescing: gate.update_id }); this.editor?.beginUpdate();
    await this.refresh(); return { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
  }
  async commitReleaseUpdate(request: UpdatePreparation) {
    const repository = this.progress;
    if (!repository || repository.mode !== 'durable' || request.coordinator_id !== repository.tabId || this.preparedUpdate?.update_id !== request.update_id || !this.preparationReady) throw new Error('update_not_ready');
    const snapshot = await repository.snapshot(); this.checkPreparation(snapshot, request);
    if (snapshot.control.update_gate?.phase === 'quiescing') await repository.commitUpdate(replacementToken(snapshot), request.update_id);
    await this.closeForUpdate(request.update_id); return { closed: true };
  }
  async cancelReleaseUpdate(request: UpdatePreparation) {
    const repository = this.progress;
    if (!repository || repository.mode !== 'durable') throw new Error('update_not_coordinator');
    const snapshot = await repository.snapshot(); this.checkPreparation(snapshot, request);
    await repository.cancelUpdate(replacementToken(snapshot), request.update_id);
    if (this.preparedUpdate) await this.cancelPreparation(request.update_id);
    else { this.editor?.cancelUpdate(); this.publish({ quiescing: null }); await this.refresh(); }
  }
  async recoverReleaseUpdate(updateId: string, confirmed: boolean): Promise<UpdatePreparation> {
    if (!confirmed) throw new Error('confirmation_required');
    const previous = this.progress;
    if (!previous || previous.mode !== 'durable') throw new Error('update_memory_mode');
    if (this.editor?.dirty) throw new Error(this.editor.composingInput ? 'composition_in_progress' : 'draft_not_saved');
    await this.editor?.suspend(); previous.close();
    const reopened = await ProgressRepository.open({ ...previous.options, tabId: previous.tabId });
    try {
      const before = await reopened.snapshot();
      await reopened.recoverUpdate(replacementToken(before), updateId, true);
      const snapshot = await reopened.snapshot(); const gate = snapshot.control.update_gate!;
      this.attach(reopened); this.closedForUpdate = false; this.preparedUpdate = null; this.preparation = null; this.preparationReady = false;
      // После явной смены epoch старые очереди привязаны к закрытому repository и не входят в новый раунд.
      this.pendingCommands.clear();
      this.publish({ quiescing: updateId, editorRevision: this.state.editorRevision + 1 });
      await this.refresh(); return { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch };
    } catch (error) { reopened.close(); throw error; }
  }
  prepareUpdate(request: UpdatePreparation, discardMemory = false): Promise<UpdateReady> {
    if (this.preparation) {
      const previous = this.preparation.request;
      if (['update_id', 'target_release_id', 'coordinator_id', 'data_generation', 'writer_epoch', 'purpose'].some(key => Reflect.get(previous, key) !== Reflect.get(request, key))) return Promise.reject(new Error('stale_update'));
      return this.preparation.promise;
    }
    const captured = structuredClone(request);
    const waitingMemory = this.progress?.mode === 'memory' && !request.purpose && !discardMemory && this.memoryLossAccepted !== request.update_id;
    const prior = this.state.quiescing;
    if (!waitingMemory && (!prior || prior === request.update_id)) { this.publish({ quiescing: request.update_id }); this.editor?.beginUpdate(); }
    const promise = this.performPreparation(captured, discardMemory).finally(() => {
      if (this.preparation?.promise === promise) this.preparation = null;
      if (!prior && this.preparedUpdate?.update_id !== captured.update_id && this.state.quiescing === captured.update_id) { this.publish({ quiescing: null }); this.editor?.cancelUpdate(); }
    });
    this.preparation = { request: captured, promise }; return promise;
  }
  private async performPreparation(request: UpdatePreparation, discardMemory: boolean): Promise<UpdateReady> {
    if (!this.progress) throw new Error('storage_unavailable');
    if (this.progress.mode === 'memory' && !request.purpose && !discardMemory && this.memoryLossAccepted !== request.update_id) throw new Error('update_memory_mode');
    if (this.preparedUpdate && this.preparedUpdate.update_id !== request.update_id) {
      const source = this.progress.mode === 'memory' ? this.memorySource : this.progress;
      if (!source) throw new Error('storage_unavailable');
      const probe = await ProgressRepository.open({ ...source.options, tabId: source.tabId });
      try { this.checkPreparation(await probe.snapshot(), request); } finally { probe.close(); }
      await this.cancelPreparation(this.preparedUpdate.update_id);
      this.publish({ quiescing: request.update_id }); this.editor?.beginUpdate();
    }
    if (this.closedForUpdate) {
      if (!this.preparedUpdate || this.preparedUpdate.data_generation !== request.data_generation || this.preparedUpdate.writer_epoch > request.writer_epoch || this.preparedUpdate.target_release_id !== request.target_release_id) throw new Error('stale_update');
      const previous = this.progress.mode === 'memory' ? this.memorySource : this.progress;
      if (!previous) throw new Error('storage_unavailable');
      const probe = await ProgressRepository.open({ ...previous.options, tabId: previous.tabId });
      try { const snapshot = await probe.snapshot(); this.checkPreparation(snapshot, request); if (this.progress.mode === 'durable') this.publish({ snapshot }); } finally { probe.close(); }
      this.preparedUpdate = structuredClone(request);
      return { tab_id: this.tabId, release_id: this.releaseId, mode: this.progress.mode, closed: true, memory_loss_accepted: this.memoryLossAccepted === request.update_id };
    }
    const progress = this.progress;
    if (progress.mode === 'memory' && this.memorySource && !this.memorySource.available) this.memorySource = await ProgressRepository.open({ ...this.memorySource.options, tabId: this.memorySource.tabId });
    const source = progress.mode === 'memory' ? this.memorySource : progress;
    if (!source) throw new Error('storage_unavailable');
    this.checkPreparation(await source.snapshot(), request);
    if (progress.mode === 'memory' && discardMemory) this.memoryLossAccepted = request.update_id;
    this.preparationReady = false; this.preparedUpdate = structuredClone(request);
    await Promise.allSettled([...this.pendingCommands]);
    const admitted = await source.snapshot(); this.checkPreparation(admitted, request);
    await this.editor?.prepareUpdate();
    let snapshot = await progress.snapshot();
    if (progress !== this.progress) throw new Error('write_conflict');
    this.checkPreparation(await source.snapshot(), request);
    const collector = this.positionCollector; const position = collector?.read();
    if (snapshot.control.writer_id === progress.tabId && admitted.control.update_gate?.phase === 'quiescing') {
      const active = snapshot.sessions.find(session => session.status === 'active');
      if (active) await this.executeCommand({ type: 'pause', session_id: active.session_id }, { repository: progress, expected: expectedFrom(snapshot) });
      if (position && collector && collector.scope.repository === progress && collector.scope.expected.data_generation === snapshot.control.data_generation && collector.scope.expected.writer_epoch === snapshot.control.writer_epoch) {
        snapshot = await progress.snapshot();
        // Свежие revisions относятся только к явной операции подготовки, после проверки исходного поколения и epoch.
        await progress.dispatch(position, expectedFrom(snapshot), collector.scope.contentReleaseId);
      }
    }
    snapshot = await progress.snapshot(); const durable = await source.snapshot(); this.checkPreparation(durable, request);
    this.preparationReady = true; this.publish({ snapshot });
    const coordinator = progress.mode === 'durable' && request.coordinator_id === progress.tabId;
    const closed = !coordinator || durable.control.update_gate?.phase === 'commit';
    if (closed) { this.closedForUpdate = true; source.close(); }
    return { tab_id: this.tabId, release_id: this.releaseId, mode: progress.mode, closed, memory_loss_accepted: this.memoryLossAccepted === request.update_id };
  }
  async closeForUpdate(updateId: string) {
    if (!this.progress || this.preparedUpdate?.update_id !== updateId) throw new Error('stale_update');
    if (!this.preparationReady) throw new Error('update_not_ready');
    if (this.closedForUpdate) return;
    const snapshot = await this.progress.snapshot(); this.checkPreparation(snapshot, this.preparedUpdate);
    if (snapshot.control.update_gate?.phase !== 'commit') throw new Error('update_not_committed');
    this.publish({ snapshot });
    this.closedForUpdate = true; this.progress.close();
  }
  async cancelPreparation(updateId: string): Promise<void> {
    if (this.cancellation) { await this.cancellation; return this.cancelPreparation(updateId); }
    const pending = this.performCancellation(updateId); this.cancellation = pending;
    try { await pending; } finally { if (this.cancellation === pending) this.cancellation = null; }
  }
  async reconcileUpdate(): Promise<string | null> {
    const id = this.state.quiescing;
    if (!id || this.preparation) return null;
    try { await this.cancelPreparation(id); return this.state.quiescing !== id ? id : null; }
    catch (error) { if (['update_in_progress', 'release_not_current'].includes(errorCode(error))) return null; throw error; }
  }
  private async performCancellation(updateId: string) {
    if (!this.progress) throw new Error('storage_unavailable');
    if (this.preparedUpdate?.update_id !== updateId && this.state.quiescing !== updateId) return;
    const previous = this.progress;
    const source = previous.mode === 'memory' ? this.memorySource : previous;
    if (!source) throw new Error('storage_unavailable');
    const reopened = source.available ? source : await ProgressRepository.open({ ...source.options, tabId: source.tabId });
    const snapshot = await reopened.snapshot();
    if (snapshot.control.accepted_release_id !== this.releaseId) { if (reopened !== source) reopened.close(); throw new Error('release_not_current'); }
    if (snapshot.control.update_gate?.update_id === updateId) { if (reopened !== source) reopened.close(); throw new Error('update_in_progress'); }
    const keepEditor = previous.mode === 'memory' || reopened === source;
    const recovery = !keepEditor && this.editor?.dirty ? await this.editor.prepareMemory() : null;
    if (keepEditor) this.editor?.cancelUpdate(); else await this.editor?.suspend();
    if (previous.mode === 'memory') { reopened.close(); this.memorySource = reopened; } else this.attach(reopened);
    this.closedForUpdate = false; this.preparedUpdate = null; this.memoryLossAccepted = null; this.preparationReady = false;
    const next = previous.mode === 'durable' ? snapshot.control.update_gate?.update_id ?? null : null;
    this.publish({ quiescing: next, error: null, editorRevision: this.state.editorRevision + (keepEditor ? 0 : 1), recoveryText: recovery?.text ?? this.state.recoveryText });
    if (next) this.editor?.beginUpdate();
    await this.refresh();
  }
}
