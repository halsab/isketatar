import assert from 'node:assert/strict';
import { mkdir, cp, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyArtifact } from './release-artifact.mjs';
import { sha256 } from './product-scope.mjs';

export async function assembleArtifact(currentRoot, previousRoot, output) {
  for (const input of [currentRoot, previousRoot].filter(Boolean)) assert.ok(!resolve(input).startsWith(resolve(output) + '/') && resolve(input) !== resolve(output), 'Output contains an input artifact');
  const current = (await verifyArtifact(currentRoot)).current;
  const previous = previousRoot ? (await verifyArtifact(previousRoot)).current : null;
  assert.ok(!previous || previous.release_id !== current.release_id, 'Two distinct releases required');
  if (previous) for (const field of ['progress_schema', 'content_schema', 'policy_versions']) assert.deepEqual(previous[field], current[field], 'Explicit rollback compatibility plan required');
  await rm(output, { recursive: true, force: true }); await mkdir(`${output}/releases`, { recursive: true });
  for (const path of ['index.html', 'recovery.html', 'manifest.webmanifest', 'release-manifest.json', 'sw.js']) await cp(`${currentRoot}/${path}`, `${output}/${path}`);
  await cp(`${currentRoot}/releases/${current.release_id}`, `${output}/releases/${current.release_id}`, { recursive: true });
  if (previous) await cp(`${previousRoot}/releases/${previous.release_id}`, `${output}/releases/${previous.release_id}`, { recursive: true });
  return verifyArtifact(output);
}

export async function writeReleaseBundle(pages, artifact, provenance, dependencies, output) {
  await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
  await writeFile(`${output}/checksums.json`, JSON.stringify(artifact.files, null, 2) + '\n');
  execFileSync('python3', ['tools/package-artifact.py', 'create', pages, `${output}/checksums.json`, `${output}/artifact.tar`]);
  await writeFile(`${output}/dependencies.json`, JSON.stringify(dependencies, null, 2) + '\n');
  const evidence = { schema_version: 1, provenance, previous_release_id: artifact.releases.find(release => release.release_id !== artifact.current.release_id)?.release_id ?? null, artifact_sha256: artifact.sha256, archive_sha256: sha256(await readFile(`${output}/artifact.tar`)), checksums_sha256: sha256(await readFile(`${output}/checksums.json`)), dependencies_sha256: sha256(await readFile(`${output}/dependencies.json`)), retention_days: 90 };
  await writeFile(`${output}/release-evidence.json`, JSON.stringify(evidence, null, 2) + '\n');
  return evidence;
}
