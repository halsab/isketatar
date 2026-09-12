import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import content from '../generated/content-index.json';
import { POLICIES } from '../domain/content/types';
import { fetchManifest } from '../data/pwa/manifest';
import { takePreloadedManifest } from '../data/pwa/manifest-preload-client';
import { currentReleaseId } from './release';
import { version } from '../../package.json';

vi.mock('./paths', () => ({ BASE_PATH: '/isketatar/', assetUrl: (path: string) => `/isketatar/releases/${version}-123456789abcdef0/${path}` }));
vi.mock('../data/pwa/manifest-preload-client', () => ({ takePreloadedManifest: vi.fn() }));
vi.mock('../data/pwa/manifest', async load => ({ ...await load<typeof import('../data/pwa/manifest')>(), fetchManifest: vi.fn() }));
beforeEach(() => vi.stubEnv('DEV', false));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
function manifest(id = `${version}-123456789abcdef0`) {
  const root = `/isketatar/releases/${id}/`;
  const assets = content.assets.map(asset => ({ ...asset, url: root + asset.url.slice('/isketatar/'.length), kind: 'content', required: true }));
  assets.push(...['index.html', 'recovery.html', 'assets/app.js'].map(path => ({ url: root + path, kind: path.endsWith('.js') ? 'script' : 'shell', required: true, sha256: 'a'.repeat(64), bytes: 10 })));
  return { release_id: id, app_version: version, content_version: content.content_version, content_schema: 1, progress_schema: 1, min_reader_version: version, base_path: '/isketatar/', built_at: 0, assets,
    question_revisions: {}, policy_versions: { ...POLICIES }, shell_assets: ['index.html', 'recovery.html', 'assets/app.js', 'runtime/core.json'].map(path => root + path) };
}
test('reuses a worker manifest only after page compatibility checks', async () => {
  vi.mocked(takePreloadedManifest).mockReturnValue(Promise.resolve(manifest()));
  await expect(currentReleaseId()).resolves.toBe(`${version}-123456789abcdef0`);
  expect(fetchManifest).not.toHaveBeenCalled();
});
test.each(['release', 'asset', 'policy', 'schema'])('rejects a preloaded manifest with incompatible %s', async kind => {
  const value = manifest(kind === 'release' ? `${version}-123456789abcdef1` : undefined);
  if (kind === 'asset') value.assets[0]!.sha256 = 'b'.repeat(64);
  if (kind === 'policy') Reflect.set(value.policy_versions, 'grading', 'grading/2');
  if (kind === 'schema') value.progress_schema = 2;
  vi.mocked(takePreloadedManifest).mockReturnValue(Promise.resolve(value));
  await expect(currentReleaseId()).rejects.toThrow('unsupported_release'); expect(fetchManifest).not.toHaveBeenCalled();
});
test('retries the ordinary manifest request after an acknowledged worker request fails', async () => {
  vi.mocked(takePreloadedManifest).mockReturnValue(Promise.reject(new Error('content_unavailable')));
  vi.mocked(fetchManifest).mockResolvedValue({ manifest: manifest(), digest: 'hash', response: new Response() } as Awaited<ReturnType<typeof fetchManifest>>);
  await expect(currentReleaseId()).resolves.toBe(`${version}-123456789abcdef0`); expect(fetchManifest).toHaveBeenCalledOnce();
});
