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
  it('loads the visible lexicon without course vocabulary, then adds vocabulary without fetching entries again', async () => {
    const dictionary = projected.dictionary as { entries: unknown[]; vocabulary: unknown[] };
    const resources = new Map(Object.entries({ 'core.json': projected.core, 'dictionary-entries.json': { entries: dictionary.entries, vocabulary: [] }, 'vocabulary.json': { entries: [], vocabulary: dictionary.vocabulary } }).map(([name, data]) => [`/isketatar/runtime/${name}`, JSON.stringify(data)]));
    const request = vi.fn(async (url: string) => new Response(resources.get(url), { headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', request);
    const assets = [...resources].map(([url, body]) => ({ ...asset, url, bytes: new TextEncoder().encode(body).length, sha256: createHash('sha256').update(body).digest('hex') }));
    const repository = await ContentRepository.open({ release_id: 'test', app_version: '1.0.0', content_version: 'test', content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: 0, assets, question_revisions: {}, policy_versions: POLICIES });
    await repository.load('dictionary-entries.json');
    expect(repository.catalog.lexicon.size).toBe(502); expect(repository.catalog.vocabulary.size).toBe(0);
    expect(request.mock.calls.some(([url]) => url.endsWith('/vocabulary.json'))).toBe(false);
    await repository.load('dictionary.json');
    expect(repository.catalog.vocabulary.size).toBe(282);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/dictionary-entries.json'))).toHaveLength(1);
  });
  it('accepts only matching bytes and schema', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'application/json' } })));
    await expect(checkedJson(asset, validate)).resolves.toEqual({ valid: true });
  });
  it('loads a retained single dictionary through the new lexicon name and retries a failed request', async () => {
    const resources = new Map(Object.entries({ 'core.json': projected.core, 'dictionary.json': projected.dictionary }).map(([name, data]) => [`/isketatar/runtime/${name}`, JSON.stringify(data)]));
    let failed = false;
    const request = vi.fn(async (url: string) => {
      if (url.endsWith('/dictionary.json') && !failed) { failed = true; return new Response('', { status: 503 }); }
      return new Response(resources.get(url), { headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', request);
    const assets = [...resources].map(([url, body]) => ({ ...asset, url, bytes: new TextEncoder().encode(body).length, sha256: createHash('sha256').update(body).digest('hex') }));
    const repository = await ContentRepository.open({ release_id: 'test', app_version: '1.0.0', content_version: 'test', content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: 0, assets, question_revisions: {}, policy_versions: POLICIES });
    await expect(repository.load('dictionary-entries.json')).rejects.toThrow('content_unavailable');
    expect(repository.catalog.lexicon.size).toBe(0);
    await repository.load('dictionary-entries.json');
    await repository.load('dictionary.json');
    expect(repository.catalog.lexicon.size).toBe(502); expect(repository.catalog.vocabulary.size).toBe(282);
    expect(request.mock.calls.filter(([url]) => url.endsWith('/dictionary.json'))).toHaveLength(2);
    expect(request.mock.calls.some(([url]) => url.endsWith('/dictionary-entries.json'))).toBe(false);
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
