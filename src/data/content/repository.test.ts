import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkedJson, ContentRepository } from './repository';
import { createHash } from 'node:crypto';
import { POLICIES } from '../../domain/content/types';
import { projected } from '../../../tests/content-fixture';

const bytes = '{"valid":true}';
const asset = { url: '/isketatar/test.json', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'content' as const, required: true };
const validate = (value: unknown): value is { valid: true } => typeof value === 'object' && value !== null && Reflect.get(value, 'valid') === true;
afterEach(() => vi.unstubAllGlobals());

describe('verified content loading', () => {
  it('accepts only matching bytes and schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/json' } })));
    await expect(checkedJson(asset, validate)).resolves.toEqual({ valid: true });
  });
  it.each([['<html>broken</html>', 'text/html'], ['{"valid":null}', 'application/json'], [bytes + ' ', 'application/json']])('rejects corruption without projecting %s', async (body, mime) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': mime } })));
    await expect(checkedJson(asset, validate)).rejects.toThrow('content_corrupt');
  });
  it.each(['schema', 'policy'])('distinguishes intact but incompatible content: %s', async kind => {
    const core = { ...(projected.core as object), ...(kind === 'schema' ? { content_schema: 2 } : { policy_versions: { ...POLICIES, grading: 'grading/2' } }) };
    const body = JSON.stringify(core);
    const coreAsset = { ...asset, url: '/isketatar/runtime/core.json', bytes: new TextEncoder().encode(body).length, sha256: createHash('sha256').update(body).digest('hex') };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'application/json' } })));
    await expect(ContentRepository.open({ release_id: 'test', app_version: '1.0.0', content_version: 'test', content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: 0, assets: [coreAsset], question_revisions: {}, policy_versions: POLICIES })).rejects.toThrow('unsupported_release');
  });
});
