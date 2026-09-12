import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PackageStore } from './packages';
import { ReleaseLifecycle } from './lifecycle';
import { emptyRegistry, type RegistryStore } from './registry';
import { POLICIES } from '../../domain/content/types';
import { sha256, type PackageManifest } from './manifest';
afterEach(()=>vi.unstubAllGlobals());
const id='1.0.0-0123456789abcdef';const root=`/isketatar/releases/${id}/`;
let storage: RegistryStore;let caches: CacheStorage;let manifest: PackageManifest;let request: typeof fetch;
class MemoryCache {
  items=new Map<string,Response>();
  async match(key:string){return this.items.get(key)?.clone();}
  async put(key:string,value:Response){this.items.set(key,value.clone());}
  async delete(key:string){return this.items.delete(key);}
  async keys(){return [...this.items.keys()].map(url=>new Request('https://course.test'+url));}
}
beforeEach(async()=>{
  let state=emptyRegistry(); storage={read:async()=>structuredClone(state),change:async change=>{const next=structuredClone(state);change(next);state=next;return structuredClone(state);}};
  const stores=new Map<string,MemoryCache>();caches={open:async(name:string)=>{if(!stores.has(name))stores.set(name,new MemoryCache());return stores.get(name)!;},delete:async(name:string)=>stores.delete(name),keys:async()=>[...stores.keys()]} as unknown as CacheStorage;
  const paths=['index.html','recovery.html','runtime/core.json','assets/index-abc.js','runtime/module-M01.json'];
  const bodies=['<html>course</html>','<html>help</html>',JSON.stringify({content_schema:1,content_version:'v1',questions:[],policy_versions:POLICIES}),'export{}','{}'];
  manifest={release_id:id,app_version:'1.0.0',content_version:'v1',content_schema:1,progress_schema:1,min_reader_version:'1.0.0',base_path:'/isketatar/',built_at:1,policy_versions:POLICIES,question_revisions:{},shell_assets:paths.slice(0,4).map(path=>root+path),assets:await Promise.all(paths.map(async(path,i)=>({url:root+path,sha256:await sha256(new TextEncoder().encode(bodies[i]!)),bytes:new TextEncoder().encode(bodies[i]!).length,kind:path.endsWith('.json')?'content' as const:path.endsWith('.js')?'script' as const:'shell' as const,required:true})))};
  request=vi.fn(async(input)=>{const path=String(input);if(path.endsWith('/release-manifest.json'))return new Response(JSON.stringify(manifest),{headers:{'content-type':'application/json'}});const index=manifest.assets.findIndex(asset=>asset.url===path);if(index<0)return new Response('',{status:404});return new Response(bodies[index],{headers:{'content-type':path.endsWith('.html')?'text/html':path.endsWith('.js')?'text/javascript':'application/json'}});});
});
async function packageStore(){const store=new PackageStore(storage,caches,request);await store.register(manifest,await sha256(new TextEncoder().encode(JSON.stringify(manifest))),new Response(JSON.stringify(manifest),{headers:{'content-type':'application/json'}}));return store;}
it('separates automatic shell from full readiness and detects evicted objects',async()=>{
  const store=await packageStore();await store.saveShell(id);
  expect((await storage.read()).releases[0]?.completeness).toBe('not_saved');expect(request).toHaveBeenCalledTimes(4);
  await store.download(id,new AbortController().signal,()=>{});expect((await storage.read()).releases[0]?.completeness).toBe('ready');
  await (await caches.open(`isketatar-course-${id}`)).delete(root+'runtime/module-M01.json');expect(await store.verify(id)).toBe(false);expect((await storage.read()).releases[0]?.completeness).toBe('incomplete');
});
it('rejects corrupt downloads, preserves shell and never removes a neighbouring cache',async()=>{
  await caches.open('another-project');const store=await packageStore();await store.saveShell(id);
  vi.mocked(request).mockResolvedValue(new Response('<html>wrong</html>',{headers:{'content-type':'text/html'}}));
  await expect(store.download(id,new AbortController().signal,()=>{})).rejects.toThrow('content_corrupt');expect((await storage.read()).releases[0]?.completeness).toBe('failed');
  expect(await caches.keys()).toContain('another-project');expect(await (await caches.open(`isketatar-shell-${id}`)).match(root+'index.html')).toBeDefined();
});
it('cancels before readiness, releases staging and keeps progress outside the storage API',async()=>{
  const store=await packageStore();await store.saveShell(id);const controller=new AbortController();
  await expect(store.download(id,controller.signal,()=>controller.abort())).rejects.toThrow();
  expect((await storage.read()).releases[0]?.completeness).toBe('not_saved');expect((await storage.read()).offline_requested).toBe(false);expect(await caches.keys()).not.toContain(`isketatar-course-${id}`);
});

