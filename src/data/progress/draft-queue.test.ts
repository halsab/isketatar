import { afterEach, describe, expect, it, vi } from 'vitest';
import { DraftQueue } from './draft-queue';
import type { Expected } from './model';

const expected: Expected = { data_generation: 'generation', writer_epoch: 1, revisions: [{ store: 'presentations', key: 'p', revision: 1 }] };
afterEach(() => vi.useRealTimers());
describe('draft write queue', () => {
  it('debounces at 300ms, omits intermediate composition and flushes before navigation', async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => expected);
    const queue = new DraftQueue(save, () => {});
    queue.input({ kind: 'text', text: 'ы' }, expected);
    await vi.advanceTimersByTimeAsync(299);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
    queue.compositionStart();
    queue.input({ kind: 'text', text: 'ыз' }, expected);
    await vi.advanceTimersByTimeAsync(1000);
    expect(save).toHaveBeenCalledTimes(1);
    queue.compositionEnd({ kind: 'text', text: 'ызан' }, expected);
    await queue.flush();
    expect(save.mock.calls[1]).toEqual([{ kind: 'text', text: 'ызан' }, expected]);
    await queue.cancel();
  });
  it('advances only own successful revisions for input queued during a write', async () => {
    let complete!: (value: Expected) => void;
    const save = vi.fn<(answer: unknown, token: Expected) => Promise<Expected>>().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ ...expected, revisions: [{ store: 'presentations', key: 'p', revision: 3 }] });
    const queue = new DraftQueue(save, () => {});
    queue.input({ kind: 'text', text: 'ы' }, expected, true);
    queue.input({ kind: 'text', text: 'ызан' }, expected);
    complete({ ...expected, revisions: [{ store: 'presentations', key: 'p', revision: 2 }] });
    await queue.flush();
    expect(save.mock.calls[1]![1].revisions[0]!.revision).toBe(2);
    expect(expected.revisions[0]!.revision).toBe(1);
    await queue.cancel();
  });
  it('stops on a conflict without silently retrying under a newer writer', async () => {
    const save = vi.fn(async () => { throw new Error('write_conflict'); });
    const status = vi.fn();
    const queue = new DraftQueue(save, status);
    queue.input({ kind: 'text', text: 'ызан' }, expected);
    await expect(queue.flush()).rejects.toThrow('write_conflict');
    await expect(queue.flush()).rejects.toThrow('write_conflict');
    expect(save).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith('unsaved');
    await queue.cancel();
  });
  it('keeps a cancelled newer draft unsaved when an older write completes', async () => {
    let complete!: (value: Expected) => void;
    const save = vi.fn(() => new Promise<Expected>(resolve => { complete = resolve; }));
    const status = vi.fn(); const queue = new DraftQueue(save, status);
    queue.input({ kind: 'text', text: 'first' }, expected, true);
    queue.input({ kind: 'text', text: 'newer' }, expected);
    const cancelled = queue.cancel(); complete(expected); await cancelled;
    expect(save).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith('unsaved');
  });
});

it('keeps every flush waiting for a newer write started by another drain continuation', async () => {
  let finishA!: (value: Expected) => void; let finishB!: (value: Expected) => void;
  const save = vi.fn<(answer: unknown, token: Expected) => Promise<Expected>>()
    .mockImplementationOnce(() => new Promise(resolve => { finishA = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishB = resolve; }));
  const queue = new DraftQueue(save, () => {});
  queue.input({ kind: 'set', option_ids: ['a'] }, expected, true);
  queue.input({ kind: 'set', option_ids: ['a', 'b'] }, expected, true);
  let flushed = false; const flush = queue.flush().then(() => { flushed = true; });
  finishA({ ...expected, revisions: [{ store: 'presentations', key: 'p', revision: 2 }] });
  await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(flushed).toBe(false);
  expect(save.mock.calls[1]![1].revisions[0]!.revision).toBe(2);
  finishB({ ...expected, revisions: [{ store: 'presentations', key: 'p', revision: 3 }] });
  await flush; expect(flushed).toBe(true); await queue.cancel();
});

it('preserves the debounce of newer text while the previous timed write completes', async () => {
  vi.useFakeTimers(); let complete!: (value: Expected) => void;
  const save = vi.fn<(answer: unknown, token: Expected) => Promise<Expected>>().mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue(expected);
  const queue = new DraftQueue(save, () => {});
  queue.input({ kind: 'text', text: 'first' }, expected); await vi.advanceTimersByTimeAsync(300);
  queue.input({ kind: 'text', text: 'second' }, expected);
  complete(expected); await vi.advanceTimersByTimeAsync(299); expect(save).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(save).toHaveBeenCalledTimes(2); await queue.cancel();
});
