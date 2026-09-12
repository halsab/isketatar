import { ContentRepository } from '../data/content/repository';
import { ProgressRepository } from '../data/progress/repository';
import type { Expected, ProgressSnapshot, ReplacementToken } from '../data/progress/model';
import type { Command } from '../data/progress/commands';
import { applyPreferences } from '../ui/preferences';
import { currentReleaseId } from './release';
import { tabIdentity } from './tab-identity';

export interface AppState { phase: 'loading' | 'ready' | 'error' | 'storage_error'; snapshot: ProgressSnapshot | null; error: string | null; mode: 'durable' | 'memory'; editorRevision: number; recoveryText: string | null }
export interface CommandScope { repository: ProgressRepository; expected: Expected }
export interface ActiveEditor {
  readonly dirty: boolean; flush(): Promise<void>; leave(): Promise<void>;
  suspend(): Promise<void>;
  prepareMemory(): Promise<{ text: string; restore: (branch: ProgressRepository) => Promise<boolean> }>;
}
export const errorCode = (error: unknown) => error instanceof Error ? error.message : 'storage_unavailable';
export class AppRuntime {
  content: ContentRepository | null = null;
  progress: ProgressRepository | null = null;
  releaseId = '';
  private tabId = '';
  private opening: Promise<void> | null = null;
  private stopListening: (() => void) | null = null;
  private switching: Promise<void> | null = null;
  editor: ActiveEditor | null = null;
  registerEditor(editor: ActiveEditor) { this.editor = editor; return () => { if (this.editor === editor) this.editor = null; }; }
  private state: AppState = { phase: 'loading', snapshot: null, error: null, mode: 'durable', editorRevision: 0, recoveryText: null };
  private readonly listeners = new Set<() => void>();
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<AppState>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  start(): Promise<void> {
    if (this.opening) return this.opening;
    this.opening = this.open().finally(() => { this.opening = null; });
    return this.opening;
  }
  private async open() {
    this.publish({ phase: 'loading', error: null });
    try {
      if (!this.content) {
        const [content, releaseId, tabId] = await Promise.all([ContentRepository.open(), currentReleaseId(), tabIdentity()]);
        this.content = content; this.releaseId = releaseId; this.tabId = tabId;
      }
      if (!this.progress || !this.progress.acceptsCommands) {
        const progress = await ProgressRepository.open({ catalog: this.content.catalog, releaseId: this.releaseId, tabId: this.tabId });
        this.attach(progress);
      }
      await this.refresh();
    } catch (error) { this.publish({ phase: this.content ? 'storage_error' : 'error', error: errorCode(error) }); }
  }
  private attach(progress: ProgressRepository) {
    this.stopListening?.();
    this.progress = progress;
    this.stopListening = progress.subscribe(() => { void this.refresh().catch(() => {}); });
  }
  async refresh(): Promise<void> {
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
    const progress = scope.repository;
    if (progress !== this.progress) throw new Error('write_conflict');
    try {
      if (command.type === 'help' || command.type === 'observe') {
        const content = this.content!;
        const snapshot = await progress.snapshot();
        const pending = new Map(snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status) && !['diagnostic', 'final'].includes(session.kind)).map(session => [session.session_id, session]));
        const ids = snapshot.presentations.filter(item => {
          const session = pending.get(item.session_id);
          return session && item.status === 'draft' && (session.kind === 'reading_practice' || item.shown_at !== null && session.active_presentation_id === item.presentation_id);
        }).map(item => item.question_id).filter(id => !content.catalog.questions.has(id));
        // Данные для сопоставления помощи загружаются до IDB-транзакции; полномочия callback не обновляются.
        if (ids.length) await content.questions([...new Set(ids)]);
        if (progress !== this.progress) throw new Error('write_conflict');
      }
      const result = await progress.dispatch(command, scope.expected);
      if (progress !== this.progress) throw new Error('write_conflict');
      await this.refresh(); return result;
    } catch (error) { if (progress === this.progress) this.publish({ error: errorCode(error) }); throw error; }
  }
  clearError() { this.publish({ error: null }); }
  async retry() {
    if (!this.content) return this.start();
    await this.editor?.suspend();
    try {
      if (!this.progress?.acceptsCommands) this.attach(await ProgressRepository.open({ catalog: this.content.catalog, releaseId: this.releaseId, tabId: this.tabId }));
      await this.refresh(); this.publish({ editorRevision: this.state.editorRevision + 1, error: null });
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async takeover(progress: ProgressRepository, expected: ReplacementToken) {
    if (progress !== this.progress) throw new Error('write_conflict');
    try { await this.editor?.suspend(); await progress.takeover(expected.data_generation, expected.writer_epoch); await this.refresh(); this.publish({ editorRevision: this.state.editorRevision + 1, error: null }); }
    catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  useMemory(): Promise<void> {
    if (!this.switching) this.switching = this.switchToMemory().finally(() => { this.switching = null; });
    return this.switching;
  }
  private async switchToMemory() {
    if (!this.content) throw new Error('content_unavailable');
    if (this.progress?.mode === 'memory') return;
    try {
      const recovery = await this.editor?.prepareMemory();
      const branch = this.progress ? await this.progress.branchToMemory() : await ProgressRepository.memory({ catalog: this.content.catalog, releaseId: this.releaseId });
      let restored = !recovery;
      try { restored = await recovery?.restore(branch) ?? true; } catch { /* Исходный ввод остаётся отдельно от пустой или частично восстановленной ветви. */ }
      this.attach(branch); await this.refresh(); this.publish({ error: null, recoveryText: restored ? this.state.recoveryText : recovery!.text });
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async loadAllContent() {
    const content = this.content;
    if (!content) throw new Error('content_unavailable');
    await Promise.all([...new Set(content.catalog.core.lessons.map(lesson => lesson.resource)), 'readings.json', 'dictionary.json', 'references.json', 'assessments.json'].map(resource => content.load(resource)));
  }
}
