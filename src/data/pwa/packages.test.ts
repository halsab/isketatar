import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PackageStore } from './packages';
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
