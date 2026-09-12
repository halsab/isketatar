import { describe, expect, it } from 'vitest';
import { assetUrl } from './paths';

describe('project asset paths', () => {
  it('keeps assets inside the Pages project', () => {
    expect(assetUrl('content/manifest.json')).toBe('/isketatar/content/manifest.json');
  });
  it.each(['/outside', '../outside', 'a/../b', 'a\\b', 'a?b', ''])('rejects %s', path => {
    expect(() => assetUrl(path)).toThrow('invalid_asset_path');
  });
});
