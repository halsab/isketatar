import type { Command } from '../../data/progress/commands';
import { DraftQueue, type DraftStatus } from '../../data/progress/draft-queue';
import type { Expected, ProgressSnapshot } from '../../data/progress/model';
import { ProgressRepository, expectedFrom } from '../../data/progress/repository';
import type { AnswerValue } from '../../domain/learning/types';
import type { CommandResult } from '../../data/progress/engine';

export class SessionEditor {
  private expected: Expected;
  private readonly queue: DraftQueue;
  private state: { answer: AnswerValue | null; status: DraftStatus; busy: boolean; error: string | null };
  private readonly listeners = new Set<() => void>();
  private composing = false;
  private disposed = false;
  private suspended = false;
  private preparingUpdate = false;
  private running: Promise<CommandResult> | null = null;
  readonly generation: string;
  readonly sessionId: string;
  readonly questionId: string;
  readonly releaseId: string;
  getState = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private update(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(); }
  constructor(readonly repository: ProgressRepository, snapshot: ProgressSnapshot, readonly presentationId: string, private readonly refresh: () => Promise<void>) {
    const presentation = snapshot.presentations.find(item => item.presentation_id === presentationId);
    if (!presentation) throw new Error('unknown_presentation');
    this.sessionId = presentation.session_id;
    this.releaseId = snapshot.sessions.find(session => session.session_id === presentation.session_id)!.release_id;
    this.questionId = presentation.question_id;
    this.generation = snapshot.control.data_generation;
    this.expected = expectedFrom(snapshot);
    this.state = { answer: presentation.draft_answer, status: 'saved', busy: false, error: null };
    this.queue = new DraftQueue(async (answer, expected) => {
      const result = await repository.dispatch({ type: 'draft', presentation_id: presentationId, answer }, expected);
      this.expected = result.expected!; await refresh(); return result.expected!;
    }, status => this.update({ status }));
  }
  input(answer: AnswerValue | null, immediate = false) {
    if (this.disposed || this.suspended || this.state.busy || this.preparingUpdate && !this.composing) return;
    this.update({ answer, error: null }); this.queue.input(answer, this.expected, immediate);
  }
  composition(active: boolean) {
    this.composing = active;
    if (active) this.queue.compositionStart(); else this.queue.compositionEnd(this.state.answer, this.expected);
    if (!active && this.preparingUpdate) this.update({ busy: true });
  }
  get composingInput() { return this.composing; }
  beginUpdate() { this.preparingUpdate = true; this.update({ busy: this.suspended || this.disposed || this.running !== null || !this.composing }); }
  cancelUpdate() { this.preparingUpdate = false; this.update({ busy: this.suspended || this.disposed || this.running !== null }); }
  get dirty() { return this.state.status !== 'saved' || this.composing || this.running !== null; }
  flush = () => this.queue.flush();
  async perform(command: Command) {
    if (this.preparingUpdate) throw new Error('update_in_progress');
    if (this.disposed || this.state.busy) throw new Error('write_in_progress');
    this.update({ busy: true, error: null });
    this.running = (async () => {
      await this.queue.flush();
      const result = await this.repository.dispatch(command, this.expected);
      this.expected = result.expected!; await this.refresh(); return result;
    })();
    try { return await this.running; }
    catch (error) { this.update({ error: error instanceof Error ? error.message : 'storage_unavailable' }); throw error; }
    finally { this.running = null; this.update({ busy: false }); }
  }
  async leave() {
    const snapshot = await this.repository.snapshot();
    if (snapshot.control.writer_id !== this.repository.tabId && !this.dirty) return;
    if (snapshot.sessions.find(session => session.session_id === this.sessionId)?.status === 'submitted') { await this.flush(); return; }
    await this.perform({ type: 'pause', session_id: this.sessionId });
  }
  async prepareUpdate() {
    if (this.suspended || this.disposed) throw new Error('editor_unavailable');
    this.beginUpdate();
    if (this.composing) throw new Error('composition_in_progress');
    await this.running;
    await this.queue.flush();
    const snapshot = await this.repository.snapshot();
    if (snapshot.control.data_generation !== this.expected.data_generation || snapshot.control.writer_epoch !== this.expected.writer_epoch) throw new Error('write_conflict');
    if (snapshot.control.writer_id === this.repository.tabId && snapshot.sessions.find(session => session.session_id === this.sessionId)?.status === 'active') {
      // Pause сохраняет уже записанную помощь; полномочия остаются в исходном поколении и epoch.
      const result = await this.repository.dispatch({ type: 'pause', session_id: this.sessionId }, expectedFrom(snapshot));
      this.expected = result.expected!; await this.refresh();
    }
    this.update({ busy: true });
  }
  async prepareMemory() {
    await this.suspend();
    const answer = structuredClone(this.state.answer);
    const sessionId = this.sessionId; const presentationId = this.presentationId;
    const question = this.repository.catalogForRelease(this.releaseId).question(this.questionId);
    const text = answer === null ? '' : answer.kind === 'option' ? question.options.find(option => option.id === answer.option_id)?.text_tt ?? answer.option_id : answer.kind === 'set' ? answer.option_ids.map(id => question.options.find(option => option.id === id)?.text_tt ?? id).join(' · ') : answer.kind === 'unknown' ? '' : answer.text;
    return { text, restore: async (branch: ProgressRepository) => {
      const snapshot = await branch.snapshot();
      const session = snapshot.sessions.find(item => item.session_id === sessionId);
      const presentation = snapshot.presentations.find(item => item.presentation_id === presentationId);
      if (!session || !presentation || session.active_presentation_id !== presentationId) return false;
      if (presentation.status === 'submitted') return true;
      const resumed = await branch.dispatch({ type: 'resume', session_id: sessionId }, expectedFrom(snapshot));
      await branch.dispatch({ type: 'draft', presentation_id: presentationId, answer }, resumed.expected!);
      return true;
    } };
  }
  async suspend() { this.suspended = true; this.update({ busy: true }); await this.running?.catch(() => {}); this.update({ busy: true }); await this.queue.cancel(); }
  async dispose() { this.disposed = true; await this.queue.cancel(); this.listeners.clear(); }
}
