import type { AnswerValue } from '../../domain/learning/types';
import type { Expected } from './model';

interface Draft { answer: AnswerValue | null; expected: Expected }
export type DraftStatus = 'saving' | 'saved' | 'unsaved';
export class DraftQueue {
  private pending: Draft | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private composing = false;
  private stopped = false;
  private error: unknown = null;
  constructor(private readonly save: (answer: AnswerValue | null, expected: Expected) => Promise<Expected>, private readonly status: (status: DraftStatus) => void) {}
  compositionStart() { this.composing = true; this.clearTimer(); }
  compositionEnd(answer: AnswerValue | null, expected: Expected) { this.composing = false; this.input(answer, expected); }
  input(answer: AnswerValue | null, expected: Expected, immediate = false) {
    if (this.stopped) return;
    this.pending = structuredClone({ answer, expected });
    this.error = null;
    this.status('saving');
    this.clearTimer();
    if (this.composing) return;
    if (immediate) void this.flush().catch(() => {});
    else this.timer = setTimeout(() => { this.timer = null; void this.drain(false).catch(() => {}); }, 300);
  }
  private clearTimer() { if (this.timer !== null) clearTimeout(this.timer); this.timer = null; }
  flush(): Promise<void> { return this.drain(true); }
  private async drain(force: boolean): Promise<void> {
    if (force) this.clearTimer();
    if (this.composing) throw new Error('composition_in_progress');
    if (this.running) { await this.running; if (this.pending && (force || this.timer === null)) return this.drain(force); return; }
    if (this.error) throw this.error;
    const draft = this.pending;
    if (!draft || this.stopped) return;
    this.pending = null;
    this.running = this.save(draft.answer, draft.expected).then(receipt => {
      // Продвигаются только revisions собственной успешной записи; чужие полномочия не заимствуются.
      if (this.pending && this.pending.expected.data_generation === receipt.data_generation && this.pending.expected.writer_epoch === receipt.writer_epoch) {
        for (const item of this.pending.expected.revisions) {
          const before = draft.expected.revisions.find(previous => previous.store === item.store && previous.key === item.key);
          const after = receipt.revisions.find(next => next.store === item.store && next.key === item.key);
          if (before?.revision === item.revision && after) item.revision = after.revision;
        }
      }
      if (!this.pending) this.status('saved');
    }).catch(error => {
      this.pending ??= draft;
      this.error = error;
      this.status('unsaved');
      throw error;
    }).finally(() => { this.running = null; });
    await this.running;
    if (this.pending && (force || this.timer === null)) await this.drain(force);
  }
  async cancel() {
    const discarded = this.pending !== null;
    this.stopped = true; this.clearTimer(); this.pending = null;
    await this.running?.catch(() => {});
    // Завершённая A не означает сохранение отменённого более нового ввода B.
    if (discarded) this.status('unsaved');
  }
}
