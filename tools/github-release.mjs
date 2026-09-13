import { checkAcceptanceMetadata } from './check-acceptance.mjs';
import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseRelease } from '../src/data/pwa/manifest.ts';
import { readBoundedBytes } from '../src/data/http.ts';
import { sha256 } from './product-scope.mjs';
import { readReleaseBundle } from './read-release-bundle.mjs';
import { assembleArtifact } from './assemble-artifact.mjs';

export const repository = 'halsab/isketatar';
export const publicUrl = 'https://halsab.github.io/isketatar/';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
function publicationSource(run) {
  return run.head_branch === 'main' && run.head_repository?.full_name === repository && (
    run.path === '.github/workflows/check.yml' && run.event === 'push' || run.path === '.github/workflows/rollback.yml' && run.event === 'workflow_dispatch');
}
export function publicationRun(run) { return run.conclusion === 'success' && publicationSource(run); }
export async function selectLastGood(runs, listArtifacts, wasPublished) {
  for (const run of [...runs].filter(publicationRun).sort((a, b) => b.updated_at.localeCompare(a.updated_at))) {
    assert.ok(Number.isSafeInteger(run.id) && run.id > 0 && /^[a-f0-9]{40}$/u.test(run.head_sha));
    const artifacts = (await listArtifacts(run.id)).filter(artifact => artifact.name === 'last-good');
    if (!artifacts.length) {
      assert.ok(!await wasPublished(run.id), 'Published run lost its last-good archive');
      continue;
    }
    assert.equal(artifacts.length, 1, 'Ambiguous last-good artifacts');
    const artifact = artifacts[0];
    assert.ok(!artifact.expired && Date.parse(artifact.expires_at) > Date.now(), 'Last-good expired; restore the owner archive before publication');
    assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0 && /^sha256:[a-f0-9]{64}$/u.test(artifact.digest), 'Missing last-good archive identity');
    return { run_id: run.id, head_sha: run.head_sha, workflow_path: run.path, artifact_id: artifact.id, artifact_digest: artifact.digest, expires_at: artifact.expires_at };
  }
  return null;
}
export function reconcilePublished(selected, manifestBytes, indexStatus) {
  if (!selected) {
    assert.ok(manifestBytes === null && indexStatus === 404, 'Published site exists without a recoverable last-good archive');
    return { mode: 'first-release' };
  }
  assert.ok(manifestBytes && indexStatus === 200, 'Published site is unavailable; last-good is not a bootstrap');
  const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)));
  return { mode: 'last-good', ...selected, live_release_id: manifest.release_id, live_manifest_sha256: sha256(manifestBytes) };
}
const api = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
async function discover() {
  const runs = []; let total = 0;
  for (let page = 1; page <= 10; page++) {
    const value = api(`repos/${repository}/actions/runs?branch=main&per_page=100&page=${page}`); total = value.total_count;
    runs.push(...value.workflow_runs); if (value.workflow_runs.length < 100) break;
  }
  const publicationHistory = new Map();
  const wasPublished = id => {
    if (publicationHistory.has(id)) return publicationHistory.get(id);
    for (let page = 1; page <= 5; page++) {
      const jobs = api(`repos/${repository}/actions/runs/${id}/jobs?filter=all&per_page=100&page=${page}`).jobs;
      if (jobs.some(job => job.conclusion === 'success' && /(?:^| \/ )Publish Pages$/u.test(job.name))) { publicationHistory.set(id, true); return true; }
      if (jobs.length < 100) { publicationHistory.set(id, false); return false; }
    }
    throw new Error('Publication history limit; do not assume bootstrap');
  };
  const selected = await selectLastGood(runs, id => api(`repos/${repository}/actions/runs/${id}/artifacts?per_page=100`).artifacts, wasPublished);
  assert.ok(selected || total <= runs.length, 'History search limit; recover the known release explicitly');
  if (!selected) for (const run of runs.filter(run => publicationSource(run) && run.status === 'completed')) assert.ok(!wasPublished(run.id), 'Publication history exists without last-good; do not bootstrap');
  const [response, index] = await Promise.all(['release-manifest.json', ''].map(path => fetch(publicUrl + path, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) })));
  assert.ok([200, 404].includes(response.status) && [200, 404].includes(index.status), 'Unexpected publication HTTP response');
  if (response.status === 200) assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json');
  const bytes = response.status === 200 ? await readBoundedBytes(response, 1_000_000) : null;
  await index.body?.cancel(); if (response.status === 404) await response.body?.cancel();
  return reconcilePublished(selected, bytes, index.status);
}

