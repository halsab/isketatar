import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './product-scope.mjs';

test('deterministic tar roundtrip rejects wrong digest, traversal and links before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'iske-tar-'));
  const run = (...args) => execFileSync('python3', ['tools/package-artifact.py', ...args], { stdio: 'pipe', env: { ...process.env, PYTHONOPTIMIZE: '1' } });
  try {
    const body = 'test artifact'; await writeFile(join(root, 'index.html'), body);
    await writeFile(join(root, 'inventory.json'), JSON.stringify([{ path: 'index.html', bytes: body.length, sha256: sha256(body) }]));
    const archive = join(root, 'artifact.tar'); const second = join(root, 'second.tar');
    run('create', root, join(root, 'inventory.json'), archive); run('create', root, join(root, 'inventory.json'), second);
    assert.deepEqual(await readFile(archive), await readFile(second));
    const digest = sha256(await readFile(archive));
    assert.throws(() => run('extract', archive, join(root, 'bad-hash'), '0'.repeat(64)), /digest mismatch/u);
    run('extract', archive, join(root, 'result'), digest);
    assert.equal(await readFile(join(root, 'result/index.html'), 'utf8'), body);
    for (const kind of ['traversal', 'symlink', 'hardlink', 'duplicate']) {
      execFileSync('python3', ['-c', "import tarfile,sys,io\nwith tarfile.open(sys.argv[1],'w') as a:\n i=tarfile.TarInfo('../escape' if sys.argv[2]=='traversal' else 'entry')\n if sys.argv[2] in ['symlink','hardlink']: i.type=tarfile.SYMTYPE if sys.argv[2]=='symlink' else tarfile.LNKTYPE; i.linkname='../escape'\n a.addfile(i,io.BytesIO())\n if sys.argv[2]=='duplicate': a.addfile(i,io.BytesIO())", archive, kind]);
      const maliciousDigest = sha256(await readFile(archive));
      assert.throws(() => run('extract', archive, join(root, kind), maliciousDigest), /Unsafe archive entry|Duplicate archive entry/u);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
