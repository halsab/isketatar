import { ContentRepository } from '../data/content/repository';
import { ProgressRepository } from '../data/progress/repository';
import type { Expected, ProgressSnapshot, ReplacementToken } from '../data/progress/model';
import type { Command } from '../data/progress/commands';
import { applyPreferences } from '../ui/preferences';
import { currentReleaseId } from './release';
import { tabIdentity } from './tab-identity';

export interface AppState { phase: 'loading' | 'ready' | 'error' | 'storage_error'; snapshot: ProgressSnapshot | null; error: string | null; mode: 'durable' | 'memory' }
export interface CommandScope { repository: ProgressRepository; expected: Expected }
export const errorCode = (error: unknown) => error instanceof Error ? error.message : 'storage_unavailable';
export class AppRuntime {
  content: ContentRepository | null = null;
  progress: ProgressRepository | null = null;
  releaseId = '';
  private tabId = '';
  private opening: Promise<void> | null = null;
  private stopListening: (() => void) | null = null;
  private switching: Promise<void> | null = null;
  private state: AppState = { phase: 'loading', snapshot: null, error: null, mode: 'durable' };
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
      if (!this.progress || !this.progress.available) {
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
      const result = await progress.dispatch(command, scope.expected);
      if (progress !== this.progress) throw new Error('write_conflict');
      await this.refresh(); return result;
    } catch (error) { if (progress === this.progress) this.publish({ error: errorCode(error) }); throw error; }
  }
  clearError() { this.publish({ error: null }); }
  async retry() {
    if (!this.progress?.available) return this.start();
    await this.refresh(); this.clearError();
  }
  async takeover(progress: ProgressRepository, expected: ReplacementToken) {
    if (progress !== this.progress) throw new Error('write_conflict');
    try { await progress.takeover(expected.data_generation, expected.writer_epoch); await this.refresh(); this.clearError(); }
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
      const branch = this.progress ? await this.progress.branchToMemory() : await ProgressRepository.memory({ catalog: this.content.catalog, releaseId: this.releaseId });
      this.attach(branch); await this.refresh(); this.clearError();
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async loadAllContent() {
    const content = this.content;
    if (!content) throw new Error('content_unavailable');
    await Promise.all([...new Set(content.catalog.core.lessons.map(lesson => lesson.resource)), 'readings.json', 'dictionary.json', 'references.json', 'assessments.json'].map(resource => content.load(resource)));
  }
}
