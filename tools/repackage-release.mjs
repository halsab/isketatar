import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyArtifact } from './release-artifact.mjs';

// Только bootstrap-fixture: те же скомпилированные байты с другой датой, не исторический last-good.
export async function repackageRelease(source, directory, timestamp) {
  const original = (await verifyArtifact(source)).current;
  for (const path of ['package.json', 'src/generated/content-manifest.json', 'quality-results/bundle-graph.json']) {
    const target = resolve(directory, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(path));
  }
  for (const asset of original.assets) {
    const path = asset.url.split(`/releases/${original.release_id}/`)[1];
    if (path === 'manifest.webmanifest') continue;
    const destination = resolve(directory, 'dist', path); await mkdir(dirname(destination), { recursive: true });
    const input = await readFile(resolve(source, asset.url.slice('/isketatar/'.length)));
    await writeFile(destination, /\.(?:js|css|html)$/u.test(path) ? Buffer.from(input.toString().replaceAll(original.release_id, '__ISKE_RELEASE__')) : input);
  }
  await writeFile(resolve(directory, 'dist/sw.js'), await readFile(resolve(source, 'sw.js')));
  execFileSync(process.execPath, [resolve('tools/build-release.mjs')], { cwd: directory, env: { ...process.env, SOURCE_DATE_EPOCH: String(timestamp) }, stdio: 'pipe' });
  return verifyArtifact(resolve(directory, 'dist'));
}
