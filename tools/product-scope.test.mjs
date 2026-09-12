import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { productScope } from './product-scope.mjs';

test('acceptance is invalidated by configuration and future build inputs, not its own evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iske-scope-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    await mkdir(join(root, 'src/ui'), { recursive: true });
    await mkdir(join(root, 'docs/development/acceptance-reports'), { recursive: true });
    await writeFile(join(root, 'src/ui/tt.json'), '{}');
    await writeFile(join(root, 'package-lock.json'), '{}');
    const baseline = await productScope(root);
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions":{"useDefineForClassFields":false}}');
    const configured = await productScope(root);
    assert.notEqual(configured.sha256, baseline.sha256);
    await writeFile(join(root, 'future-build-helper.mjs'), 'export const transform = true;');
    const extended = await productScope(root);
    assert.notEqual(extended.sha256, configured.sha256);
    await writeFile(join(root, 'docs/development/acceptance-reports/language.md'), extended.sha256);
    assert.equal((await productScope(root)).sha256, extended.sha256);
    execFileSync('git', ['-C', root, 'add', '.']);
    await rm(join(root, 'future-build-helper.mjs'));
    assert.equal((await productScope(root)).sha256, configured.sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});
