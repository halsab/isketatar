export const BASE_PATH = '/isketatar/';

export function assetUrl(path: string): string {
  if (!path || !/^[A-Za-z0-9_./-]+$/u.test(path) || path.startsWith('/') || path.split('/').some(p => p === '..' || p === '.')) {
    throw new Error('invalid_asset_path');
  }
  return BASE_PATH + path;
}
