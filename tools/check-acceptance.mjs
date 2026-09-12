import assert from 'node:assert/strict';
import { appendFile, lstat, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productScope, sha256 } from './product-scope.mjs';
import { verifyBuiltArtifact } from './release-artifact.mjs';

const roles = ['language', 'subject', 'pilot', 'platforms'];
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
const keys = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');

export async function checkAcceptance(value, { root, scope, artifact, requireApproved = false }) {
  assert.ok(keys(value, ['schema_version', 'rights', ...roles]) && value.schema_version === 1, 'Invalid acceptance schema');
  assert.ok(keys(value.rights, ['status', 'confirmed_by', 'confirmed_at', 'evidence']) && value.rights.status === 'confirmed' && text(value.rights.confirmed_by) && date(value.rights.confirmed_at) && text(value.rights.evidence), 'Distribution rights are not confirmed');
  const pending = [];
  for (const role of roles) {
    const review = value[role];
    assert.ok(keys(review, ['status', 'reviewer', 'reviewed_at', 'product_scope_sha256', 'product_artifact_sha256', 'report', 'report_sha256']), `Invalid ${role} fields`);
    assert.ok(['pending', 'approved'].includes(review.status), `Invalid ${role} status`);
    if (review.status === 'pending') {
      assert.ok(Object.entries(review).every(([key, value]) => key === 'status' || value === null), `Partial ${role} approval`);
      pending.push(role); continue;
    }
    assert.ok(text(review.reviewer) && date(review.reviewed_at), `Missing ${role} reviewer/date`);
    assert.ok(hash(review.product_scope_sha256) && review.product_scope_sha256 === scope, `Stale ${role} source scope`);
    assert.ok(hash(review.product_artifact_sha256) && review.product_artifact_sha256 === artifact, `Stale ${role} product artifact`);
    assert.match(review.report, /^docs\/development\/acceptance-reports\/[a-z0-9-]+\.md$/u, `Invalid ${role} report path`);
    for (const path of ['docs', 'docs/development', 'docs/development/acceptance-reports', review.report]) assert.ok(!(await lstat(resolve(root, path))).isSymbolicLink(), 'Acceptance report symlink');
    const bytes = await readFile(resolve(root, review.report));
    assert.ok(bytes.length > 0 && bytes.length <= 1_000_000 && hash(review.report_sha256) && sha256(bytes) === review.report_sha256, `Changed ${role} report`);
    const report = bytes.toString('utf8');
    assert.ok(report.includes(scope) && report.includes(artifact) && report.includes(review.reviewer), `Unbound ${role} report`);
  }
  if (requireApproved) assert.equal(pending.length, 0, `Publication blocked: pending ${pending.join(', ')}`);
  return { status: pending.length ? 'pending' : 'approved', pending };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scope = await productScope();
  const provenance = JSON.parse(await readFile('quality-results/build-provenance.json', 'utf8'));
  assert.equal(provenance.product_scope_sha256, scope.sha256, 'Build scope changed; rebuild candidate');
  await verifyBuiltArtifact('dist', provenance);
  const result = await checkAcceptance(JSON.parse(await readFile('docs/development/external-acceptance.json', 'utf8')), {
    root: process.cwd(), scope: scope.sha256, artifact: provenance.product_artifact_sha256, requireApproved: process.argv.includes('--require-approved'),
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `status=${result.status}\n`);
}
