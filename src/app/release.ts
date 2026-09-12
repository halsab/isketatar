import manifest from '../generated/content-index.json';
import { assetUrl, BASE_PATH } from './paths';
import { readBoundedBytes } from '../data/http';
import packageInfo from '../../package.json';
import { POLICIES } from '../domain/content/types';

function version(value: unknown): number[] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value)) throw new Error('unsupported_release');
  const parts = value.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw new Error('unsupported_release');
  return parts;
}

function readerSupported(minimum: unknown) {
  const required = version(minimum); const current = version(packageInfo.version);
  for (let index = 0; index < 3; index++) {
    if (required[index]! !== current[index]!) return required[index]! < current[index]!;
  }
  return true;
}

export async function currentReleaseId(): Promise<string> {
  if (import.meta.env.DEV) return `development-${manifest.content_version}`;
  const response = await fetch(assetUrl('release-manifest.json'), { redirect: 'error', cache: 'no-cache' });
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('content_unavailable');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedBytes(response, 1_000_000));
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== 'object') throw new Error('content_corrupt');
  const releaseId: unknown = Reflect.get(value, 'release_id');
  const assets: unknown = Reflect.get(value, 'assets');
  if (typeof releaseId !== 'string' || !/^\d+\.\d+\.\d+-[a-f0-9]{16}$/u.test(releaseId) || !Array.isArray(assets)) throw new Error('content_corrupt');
  if (Reflect.get(value, 'content_version') !== manifest.content_version || Reflect.get(value, 'content_schema') !== 1 || Reflect.get(value, 'progress_schema') !== 1) throw new Error('unsupported_release');
  if (!readerSupported(Reflect.get(value, 'min_reader_version')) || Reflect.get(value, 'app_version') !== packageInfo.version || Reflect.get(value, 'base_path') !== BASE_PATH) throw new Error('unsupported_release');
  const policies: unknown = Reflect.get(value, 'policy_versions');
  if (!policies || typeof policies !== 'object' || Object.keys(policies).length !== Object.keys(POLICIES).length || Object.entries(POLICIES).some(([key, supported]) => Reflect.get(policies, key) !== supported)) throw new Error('unsupported_release');
  for (const expected of manifest.assets) {
    const asset: unknown = assets.find(item => item && typeof item === 'object' && Reflect.get(item, 'url') === expected.url);
    if (!asset || typeof asset !== 'object' || Reflect.get(asset, 'sha256') !== expected.sha256 || Reflect.get(asset, 'bytes') !== expected.bytes) throw new Error('unsupported_release');
  }
  return releaseId;
}