async function rollbackSelection() {
  const select = (input, good) => {
    assert.match(input ?? '', /^[1-9]\d{0,15}$/u, 'A workflow run ID is required');
    const id = Number(input); assert.ok(Number.isSafeInteger(id));
    const run = api(`repos/${repository}/actions/runs/${id}`);
    assert.ok(publicationSource(run) && run.status === 'completed' && (good ? run.conclusion === 'success' : ['success', 'failure', 'cancelled'].includes(run.conclusion)), 'Run is not a completed production publication');
    const name = good ? 'last-good' : 'release-candidate';
    const artifacts = api(`repos/${repository}/actions/runs/${id}/artifacts?per_page=100`).artifacts.filter(item => item.name === name);
    assert.equal(artifacts.length, 1, `Missing ${name} archive`);
    const artifact = artifacts[0];
    assert.ok(!artifact.expired && Date.parse(artifact.expires_at) > Date.now() && /^sha256:[a-f0-9]{64}$/u.test(artifact.digest), 'Missing or expired rollback archive');
    assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0);
    return { run_id: id, artifact_id: artifact.id, artifact_digest: artifact.digest, head_sha: run.head_sha };
  };
  const target = select(process.env.TARGET_RUN, true); const current = select(process.env.CURRENT_RUN, false);
  const response = await fetch(publicUrl + 'release-manifest.json', { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/json');
  const bytes = await readBoundedBytes(response, 1_000_000); const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  return { target, current, live_release_id: manifest.release_id, live_manifest_sha256: sha256(bytes) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  assert.equal(process.env.GITHUB_REPOSITORY ?? repository, repository, 'Unexpected release repository');
  const command = process.argv[2]; await mkdir('quality-results', { recursive: true });
  if (command === 'discover') {
    const state = await discover(); await writeFile('quality-results/previous-release.json', JSON.stringify(state, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `mode=${state.mode}\nartifact_id=${state.artifact_id ?? ''}\nrun_id=${state.run_id ?? ''}\n`);
    console.log(JSON.stringify(state));
  } else if (command === 'unpack-previous') {
    const state = JSON.parse(await readFile('quality-results/previous-release.json', 'utf8'));
    assert.equal(state.mode, 'last-good');
    const result = await readReleaseBundle('quality-results/previous', 'quality-results/previous/dist');
    assert.equal(result.artifact.current.release_id, state.live_release_id, 'Live site differs from last-good; resolve the failed deployment first');
    assert.equal(result.evidence.provenance.manifest_sha256, state.live_manifest_sha256, 'Live manifest differs from last-good');
    assert.ok(hash(result.evidence.artifact_sha256));
  } else if (command === 'unpack-candidate') {
    const result = await readReleaseBundle('quality-results/candidate', 'dist');
    assert.equal(result.evidence.provenance.base_commit, process.env.GITHUB_SHA, 'Candidate source SHA mismatch');
    assert.equal(result.evidence.provenance.working_tree_dirty, false);
    await writeFile('quality-results/build-provenance.json', JSON.stringify(result.evidence.provenance, null, 2) + '\n');
    await writeFile('quality-results/bundle-graph.json', await readFile('quality-results/candidate/bundle-graph.json'));
  } else if (command === 'select-rollback') {
    const state = await rollbackSelection(); await writeFile('quality-results/rollback-selection.json', JSON.stringify(state, null, 2) + '\n');
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `target_id=${state.target.artifact_id}\ntarget_run=${state.target.run_id}\ncurrent_id=${state.current.artifact_id}\ncurrent_run=${state.current.run_id}\n`);
  } else if (command === 'unpack-rollback') {
    const state = JSON.parse(await readFile('quality-results/rollback-selection.json', 'utf8'));
    const target = await readReleaseBundle('quality-results/rollback-target', 'quality-results/rollback-target/dist');
    const current = await readReleaseBundle('quality-results/rollback-current', 'quality-results/rollback-current/dist');
    assert.equal(current.artifact.current.release_id, state.live_release_id); assert.equal(current.evidence.provenance.manifest_sha256, state.live_manifest_sha256);
    assert.equal(JSON.parse(await readFile('docs/development/external-acceptance.json', 'utf8')).rights.status, 'confirmed');
    const acceptance = JSON.parse(await readFile('quality-results/rollback-target/acceptance.json', 'utf8'));
    // История успешной публикации проверена выше; pending не подменяет собой одобрение рецензента.
    checkAcceptanceMetadata(acceptance, { scope: target.evidence.provenance.product_scope_sha256, artifact: target.evidence.provenance.product_artifact_sha256 });
    await assembleArtifact('quality-results/rollback-target/dist', null, 'dist');
    await writeFile('quality-results/build-provenance.json', JSON.stringify(target.evidence.provenance, null, 2) + '\n');
  } else throw new Error('Unknown release-state command');
}
