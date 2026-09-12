export const BASE_PATH = '/isketatar/';

export function assetUrl(path: string): string {
  if (!path || !/^[A-Za-z0-9_./-]+$/u.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('invalid_asset_path');
  }
  return (import.meta.env.DEV ? BASE_PATH : import.meta.env.BASE_URL) + path;
}
