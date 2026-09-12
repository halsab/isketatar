import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyArtifact, verifyBuiltArtifact } from './release-artifact.mjs';
import { sha256 } from './product-scope.mjs';

async function fixture(root, id) {
  const bodies = { 'index.html': '<html lang="tt-Cyrl"><meta http-equiv="Content-Security-Policy"></html>', 'recovery.html': '<p>help</p>', 'manifest.webmanifest': '{}', 'runtime/core.json': '{}', 'assets/app.js': 'void 0;' };
  const prefix = `/isketatar/releases/${id}/`;
  const manifest = { release_id: id, app_version: '1.0.0', content_version: 'fixture', content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: 0,
    question_revisions: {}, policy_versions: Object.fromEntries(['grading','normalization','mastery','diagnostic','final','review','exposure','release_access','search','import'].map(key => [key, 'fixture/1'])),
    assets: Object.entries(bodies).map(([path, body]) => ({ url: prefix + path, bytes: Buffer.byteLength(body), sha256: sha256(body), required: true, kind: path.endsWith('.js') ? 'script' : path.endsWith('.html') ? 'shell' : path.endsWith('.json') ? 'content' : 'media' })),
    shell_assets: ['index.html', 'recovery.html', 'runtime/core.json', 'assets/app.js'].map(path => prefix + path),
  };
  for (const [path, body] of Object.entries({ ...bodies, 'release-manifest.json': JSON.stringify(manifest) })) {
    const target = join(root, 'releases', id, path); await mkdir(join(target, '..'), { recursive: true }); await writeFile(target, body);
    if (!path.includes('/')) await writeFile(join(root, path), body);
  }
  await writeFile(join(root, 'sw.js'), 'void 0;');
}

test('publication inventory preserves two immutable releases and rejects corruption, extras and links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iske-artifact-'));
  try {
    await fixture(root, '1.0.0-1111111111111111');
    await fixture(root, '1.0.0-2222222222222222');
    const clean = await verifyArtifact(root); assert.equal(clean.releases.length, 2);
    const provenance = { artifact_sha256: clean.sha256, release_id: clean.current.release_id, manifest_sha256: clean.files.find(file => file.path === 'release-manifest.json').sha256 };
    await verifyBuiltArtifact(root, provenance);
    await writeFile(join(root, 'sw.js'), 'void 1;');
    await assert.rejects(verifyBuiltArtifact(root, provenance), /Artifact changed after build/u);
    await writeFile(join(root, 'sw.js'), 'void 0;');
    await writeFile(join(root, 'secret.txt'), 'not for publishing');
    await assert.rejects(verifyArtifact(root), /Unexpected artifact file/u); await rm(join(root, 'secret.txt'));
    await writeFile(join(root, 'index.html'), 'tampered');
    await assert.rejects(verifyArtifact(root), /Root alias/u);
    await fixture(root, '1.0.0-2222222222222222');
    const asset = join(root, 'releases/1.0.0-1111111111111111/assets/app.js');
    await writeFile(asset, 'void 1;'); await assert.rejects(verifyArtifact(root), /Asset hash/u);
    await rm(asset); await symlink(join(root, 'sw.js'), asset); await assert.rejects(verifyArtifact(root), /symlink/u);
    await rm(asset); await writeFile(asset, 'void 0;');
    assert.equal((await verifyArtifact(root)).sha256, clean.sha256);
    await fixture(root, '1.0.0-3333333333333333'); await assert.rejects(verifyArtifact(root), /at most one previous/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
