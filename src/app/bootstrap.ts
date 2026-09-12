import { IndexedRegistry } from '../data/pwa/registry';
import { readUpdateState } from '../data/pwa/progress-state';
import { bootPolicy } from '../data/pwa/boot-policy';
import { offline } from '../data/pwa/client';
import type { ProgressRepository } from '../data/progress/repository';
import { replacementToken } from '../data/progress/transfer';

const technicalRegistry = new IndexedRegistry();
async function decision(own: string) {
  const progress = await readUpdateState();
  const registry = await technicalRegistry.read().catch(() => null);
  return bootPolicy(own, registry, progress?.control ?? null);
}
export async function prepareBoot(own: string) {
  // Сначала определяем принятую версию: initialize не должен принять случайный shell при потере реестра.
  await decision(own); await offline.start(own);
  const policy = await decision(own);
  if (policy.kind === 'finish') {
    const proof = await offline.verifyBoot(own);
    if (proof.protocol !== 1) throw new Error('unsupported_release');
    return bootPolicy(own, proof.registry, proof.progress?.control ?? null);
  }
  return policy;
}
export async function finishBoot(own: string, repository: ProgressRepository) {
  let policy = await decision(own);
  if (policy.kind === 'finish') {
    const proof = await offline.verifyBoot(own);
    if (proof.protocol !== 1) throw new Error('unsupported_release');
    policy = bootPolicy(own, proof.registry, proof.progress?.control ?? null);
    if (policy.kind === 'finish') {
      const snapshot = await repository.snapshot();
      if (snapshot.control.update_gate) {
        try { await repository.finishUpdate(replacementToken(snapshot), policy.update_id); }
        catch (error) { const current = await repository.snapshot(); if (current.control.update_gate || current.control.accepted_release_id !== own) throw error; }
      }
      // Сбой удаления устаревшего кэша оставляет технический marker для повтора; принятый прогресс не откатывается.
      await offline.finishBoot(own, policy.update_id).catch(() => {});
    }
  }
  const snapshot = await repository.snapshot();
  if (snapshot.control.accepted_release_id !== own) throw new Error('release_not_current');
  return snapshot.control.update_gate;
}
