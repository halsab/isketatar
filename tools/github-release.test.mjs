import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publicationRun, selectLastGood, reconcilePublished } from './github-release.mjs';

test('last-good comes only from successful protected-branch publication workflows', async () => {
  const run = { id: 1, conclusion: 'success', head_branch: 'main', head_repository: { full_name: 'halsab/isketatar' }, path: '.github/workflows/check.yml', event: 'push', head_sha: 'a'.repeat(40), updated_at: '2026-01-01T00:00:00Z' };
  for (const change of [{ event: 'pull_request' }, { head_branch: 'feature' }, { conclusion: 'failure' }, { head_repository: { full_name: 'untrusted/fork' } }, { path: '.github/workflows/other.yml' }]) assert.equal(publicationRun({ ...run, ...change }), false);
  const artifact = { id: 2, name: 'last-good', expired: false, digest: 'sha256:' + 'b'.repeat(64), expires_at: '2099-01-01T00:00:00Z' };
  assert.equal((await selectLastGood([run], async () => [artifact])).artifact_id, 2);
  await assert.rejects(selectLastGood([run], async () => [{ ...artifact, expired: true }]), /expired/u);
  await assert.rejects(selectLastGood([run], async () => [], async () => true), /lost its last-good/u);
  assert.equal(await selectLastGood([run], async () => [], async () => false), null);
  assert.equal(await selectLastGood([{ ...run, event: 'pull_request' }], async () => { throw new Error('Must not inspect PR artifacts'); }), null);
  assert.deepEqual(reconcilePublished(null, null, 404), { mode: 'first-release' });
  assert.throws(() => reconcilePublished(null, Buffer.from('{}'), 200), /without a recoverable/u);
  assert.throws(() => reconcilePublished({ run_id: 1 }, null, 404), /not a bootstrap/u);
});
