import { ContentRepository } from '../data/content/repository';
import { ProgressRepository } from '../data/progress/repository';
import type { Expected, ProgressSnapshot, ReplacementToken } from '../data/progress/model';
import type { Command } from '../data/progress/commands';
import { applyPreferences } from '../ui/preferences';
import { POLICIES } from '../domain/content/types';
import type { ContentCatalog } from '../domain/content/catalog';
import { currentReleaseId, readerSupported } from './release';
import { tabIdentity } from './tab-identity';

export interface AppState { phase: 'loading' | 'ready' | 'error' | 'storage_error'; snapshot: ProgressSnapshot | null; error: string | null; mode: 'durable' | 'memory'; editorRevision: number; recoveryText: string | null }
export interface CommandScope { repository: ProgressRepository; expected: Expected; contentReleaseId?: string }
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
  private readonly contents = new Map<string, ContentRepository>();
  private readonly catalogs = new Map<string, ContentCatalog>();
  private readonly loadingReleases = new Map<string, Promise<ContentRepository>>();
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
        this.content = content; this.releaseId = releaseId; this.tabId = tabId; this.contents.set(releaseId, content); this.catalogs.set(releaseId, content.catalog);
      }
      if (!this.progress || !this.progress.acceptsCommands) {
        const progress = await ProgressRepository.open({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId, tabId: this.tabId });
        this.attach(progress);
      }
      await this.refresh();
      if (import.meta.env.PROD) void import('../data/pwa/client').then(({ offline }) => offline.start(this.releaseId)).catch(() => {});
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
    if (!this.content) return this.start();
    await this.editor?.suspend();
    try {
      if (!this.progress?.acceptsCommands) this.attach(await ProgressRepository.open({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId, tabId: this.tabId }));
      await this.refresh(); this.publish({ editorRevision: this.state.editorRevision + 1, error: null });
    } catch (error) { this.publish({ error: errorCode(error) }); throw error; }
  }
  async takeover(progress: ProgressRepository, expected: ReplacementToken) {
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
    if (!this.switching) this.switching = this.switchToMemory().finally(() => { this.switching = null; });
    return this.switching;
  }
  private async switchToMemory() {
    if (!this.content) throw new Error('content_unavailable');
    if (this.progress?.mode === 'memory') return;
    try {
      const recovery = await this.editor?.prepareMemory();
      const branch = this.progress ? await this.progress.branchToMemory() : await ProgressRepository.memory({ catalog: this.content.catalog, catalogs: this.catalogs, releaseId: this.releaseId });
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
}
