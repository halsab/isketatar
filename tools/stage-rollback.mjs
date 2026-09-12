import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readReleaseBundle } from './read-release-bundle.mjs';
import { assembleArtifact, writeReleaseBundle } from './assemble-artifact.mjs';

assert.ok(process.env.ROLLBACK_BUNDLE && process.env.CURRENT_BUNDLE, 'Set verified ROLLBACK_BUNDLE and CURRENT_BUNDLE directories');
const temporary = await mkdtemp(join(tmpdir(), 'iske-rollback-'));
try {
  const target = await readReleaseBundle(process.env.ROLLBACK_BUNDLE, join(temporary, 'target'));
  await readReleaseBundle(process.env.CURRENT_BUNDLE, join(temporary, 'current'));
  const pages = 'quality-results/rollback-pages';
  const artifact = await assembleArtifact(join(temporary, 'target'), join(temporary, 'current'), pages);
  const evidence = await writeReleaseBundle(pages, artifact, target.evidence.provenance, target.dependencies, 'quality-results/rollback-release');
  console.log(JSON.stringify({ target: artifact.current.release_id, retained: evidence.previous_release_id, archive_sha256: evidence.archive_sha256 }));
} finally { await rm(temporary, { recursive: true, force: true }); }
