import type { Control, UpdateGate } from '../progress/model';
import type { ReleaseLifecycle, ReleasePin } from './lifecycle';
import { RELEASE_ID } from './manifest';

export interface UpdateState {
  control: Pick<Control, 'accepted_release_id' | 'data_generation' | 'writer_epoch' | 'writer_id' | 'active_session_id' | 'update_gate'>;
  pins: ReleasePin[]; active: boolean;
}
export type Preparation = UpdateGate & { data_generation: string; writer_epoch: number };
export interface PageRequest { type: 'prepare' | 'commit'; operation: Preparation }
export interface UpdatePeer { id: string; url: string; request(message: PageRequest): Promise<unknown> }
export interface UpdateBlocker { client_id: string; reason: string }
export class BlockedUpdate extends Error {
  constructor(readonly blockers: UpdateBlocker[]) { super('update_clients_blocked'); }
}
interface Ready { tab_id: string; release_id: string; mode: 'durable' | 'memory'; closed: boolean; memory_loss_accepted: boolean }
function ready(value: unknown): value is Ready {
  return !!value && typeof value === 'object' && typeof Reflect.get(value, 'tab_id') === 'string' && !!Reflect.get(value, 'tab_id') && typeof Reflect.get(value, 'release_id') === 'string' && RELEASE_ID.test(Reflect.get(value, 'release_id')) && ['durable', 'memory'].includes(Reflect.get(value, 'mode')) && typeof Reflect.get(value, 'closed') === 'boolean' && typeof Reflect.get(value, 'memory_loss_accepted') === 'boolean';
}
export function sameOperation(state: UpdateState | null, operation: Preparation): asserts state is UpdateState {
  const control = state?.control; const gate = control?.update_gate;
  if (!control || !gate || control.data_generation !== operation.data_generation || control.writer_epoch !== operation.writer_epoch || control.writer_id !== operation.coordinator_id || gate.coordinator_id !== operation.coordinator_id || gate.update_id !== operation.update_id || gate.target_release_id !== operation.target_release_id) throw new Error('stale_update');
}

// ACK живут только в одном раунде и принадлежат конкретному client ID, а не BroadcastChannel или tab ID.
export class UpdateCoordinator {
  constructor(private readonly lifecycle: ReleaseLifecycle, private readonly read: () => Promise<UpdateState | null>, private readonly peers: () => Promise<UpdatePeer[]>) {}
  async run(updateId: string, sourceId: string) {
    const initial = await this.read(); const gate = initial?.control.update_gate;
    if (!initial || !gate || gate.update_id !== updateId) throw new Error('stale_update');
    const operation: Preparation = { ...gate, data_generation: initial.control.data_generation, writer_epoch: initial.control.writer_epoch };
    sameOperation(initial, operation);
    const registry = await this.lifecycle.packages.registry.read();
    const from = registry.operation?.from_release_id ?? registry.current_release_id;
    if (!from) throw new Error('update_conflict');
    const acknowledged = new Map<string, Ready>(); let coordinator: UpdatePeer | undefined;
    const deadline = Date.now() + 15_000;
    const request = (peer: UpdatePeer, type: PageRequest['type']) => new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('update_timeout')), Math.max(0, deadline - Date.now()));
      peer.request({ type, operation }).then(resolve, reject).finally(() => clearTimeout(timeout));
    });
    const settle = async () => {
      for (;;) {
        const windows = await this.peers(); const ids = new Set(windows.map(peer => peer.id));
        for (const id of acknowledged.keys()) if (!ids.has(id)) acknowledged.delete(id);
        const pending = windows.filter(peer => !acknowledged.has(peer.id));
        if (!pending.length) return windows;
        const blockers: UpdateBlocker[] = [];
        await Promise.all(pending.map(async peer => {
          try {
            const result = await request(peer, 'prepare');
            if (!ready(result)) throw new Error('update_unknown_client');
            if (result.mode === 'memory' && !result.memory_loss_accepted) throw new Error('update_memory_mode');
            const owner = result.tab_id === operation.coordinator_id;
            if (owner && (peer.id !== sourceId || result.mode !== 'durable') || !owner && !result.closed) throw new Error('update_not_ready');
            if (peer.id === sourceId && !owner) throw new Error('update_not_coordinator');
            if ([...acknowledged.values()].some(item => item.tab_id === result.tab_id)) throw new Error('update_duplicate_tab');
            acknowledged.set(peer.id, result); if (owner) coordinator = peer;
          } catch (error) { blockers.push({ client_id: peer.id, reason: error instanceof Error ? error.message : 'update_unknown_client' }); }
        }));
        // Исчезновение окна подтверждает только новый список clients, а не ошибка его порта.
        if (blockers.length) {
          const alive = new Set((await this.peers()).map(peer => peer.id));
          const remaining = blockers.filter(item => alive.has(item.client_id));
          if (remaining.length) throw new BlockedUpdate(remaining);
        }
        sameOperation(await this.read(), operation);
        if (Date.now() >= deadline) throw new BlockedUpdate([{ client_id: sourceId, reason: 'update_timeout' }]);
      }
    };
    const windows = await settle();
    if (!coordinator || !windows.some(peer => peer.id === sourceId)) throw new Error('update_not_coordinator');
    let state = await this.read(); sameOperation(state, operation);
    await this.lifecycle.prepare(updateId, from, operation.target_release_id, state.pins);
    await settle(); state = await this.read(); sameOperation(state, operation);
    if (state.control.update_gate!.phase === 'quiescing') {
      if (!(await this.peers()).some(peer => peer.id === sourceId)) throw new Error('update_not_coordinator');
      const result = await request(coordinator, 'commit');
      if (!result || typeof result !== 'object' || Reflect.get(result, 'closed') !== true) throw new Error('update_not_ready');
    } else if (!acknowledged.get(sourceId)?.closed) throw new Error('update_not_ready');
    state = await this.read(); sameOperation(state, operation);
    if (state.control.update_gate!.phase !== 'commit' || state.control.active_session_id !== null || state.active) throw new Error('update_not_quiet');
    operation.phase = 'commit'; await settle();
    state = await this.read(); sameOperation(state, operation);
    await this.lifecycle.commit(updateId, state.pins);
    await settle();
    return { operation, clients: [...acknowledged.keys()] };
  }
}
