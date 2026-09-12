import { afterEach, describe, expect, it, vi } from 'vitest';
import { POLICIES } from '../../domain/content/types';
import { parseRelease, releaseRoot, checkedResponse } from './manifest';
afterEach(() => vi.unstubAllGlobals());
const id = '1.0.0-0123456789abcdef'; const root = `/isketatar/releases/${id}/`;
const paths = ['index.html', 'recovery.html', 'runtime/core.json', 'assets/index-abc.js'];
const manifest = () => ({ release_id: id, app_version: '1.0.0', content_version: 'v1', content_schema: 1, progress_schema: 1, min_reader_version: '1.0.0', base_path: '/isketatar/', built_at: 1, policy_versions: POLICIES, question_revisions: {}, shell_assets: paths.map(path => root + path), assets: paths.map(path => ({ url: root + path, sha256: 'a'.repeat(64), bytes: 10, kind: path.endsWith('.json') ? 'content' : path.endsWith('.js') ? 'script' : 'shell', required: true })) });
describe('immutable release allowlist', () => {
  it('accepts one release and returns its stable immutable prefix', () => { expect(parseRelease(manifest()).release_id).toBe(id); expect(releaseRoot(id)).toBe(root); });
  it.each(['https://foreign.test/x.js', '/isketatar/releases/1.0.0-ffffffffffffffff/a.js', root + '../a.js', root + 'a.js?x', root + 'a%2f.js', root + 'sw.js'])('rejects an untrusted asset URL %s', url => { const value = manifest(); value.assets[0]!.url = url; expect(() => parseRelease(value)).toThrow('content_corrupt'); });
  it('rejects duplicate, oversized, missing shell and unknown top-level data', () => {
    for(const change of [(m: ReturnType<typeof manifest>) => m.assets.push(m.assets[0]!), (m: ReturnType<typeof manifest>) => {m.assets[0]!.bytes=9_000_000;}, (m: ReturnType<typeof manifest>) => {m.shell_assets=[];}, (m: ReturnType<typeof manifest>) => {Object.assign(m,{unknown:true});}]) { const value=manifest();change(value);expect(()=>parseRelease(value)).toThrow('content_corrupt'); }
  });
});
it('checks exact MIME, byte length and hash before returning any cacheable response', async () => {
  const bytes=new TextEncoder().encode('{}'); const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const asset={url:root+'runtime/core.json',bytes:2,sha256,kind:'content' as const,required:true};
  await expect(checkedResponse(new Response('{}',{headers:{'content-type':'application/json; charset=utf-8'}}),asset)).resolves.toBeInstanceOf(Response);
  for(const [body,mime]of[['{}','text/html'],['{ }','application/json'],['[]','application/json']])await expect(checkedResponse(new Response(body,{headers:{'content-type':mime!}}),asset)).rejects.toThrow('content_corrupt');
  await expect(checkedResponse(new Response('{}',{status:206,headers:{'content-type':'application/json'}}),asset)).rejects.toThrow('content_unavailable');
});

it('rejects a foreign origin, query and fragment even when the path and bytes match', async () => {
  vi.stubGlobal('location', {origin:'https://course.test'});
  const bytes=new TextEncoder().encode('{}');const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  const asset={url:root+'runtime/core.json',bytes:2,sha256};
  for(const url of ['https://foreign.test'+asset.url,'https://course.test'+asset.url+'?unexpected=1','https://course.test'+asset.url+'#x']) {
    const response=new Response('{}',{headers:{'content-type':'application/json'}});Object.defineProperty(response,'url',{value:url});
    await expect(checkedResponse(response,asset)).rejects.toThrow('content_corrupt');
  }
  const response=new Response('{}',{headers:{'content-type':'application/json'}});Object.defineProperty(response,'url',{value:'https://course.test'+asset.url});
  await expect(checkedResponse(response,asset)).resolves.toBeInstanceOf(Response);
});
