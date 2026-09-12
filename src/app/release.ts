import manifest from '../generated/content-index.json';
import { assetUrl, BASE_PATH } from './paths';
import { fetchManifest, parseRelease } from '../data/pwa/manifest';
import { takePreloadedManifest } from '../data/pwa/manifest-preload-client';
import packageInfo from '../../package.json';
import { POLICIES } from '../domain/content/types';

function version(value: unknown): number[] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) throw new Error('unsupported_release');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('unsupported_release');
  return parts;
}

export function readerSupported(minimum: unknown) {
  const required = version(minimum); const current = version(packageInfo.version);
  for (let index = 0; index < 3; index++) {
    if (required[index]! !== current[index]!) return required[index]! < current[index]!;
  }
  return true;
}

export async function currentReleaseId(): Promise<string> {
  if (import.meta.env.DEV) return `development-${manifest.content_version}`;
  const url = assetUrl('release-manifest.json');
  const preloaded = takePreloadedManifest(url);
  const request = async () => (await fetchManifest(url)).manifest;
  const value = preloaded ? parseRelease(await preloaded.catch(request)) : await request();
  if (value.content_version !== manifest.content_version || value.content_schema !== 1 || value.progress_schema !== 1) throw new Error('unsupported_release');
  if (!readerSupported(value.min_reader_version) || value.app_version !== packageInfo.version || value.base_path !== BASE_PATH) throw new Error('unsupported_release');
  if (Object.entries(POLICIES).some(([key, supported]) => Reflect.get(value.policy_versions, key) !== supported)) throw new Error('unsupported_release');
  for (const expected of manifest.assets) {
    const asset = value.assets.find(item => item.url === assetUrl(expected.url.slice(BASE_PATH.length)));
    if (!asset || asset.sha256 !== expected.sha256 || asset.bytes !== expected.bytes) throw new Error('unsupported_release');
  }
  if (assetUrl('release-manifest.json') !== `${BASE_PATH}releases/${value.release_id}/release-manifest.json`) throw new Error('unsupported_release');
  return value.release_id;
}