it('repairs an evicted or corrupt manifest with the pinned digest, including a warm worker',async()=>{
  const store=await packageStore();await store.download(id,new AbortController().signal,()=>{});const cache=await caches.open(`isketatar-shell-${id}`);
  await cache.delete(root+'release-manifest.json');await expect(store.manifestResponse(id)).resolves.toBeInstanceOf(Response);
  expect((await storage.read()).releases[0]?.completeness).toBe('incomplete');
  await cache.put(root+'release-manifest.json',new Response('{}'));await expect(store.manifestResponse(id)).resolves.toBeInstanceOf(Response);
  expect(await store.verify(id)).toBe(true);
});
it('cleans failed staging even if writing the failure marker is denied',async()=>{
  const store=await packageStore();await store.saveShell(id);const change=storage.change;let calls=0;
  storage.change=async mutate=>{if(++calls>1)throw new DOMException('quota','QuotaExceededError');return change(mutate);};
  vi.mocked(request).mockRejectedValue(new DOMException('quota','QuotaExceededError'));
  await expect(store.download(id,new AbortController().signal,()=>{})).rejects.toThrow('quota');
  expect(await caches.keys()).not.toContain(`isketatar-course-${id}`);expect(await caches.keys()).toContain(`isketatar-shell-${id}`);
});
it('invokes the default browser fetch without binding it to the package object',async()=>{
  vi.stubGlobal('fetch',function(this:unknown,...args:Parameters<typeof fetch>){expect(this).toBeUndefined();return request(...args);});
  const store=new PackageStore(storage,caches);const body=JSON.stringify(manifest);await store.register(manifest,await sha256(new TextEncoder().encode(body)),new Response(body));await store.saveShell(id);
});

