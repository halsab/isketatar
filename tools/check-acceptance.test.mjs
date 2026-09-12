import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAcceptance } from './check-acceptance.mjs';
import { sha256 } from './product-scope.mjs';

test('release gate refuses pending, stale artifacts and altered evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iske-acceptance-'));
  const scope = 'a'.repeat(64); const artifact = 'b'.repeat(64);
  const options = { root, scope, artifact, requireApproved: true };
  const roles = ['language','subject','pilot','platforms'];
  const value = { schema_version: 1, rights: { status: 'confirmed', confirmed_by: 'Test fixture', confirmed_at: '2001-01-01', evidence: 'Test only' } };
  try {
    for (const role of roles) value[role] = { status: 'pending', reviewer: null, reviewed_at: null, product_scope_sha256: null, product_artifact_sha256: null, report: null, report_sha256: null };
    assert.equal((await checkAcceptance(value, { ...options, requireApproved: false })).status, 'pending');
    await assert.rejects(checkAcceptance(value, options), /Publication blocked/u);
    await mkdir(join(root, 'docs/development/acceptance-reports'), { recursive: true });
    for (const role of roles) {
      const report = `Test fixture only\n${scope}\n${artifact}\n`;
      const path = `docs/development/acceptance-reports/${role}.md`;
      await writeFile(join(root, path), report);
      value[role] = { status: 'approved', reviewer: 'Test fixture only', reviewed_at: '2001-01-01', product_scope_sha256: scope, product_artifact_sha256: artifact, report: path, report_sha256: sha256(report) };
    }
    assert.equal((await checkAcceptance(value, options)).status, 'approved');
    await assert.rejects(checkAcceptance(value, { ...options, scope: 'c'.repeat(64) }), /Stale language source/u);
    await assert.rejects(checkAcceptance(value, { ...options, artifact: 'c'.repeat(64) }), /Stale language product/u);
    await writeFile(join(root, value.language.report), 'changed');
    await assert.rejects(checkAcceptance(value, options), /Changed language report/u);
    value.language.report = '../outside.md'; await assert.rejects(checkAcceptance(value, options), /Invalid language report path/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
