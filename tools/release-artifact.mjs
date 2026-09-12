import assert from 'node:assert/strict';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseRelease } from '../src/data/pwa/manifest.ts';
import { sha256 } from './product-scope.mjs';

export async function artifactInventory(root) {
  const files = [];
  const rootStat = await lstat(root);
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Invalid artifact root');
  let entries = 0;
  async function visit(relative = '') {
    assert.ok(relative.split('/').length <= 8, 'Artifact depth limit');
    for (const name of (await readdir(join(root, relative))).sort()) {
      assert.ok(++entries <= 3000, 'Artifact entry limit');
      assert.match(name, /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/u, `Unexpected artifact name: ${name}`);
      const path = relative ? `${relative}/${name}` : name;
      const stat = await lstat(join(root, path));
      assert.ok(!stat.isSymbolicLink(), `Artifact symlink: ${path}`);
      if (stat.isDirectory()) await visit(path);
      else {
        assert.ok(stat.isFile() && stat.nlink === 1, `Artifact special file/link: ${path}`);
        assert.ok(stat.size <= 8 * 1024 * 1024 && files.length < 2200, 'Artifact limit');
        const bytes = await readFile(join(root, path));
        files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit();
  assert.ok(files.reduce((n, file) => n + file.bytes, 0) <= 20 * 1024 * 1024, 'Combined artifact limit');
  return files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

export async function verifyArtifact(root) {
  const files = await artifactInventory(root);
  const byPath = new Map(files.map(file => [file.path, file]));
  const readManifest = async path => {
    assert.ok(byPath.get(path)?.bytes <= 1_000_000, `Missing/oversize manifest: ${path}`);
    return parseRelease(JSON.parse(await readFile(join(root, path), 'utf8')));
  };
  const current = await readManifest('release-manifest.json');
  const ids = await readdir(join(root, 'releases'));
  assert.ok(ids.length >= 1 && ids.length <= 2 && ids.includes(current.release_id), 'Expected current and at most one previous release');
  const allowed = new Set(['sw.js', 'index.html', 'recovery.html', 'manifest.webmanifest', 'release-manifest.json']);
  assert.ok(byPath.get('sw.js')?.bytes > 0, 'Missing transport');
  const releases = [];
  for (const id of ids.sort()) {
    const manifestPath = `releases/${id}/release-manifest.json`;
    const manifest = await readManifest(manifestPath);
    assert.equal(manifest.release_id, id);
    allowed.add(manifestPath);
    for (const asset of manifest.assets) {
      const path = asset.url.slice('/isketatar/'.length); const file = byPath.get(path);
      assert.ok(file, `Missing asset: ${path}`);
      assert.equal(file.bytes, asset.bytes, `Asset bytes: ${path}`);
      assert.equal(file.sha256, asset.sha256, `Asset hash: ${path}`);
      allowed.add(path);
    }
    releases.push(manifest);
  }
  for (const path of ['index.html', 'recovery.html', 'manifest.webmanifest', 'release-manifest.json']) {
    assert.ok(byPath.has(path), `Missing root alias: ${path}`);
    assert.equal(byPath.get(path).sha256, byPath.get(`releases/${current.release_id}/${path}`)?.sha256, `Root alias: ${path}`);
  }
  for (const file of files) assert.ok(allowed.has(file.path), `Unexpected artifact file: ${file.path}`);
  const html = await readFile(join(root, 'index.html'), 'utf8');
  assert.match(html, /lang="tt-Cyrl"/u); assert.match(html, /Content-Security-Policy/u);
  assert.doesNotMatch(html, /unsafe-eval|unsafe-inline|https?:\/\/|__ISKE_RELEASE__/u);
  return { current, releases, files, sha256: sha256(JSON.stringify(files)) };
}

export async function verifyBuiltArtifact(root, provenance) {
  const artifact = await verifyArtifact(root);
  assert.equal(provenance.artifact_sha256, artifact.sha256, 'Artifact changed after build');
  assert.equal(provenance.release_id, artifact.current.release_id, 'Stale release provenance');
  assert.equal(provenance.manifest_sha256, artifact.files.find(file => file.path === 'release-manifest.json').sha256, 'Stale manifest provenance');
  return artifact;
}