async function lifecycleFixture() {
  const store = await packageStore(); await store.download(id, new AbortController().signal, () => {});
  const lifecycle = new ReleaseLifecycle(store, request);
  const candidate = async (next: string) => {
    const previous = manifest.release_id;
    manifest = { ...manifest, release_id: next, assets: manifest.assets.map(asset => ({ ...asset, url: asset.url.replace(previous, next) })), shell_assets: manifest.shell_assets.map(url => url.replace(previous, next)) };
    await lifecycle.check([]); return next;
  };
  const download = (target: string) => store.download(target, new AbortController().signal, () => {}, false);
  return { store, lifecycle, candidate, download };
}
const r2 = '1.0.0-2222222222222222'; const r3 = '1.0.0-3333333333333333';
const pin = { session_id: 'saved-session', release_id: id, content_schema: 1, policy_versions: POLICIES };
it('stages explicitly, keeps current until commit, and blocks R3 while an R1 session is pinned', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2);
  expect((await storage.read()).current_release_id).toBe(id);
  await expect(lifecycle.prepare('update-1', id, r2, [pin])).rejects.toThrow('retained_incomplete');
  await download(r2); await lifecycle.prepare('update-1', id, r2, [pin]);
  expect((await storage.read()).current_release_id).toBe(id);
  await lifecycle.commit('update-1', [pin]); await lifecycle.finish('update-1', [pin]);
  expect(await storage.read()).toMatchObject({ current_release_id: r2, previous_release_id: id, candidate_release_id: null, operation: null });
  await candidate(r3); await download(r3);
  await expect(lifecycle.prepare('update-2', r2, r3, [pin])).rejects.toThrow('release_pinned');
  expect((await storage.read()).current_release_id).toBe(r2);
  await lifecycle.prepare('update-2', r2, r3, []); await lifecycle.commit('update-2', []);
  expect(await caches.keys()).toContain(`isketatar-course-${id}`);
  await lifecycle.finish('update-2', []);
  expect(await caches.keys()).not.toContain(`isketatar-course-${id}`);
  expect((await storage.read()).releases.map(entry => entry.release_id)).toEqual([r2, r3]);
});
it('recovers prepared and committed operations idempotently without rollback or premature cleanup', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  await lifecycle.prepare('update-1', id, r2, []); await lifecycle.prepare('update-1', id, r2, []);
  await expect(lifecycle.commit('different', [])).rejects.toThrow('update_conflict');
  await lifecycle.commit('update-1', []); await lifecycle.commit('update-1', []);
  await expect(lifecycle.cancel('update-1')).rejects.toThrow('update_committed');
  await lifecycle.finish('update-1', []); expect((await storage.read()).current_release_id).toBe(r2);
});
it('rechecks pins at commit and never deletes an old cache before the role transaction succeeds', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  await lifecycle.prepare('update-1', id, r2, []); await lifecycle.commit('update-1', []); await lifecycle.finish('update-1', []);
  await candidate(r3); await download(r3); await lifecycle.prepare('update-2', r2, r3, []);
  await expect(lifecycle.commit('update-2', [pin])).rejects.toThrow('release_pinned');
  expect(await storage.read()).toMatchObject({ current_release_id: r2, previous_release_id: id, operation: { phase: 'prepared' } });
  expect(await caches.keys()).toContain(`isketatar-course-${id}`); await lifecycle.cancel('update-2');
});
it('candidate cancellation preserves current offline intent and expiry never touches retained or foreign caches', async () => {
  const { store, lifecycle, candidate } = await lifecycleFixture(); await caches.open('another-project'); await candidate(r2);
  const controller = new AbortController();
  await expect(store.download(r2, controller.signal, () => controller.abort(), false)).rejects.toThrow();
  expect((await storage.read()).offline_requested).toBe(true);
  await storage.change(value => { value.releases.find(entry => entry.release_id === r2)!.created_at = 1; });
  await lifecycle.cleanup(86_400_002, []);
  expect((await storage.read()).candidate_release_id).toBeNull();
  expect(await caches.keys()).toContain('another-project'); expect(await store.verify(id)).toBe(true);
});
it('rejects a candidate reader that cannot preserve the pinned policy and requires the retained package in full', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  await expect(lifecycle.prepare('update-1', id, r2, [{ ...pin, policy_versions: { ...POLICIES, grading: 'grading/2' } as unknown as typeof POLICIES }])).rejects.toThrow('unsupported_release');
  await (await caches.open(`isketatar-course-${id}`)).delete(root + 'runtime/module-M01.json');
  await expect(lifecycle.prepare('update-1', id, r2, [pin])).rejects.toThrow('retained_incomplete');
  expect((await storage.read()).operation).toBeNull();
});
it('detects eviction between prepare and commit while preserving the accepted release', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  await lifecycle.prepare('update-1', id, r2, []);
  await (await caches.open(`isketatar-course-${r2}`)).delete(`/isketatar/releases/${r2}/runtime/module-M01.json`);
  await expect(lifecycle.commit('update-1', [])).rejects.toThrow('retained_incomplete');
  expect((await storage.read()).current_release_id).toBe(id);
});
it('keeps a ready candidate for seven days and cleans only unoccupied owned orphan caches', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  const orphan = '1.0.0-4444444444444444'; await caches.open(`isketatar-course-${orphan}`);
  await caches.open(orphan);
  await storage.change(value => { value.releases.find(entry => entry.release_id === r2)!.verified_at = 1; });
  await lifecycle.cleanup(2 * 86_400_000, [orphan]);
  expect((await storage.read()).candidate_release_id).toBe(r2); expect(await caches.keys()).toContain(`isketatar-course-${orphan}`);
  await lifecycle.cleanup(8 * 86_400_000, []);
  expect((await storage.read()).candidate_release_id).toBeNull(); expect(await caches.keys()).not.toContain(`isketatar-course-${orphan}`);
  expect(await caches.keys()).toContain(orphan);
});
it('retains the committed marker across a cleanup failure so the same operation can finish safely', async () => {
  const { lifecycle, candidate, download } = await lifecycleFixture();
  await candidate(r2); await download(r2); await lifecycle.prepare('update-1', id, r2, []); await lifecycle.commit('update-1', []); await lifecycle.finish('update-1', []);
  await candidate(r3); await download(r3); await lifecycle.prepare('update-2', r2, r3, []); await lifecycle.commit('update-2', []);
  const remove = vi.spyOn(caches, 'delete').mockRejectedValueOnce(new DOMException('denied', 'SecurityError'));
  await expect(lifecycle.finish('update-2', [])).rejects.toThrow('denied');
  expect(await storage.read()).toMatchObject({ current_release_id: r3, operation: { phase: 'committed' } });
  remove.mockRestore(); await lifecycle.finish('update-2', []); expect((await storage.read()).operation).toBeNull();
});
it('removes course and candidate caches after revoking readiness while preserving current/previous shells and foreign caches', async () => {
  const { store, lifecycle, candidate, download } = await lifecycleFixture(); await candidate(r2); await download(r2);
  await lifecycle.prepare('update', id, r2, []); await lifecycle.commit('update', []); await lifecycle.finish('update', []);
  await candidate(r3); await download(r3); await caches.open('another-course');
  const remove = caches.delete.bind(caches); vi.spyOn(caches, 'delete').mockImplementation(async name => {
    const state = await storage.read(); expect(state.offline_requested).toBe(false); expect(state.releases.every(entry => entry.completeness !== 'ready')).toBe(true);
    return remove(name);
  });
  await store.removeOffline();
  const state = await storage.read(); expect(state).toMatchObject({ current_release_id: r2, previous_release_id: id, candidate_release_id: null, offline_requested: false, offline_epoch: 1 });
  expect(state.releases.every(entry => entry.completeness === 'not_saved')).toBe(true);
  expect(await caches.keys()).toEqual(expect.arrayContaining([`isketatar-shell-${id}`, `isketatar-shell-${r2}`, 'another-course']));
  expect((await caches.keys()).some(name => name.startsWith('isketatar-course-') || name.endsWith(r3))).toBe(false);
});
it('keeps incomplete removal retryable after a cache failure and never restores full offline intent', async () => {
  const store = await packageStore(); await store.download(id, new AbortController().signal, () => {});
  const remove = vi.spyOn(caches, 'delete').mockRejectedValueOnce(new DOMException('denied', 'SecurityError'));
  await expect(store.removeOffline()).rejects.toThrow('denied');
  expect(await storage.read()).toMatchObject({ offline_requested: false, releases: [expect.objectContaining({ completeness: 'incomplete', verified_at: null })] });
  remove.mockRestore(); await store.removeOffline(); expect((await storage.read()).releases[0]?.completeness).toBe('not_saved');
});
