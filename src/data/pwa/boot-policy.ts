import type { UpdateGate } from '../progress/model';
import type { UpdateState } from './coordination';
import type { Registry } from './registry';
export class ShellMismatch extends Error {
  constructor(readonly accepted: string) { super('release_not_current'); }
}
export type BootPolicy = { kind: 'ready' } | { kind: 'waiting'; gate: UpdateGate } | { kind: 'finish'; update_id: string };
// Собственный manifest/schema проверяются до вызова; finish дополнительно требует проверки полного пакета worker.
export function bootPolicy(own: string, registry: Registry | null, control: UpdateState['control'] | null): BootPolicy {
  const current = registry?.current_release_id ?? control?.accepted_release_id ?? own;
  if (current !== own) throw new ShellMismatch(current);
  const gate = control?.update_gate; const operation = registry?.operation;
  if (operation?.phase === 'committed') {
    if (operation.target_release_id !== own || registry?.previous_release_id !== operation.from_release_id) throw new Error('update_conflict');
    if (gate ? gate.phase !== 'commit' || gate.update_id !== operation.update_id || gate.target_release_id !== own || control?.accepted_release_id !== operation.from_release_id : control && control.accepted_release_id !== own) throw new Error('update_conflict');
    return { kind: 'finish', update_id: operation.update_id };
  }
  if (control && control.accepted_release_id !== own) throw new ShellMismatch(control.accepted_release_id);
  if (gate) return { kind: 'waiting', gate };
  if (operation) throw new Error('update_conflict');
  return { kind: 'ready' };
}
