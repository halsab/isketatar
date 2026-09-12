import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { verifyArtifact } from './release-artifact.mjs';
import { sha256 } from './product-scope.mjs';

export async function readReleaseBundle(directory, destination) {
  const evidence = JSON.parse(await readFile(`${directory}/release-evidence.json`, 'utf8'));
  assert.equal(evidence.schema_version, 1);
  for (const [name, key] of [['checksums.json', 'checksums_sha256'], ['dependencies.json', 'dependencies_sha256']]) assert.equal(sha256(await readFile(`${directory}/${name}`)), evidence[key], `Changed bundle ${name}`);
  execFileSync('python3', ['tools/package-artifact.py', 'extract', `${directory}/artifact.tar`, destination, evidence.archive_sha256], { stdio: 'pipe' });
  const artifact = await verifyArtifact(destination);
  assert.equal(artifact.sha256, evidence.artifact_sha256, 'Extracted artifact mismatch');
  assert.deepEqual(JSON.parse(await readFile(`${directory}/checksums.json`, 'utf8')), artifact.files);
  assert.equal(artifact.current.release_id, evidence.provenance.release_id);
  assert.equal(artifact.files.find(file => file.path === 'release-manifest.json').sha256, evidence.provenance.manifest_sha256);
  const originalFiles = artifact.files.filter(file => !file.path.startsWith('releases/') || file.path.startsWith(`releases/${artifact.current.release_id}/`));
  assert.equal(sha256(JSON.stringify(originalFiles)), evidence.provenance.artifact_sha256, 'Original candidate provenance mismatch');
  return { artifact, evidence, dependencies: JSON.parse(await readFile(`${directory}/dependencies.json`, 'utf8')) };
}
