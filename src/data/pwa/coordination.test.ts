import { expect, it, vi } from 'vitest';
import { UpdateCoordinator, type UpdatePeer, type UpdateState } from './coordination';
import { POLICIES } from '../../domain/content/types';
import type { ReleaseLifecycle } from './lifecycle';

const from = '1.0.0-1111111111111111'; const target = '1.0.0-2222222222222222';
function fixture() {
  let state: UpdateState = { control: { accepted_release_id: from, data_generation: 'generation', writer_epoch: 4, writer_id: 'writer', active_session_id: null, update_gate: { update_id: 'operation', target_release_id: target, coordinator_id: 'writer', phase: 'quiescing', requested_at: 0 } }, pins: [{ session_id: 'session', release_id: from, content_schema: 1, policy_versions: POLICIES }], active: false };
  const lifecycle = { packages: { registry: { read: vi.fn(async () => ({ current_release_id: from, operation: null })) } }, prepare: vi.fn(async () => {}), commit: vi.fn(async () => {}) };
  const calls: string[] = [];
  const peer = (id: string, tab = id): UpdatePeer => ({ id, url: 'https://course.test/isketatar/', request: vi.fn(async message => {
    calls.push(`${id}:${message.type}`);
    if (message.type === 'commit') { state.control.update_gate!.phase = 'commit'; return { closed: true }; }
    return { tab_id: tab, release_id: from, mode: 'durable', closed: tab !== 'writer' || state.control.update_gate?.phase === 'commit', memory_loss_accepted: false };
  }) });
  const owner = peer('window-a', 'writer'); let clients = [owner, peer('window-b')];
  const enumerate = vi.fn(async () => clients);
  const coordinator = new UpdateCoordinator(lifecycle as unknown as ReleaseLifecycle, async () => structuredClone(state), enumerate);
  return { coordinator, lifecycle, owner, peer, calls, enumerate, get state() { return state; }, set state(next: UpdateState) { state = next; }, get clients() { return clients; }, set clients(next: UpdatePeer[]) { clients = next; } };
}
it('prepares concrete windows, closes the coordinator after durable commit, and uses authoritative pins', async () => {
  const f = fixture(); await f.coordinator.run('operation', 'window-a');
  expect(f.calls).toEqual(['window-a:prepare', 'window-b:prepare', 'window-a:commit']);
  expect(f.lifecycle.prepare).toHaveBeenCalledWith('operation', from, target, f.state.pins);
  expect(f.lifecycle.commit).toHaveBeenCalledWith('operation', f.state.pins);
});
it('prepares a window arriving before or immediately after the progress commit', async () => {
  const f = fixture(); let count = 0;
  f.enumerate.mockImplementation(async () => { count++; if (count === 2) f.clients = [...f.clients, f.peer('window-c')]; if (count === 4) f.clients = [...f.clients, f.peer('window-d')]; return f.clients; });
  await f.coordinator.run('operation', 'window-a');
  expect(f.calls).toContain('window-c:prepare'); expect(f.calls).toContain('window-d:prepare'); expect(f.lifecycle.commit).toHaveBeenCalledOnce();
});
it('never treats a silent or memory window as consent and retries with fresh replies', async () => {
  const f = fixture(); const silent = f.peer('silent'); vi.mocked(silent.request).mockRejectedValue(new Error('update_timeout')); f.clients.push(silent);
  await expect(f.coordinator.run('operation', 'window-a')).rejects.toMatchObject({ message: 'update_clients_blocked', blockers: [{ client_id: 'silent', reason: 'update_timeout' }] });
  expect(f.lifecycle.commit).not.toHaveBeenCalled(); expect(f.state.control.update_gate?.phase).toBe('quiescing');
  f.clients = [f.owner, f.peer('memory')]; vi.mocked(f.clients[1]!.request).mockResolvedValue({ tab_id: 'memory', release_id: from, mode: 'memory', closed: true, memory_loss_accepted: false });
  await expect(f.coordinator.run('operation', 'window-a')).rejects.toThrow('update_clients_blocked');
  f.clients = [f.owner]; await f.coordinator.run('operation', 'window-a'); expect(f.lifecycle.commit).toHaveBeenCalledOnce();
});
it('rejects a stale coordinator, duplicate tab identity and nonclosed readonly connection', async () => {
  for (const defect of ['source', 'duplicate', 'open']) {
    const f = fixture();
    if (defect === 'duplicate') f.clients.push(f.peer('duplicate', 'writer'));
    if (defect === 'open') vi.mocked(f.clients[1]!.request).mockResolvedValue({ tab_id: 'window-b', release_id: from, mode: 'durable', closed: false, memory_loss_accepted: false });
    await expect(f.coordinator.run('operation', defect === 'source' ? 'window-b' : 'window-a')).rejects.toThrow();
    expect(f.lifecycle.commit).not.toHaveBeenCalled();
  }
});
it('checks the live epoch again after ACK and never rolls back a commit interrupted by package failure', async () => {
  const stale = fixture(); const original = vi.mocked(stale.owner.request).getMockImplementation()!;
  vi.mocked(stale.owner.request).mockImplementation(async message => { const result = await original(message); stale.state.control.writer_epoch++; return result; });
  await expect(stale.coordinator.run('operation', 'window-a')).rejects.toThrow('stale_update'); expect(stale.lifecycle.commit).not.toHaveBeenCalled();
  const f = fixture(); f.lifecycle.commit.mockRejectedValueOnce(new Error('retained_incomplete'));
  await expect(f.coordinator.run('operation', 'window-a')).rejects.toThrow('retained_incomplete'); expect(f.state.control.update_gate?.phase).toBe('commit');
  await f.coordinator.run('operation', 'window-a'); expect(f.calls.filter(call => call === 'window-a:commit')).toHaveLength(1);
});
it('does not accept an active session or a missing gate as a committed quiet state', async () => {
  for (const defect of ['active', 'missing']) {
    const f = fixture(); const original = vi.mocked(f.owner.request).getMockImplementation()!;
    vi.mocked(f.owner.request).mockImplementation(async message => { const value = await original(message); if (message.type === 'commit') { if (defect === 'active') f.state.active = true; else f.state.control.update_gate = null; } return value; });
    await expect(f.coordinator.run('operation', 'window-a')).rejects.toThrow(); expect(f.lifecycle.commit).not.toHaveBeenCalled();
  }
});
it('ends a silent round after fifteen seconds without clearing its durable gate', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); vi.mocked(f.clients[1]!.request).mockReturnValue(new Promise(() => {}));
    const pending = expect(f.coordinator.run('operation', 'window-a')).rejects.toMatchObject({ message: 'update_clients_blocked', blockers: [{ client_id: 'window-b', reason: 'update_timeout' }] });
    await vi.advanceTimersByTimeAsync(15_001); await pending;
    expect(f.state.control.update_gate?.phase).toBe('quiescing'); expect(f.lifecycle.commit).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});
