import { expect, it } from 'vitest';
import { bootPolicy, ShellMismatch } from './boot-policy';
import { emptyRegistry } from './registry';
import type { UpdateState } from './coordination';
const r1 = '1.0.0-1111111111111111'; const r2 = '1.0.0-2222222222222222';
const control: UpdateState['control'] = { accepted_release_id: r1, data_generation: 'g', writer_id: 'writer', writer_epoch: 1, active_session_id: null, update_gate: null };
it('permits a verified initial or accepted shell and recovers its identity when the technical registry is lost', () => {
  expect(bootPolicy(r1, emptyRegistry(), null)).toEqual({ kind: 'ready' });
  expect(bootPolicy(r1, null, control)).toEqual({ kind: 'ready' });
  expect(() => bootPolicy(r2, null, control)).toThrow(ShellMismatch);
  expect(() => bootPolicy(r2, { ...emptyRegistry(), current_release_id: r1 }, null)).toThrow(ShellMismatch);
});
it('keeps a new page fenced during quiescing and requires both committed proofs before finishing', () => {
  const gate = { update_id: 'operation', target_release_id: r2, coordinator_id: 'writer', phase: 'quiescing' as const, requested_at: 1 };
  const registry = { ...emptyRegistry(), current_release_id: r1, candidate_release_id: r2 };
  expect(bootPolicy(r1, registry, { ...control, update_gate: gate })).toEqual({ kind: 'waiting', gate });
  expect(() => bootPolicy(r2, registry, { ...control, update_gate: gate })).toThrow(ShellMismatch);
  const committed = { ...registry, current_release_id: r2, previous_release_id: r1, candidate_release_id: null, operation: { update_id: 'operation', from_release_id: r1, target_release_id: r2, phase: 'committed' as const } };
  expect(bootPolicy(r2, committed, { ...control, update_gate: { ...gate, phase: 'commit' } })).toEqual({ kind: 'finish', update_id: 'operation' });
  expect(() => bootPolicy(r2, committed, { ...control, update_gate: gate })).toThrow('update_conflict');
  expect(() => bootPolicy(r2, { ...committed, operation: { ...committed.operation, update_id: 'wrong' } }, { ...control, update_gate: { ...gate, phase: 'commit' } })).toThrow('update_conflict');
  expect(() => bootPolicy(r2, committed, control)).toThrow('update_conflict');
});
it('can finish technical cleanup after a crash immediately after the gate was cleared', () => {
  const registry = { ...emptyRegistry(), current_release_id: r2, previous_release_id: r1, operation: { update_id: 'operation', from_release_id: r1, target_release_id: r2, phase: 'committed' as const } };
  expect(bootPolicy(r2, registry, { ...control, accepted_release_id: r2 })).toEqual({ kind: 'finish', update_id: 'operation' });
  expect(() => bootPolicy(r1, registry, { ...control, accepted_release_id: r2 })).toThrow(ShellMismatch);
});
