import type { Asset, ReleaseManifest } from '../../domain/content/types';
import { readBoundedBytes } from '../http';

export const PWA_BASE = '/isketatar/';
export const MAX_PACKAGE_BYTES = 8 * 1024 * 1024;
export const RELEASE_ID = /^\d+\.\d+\.\d+-[a-f0-9]{16}$/u;
export interface PackageManifest extends ReleaseManifest { shell_assets: string[] }
export function releaseRoot(id: string) { if (!RELEASE_ID.test(id)) throw new Error('content_corrupt'); return `${PWA_BASE}releases/${id}/`; }
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const hash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
const semver = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(value) && value.split('.').every(part => Number.isSafeInteger(Number(part)));
export function mimeFor(url: string): string[] {
  if (url.endsWith('.js')) return ['text/javascript', 'application/javascript'];
  if (url.endsWith('.json')) return ['application/json'];
  if (url.endsWith('.webmanifest')) return ['application/manifest+json', 'application/json'];
  if (url.endsWith('.html')) return ['text/html'];
  if (url.endsWith('.css')) return ['text/css'];
  if (url.endsWith('.woff2')) return ['font/woff2'];
  if (url.endsWith('.png')) return ['image/png'];
  if (url.endsWith('.txt')) return ['text/plain'];
  throw new Error('content_corrupt');
}
export function parseRelease(value: unknown): PackageManifest {
  const fail = (): never => { throw new Error('content_corrupt'); };
  const keys = ['release_id', 'app_version', 'content_version', 'content_schema', 'progress_schema', 'min_reader_version', 'base_path', 'built_at', 'assets', 'question_revisions', 'policy_versions', 'shell_assets'];
  if (!record(value) || Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) return fail();
  if (typeof value.release_id !== 'string' || !RELEASE_ID.test(value.release_id) || !semver(value.app_version) || !value.release_id.startsWith(`${value.app_version}-`) || !semver(value.min_reader_version)) return fail();
  if (value.base_path !== PWA_BASE || typeof value.content_version !== 'string' || !value.content_version || !integer(value.built_at) || !integer(value.content_schema) || value.content_schema < 1 || !integer(value.progress_schema) || value.progress_schema < 1) return fail();
  if (!record(value.policy_versions) || Object.keys(value.policy_versions).length !== 10 || Object.entries(value.policy_versions).some(([key, version]) => !['grading', 'normalization', 'mastery', 'diagnostic', 'final', 'review', 'exposure', 'release_access', 'search', 'import'].includes(key) || typeof version !== 'string' || !version || version.length > 100)) return fail();
  if (!record(value.question_revisions) || Object.keys(value.question_revisions).length > 10000 || Object.entries(value.question_revisions).some(([id, revision]) => !/^[A-Za-z0-9_-]{1,100}$/u.test(id) || !hash(revision))) return fail();
  if (!Array.isArray(value.assets) || !value.assets.length || value.assets.length > 1000) return fail();
  const root = releaseRoot(value.release_id); const urls = new Set<string>(); let total = 0;
  for (const asset of value.assets) {
    if (!record(asset) || Object.keys(asset).sort().join(',') !== 'bytes,kind,required,sha256,url' || typeof asset.url !== 'string' || !asset.url.startsWith(root)) return fail();
    const path = asset.url.slice(root.length);
    if (!/^(?:(?:index|recovery)\.html|manifest\.webmanifest|icons\/[A-Za-z0-9-]+\.png|licenses\/[A-Za-z0-9]+\.txt|sources\/sections\.json|runtime\/[A-Za-z0-9-]+\.json|assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2))$/u.test(path) || urls.has(asset.url)) return fail();
    const kind = path.endsWith('.js') ? 'script' : path.endsWith('.css') ? 'style' : path.endsWith('.woff2') ? 'font' : path.endsWith('.json') ? 'content' : path.endsWith('.html') ? 'shell' : 'media';
    if (asset.kind !== kind || asset.required !== true || !hash(asset.sha256) || !integer(asset.bytes) || asset.bytes === 0) return fail();
    total += asset.bytes; if (total > MAX_PACKAGE_BYTES) return fail(); urls.add(asset.url);
  }
  if (!Array.isArray(value.shell_assets) || new Set(value.shell_assets).size !== value.shell_assets.length || value.shell_assets.some(url => typeof url !== 'string' || !urls.has(url))) return fail();
  const shellAssets = value.shell_assets;
  if (['index.html', 'recovery.html', 'runtime/core.json'].some(path => !shellAssets.includes(root + path)) || !shellAssets.some(url => typeof url === 'string' && url.endsWith('.js'))) return fail();
  return value as unknown as PackageManifest;
}
export async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join(''); }
function unexpectedUrl(response: Response, path: string): boolean {
  return response.redirected || !!response.url && (typeof location === 'undefined' || response.url !== new URL(path, location.origin).href);
}
export async function checkedResponse(response: Response, asset: Pick<Asset, 'url' | 'bytes' | 'sha256'>): Promise<Response> {
  if (response.status !== 200 || response.type === 'opaque') throw new Error('content_unavailable');
  if (unexpectedUrl(response, asset.url) || !mimeFor(asset.url).includes(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '')) throw new Error('content_corrupt');
  const bytes = await readBoundedBytes(response, asset.bytes);
  if (bytes.length !== asset.bytes || await sha256(bytes) !== asset.sha256) throw new Error('content_corrupt');
  return new Response(bytes, { status: 200, headers: response.headers });
}
export async function fetchManifest(url: string, expectedHash?: string, signal?: AbortSignal): Promise<{ manifest: PackageManifest; digest: string; response: Response }> {
  if (!/^\/isketatar\/(?:releases\/\d+\.\d+\.\d+-[a-f0-9]{16}\/)?release-manifest\.json$/u.test(url)) throw new Error('content_corrupt');
  const response = await fetch(url, { redirect: 'error', cache: 'no-store', signal });
  if (response.status !== 200) throw new Error('content_unavailable');
  if (unexpectedUrl(response, url) || !mimeFor(url).includes(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '')) throw new Error('content_corrupt');
  const bytes = await readBoundedBytes(response, 1_000_000); const digest = await sha256(bytes);
  if (expectedHash && digest !== expectedHash) throw new Error('content_corrupt');
  const manifest = parseRelease(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (url !== `${PWA_BASE}release-manifest.json` && url !== `${releaseRoot(manifest.release_id)}release-manifest.json`) throw new Error('content_corrupt');
  return { manifest, digest, response: new Response(bytes, { headers: response.headers }) };
}
