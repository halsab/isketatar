import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { verifyBuiltArtifact } from './release-artifact.mjs';
import { productScope } from './product-scope.mjs';
import { assembleArtifact, writeReleaseBundle } from './assemble-artifact.mjs';

const provenance = JSON.parse(await readFile('quality-results/build-provenance.json', 'utf8'));
assert.equal(provenance.product_scope_sha256, (await productScope()).sha256, 'Source changed after candidate build');
const candidate = await verifyBuiltArtifact('dist', provenance);
if (process.env.CI) {
  assert.equal(provenance.working_tree_dirty, false, 'CI candidate must have a clean checkout');
  assert.equal(provenance.base_commit, process.env.GITHUB_SHA, 'Wrong candidate commit');
}
const output = 'quality-results/release'; const pages = 'quality-results/pages';
const artifact = await assembleArtifact('dist', process.env.PREVIOUS_DIST, pages);
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const dependencies = Object.entries(lock.packages).filter(([path]) => path.startsWith('node_modules/')).map(([path, info]) => ({ package: path, version: info.version, integrity: info.integrity, license: info.license, development: !!info.dev }));
const evidence = await writeReleaseBundle(pages, artifact, provenance, dependencies, output);
console.log(JSON.stringify({ release_id: candidate.current.release_id, previous: evidence.previous_release_id, archive_sha256: evidence.archive_sha256 }));
