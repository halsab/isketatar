import { createHash } from 'node:crypto';
import { test, expect } from '../helpers/pwa';
test.use({ serviceWorkers: 'allow' });
test('full package survives a cold offline window and opens unvisited course routes', async ({ context, page, network }) => {
  await page.goto('./#/settings');
  await expect(page.getByRole('button', {name:'Интернетсыз уку өчен сакларга',exact:true})).toBeEnabled();
  await expect(page.getByText('Тулы курс әлегә сакланмаган.',{exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Интернетсыз уку өчен сакларга',exact:true}).click();
  await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
  const release=await (await page.request.get('./release-manifest.json')).json();
  network.setOffline(true);await page.close();const cold=await context.newPage();
  const errors:string[]=[];cold.on('pageerror',error=>errors.push(error.message));
  await cold.goto('./#/settings');await expect(cold.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
  for(const route of ['lessons/B01','lessons/C01','lessons/V04','lessons/K01','lessons/G01','lessons/A01','lessons/L01','lessons/H01']) {await cold.goto(`./#/${route}`);await expect(cold.locator('.lesson-example').first()).toBeVisible();}
  await cold.goto('./#/dictionary/lex-55-044');await expect(cold.locator('main .arabic').first()).toBeVisible();
  await cold.goto('./#/reading/READ-03');await expect(cold.locator('.reading-line').first()).toBeVisible();
  await cold.goto('./#/reference/letters');await expect(cold.getByRole('heading',{name:'Хәрефләр',exact:true})).toBeVisible();
  await cold.goto('./#/final');await expect(cold.getByRole('button',{name:'Башларга',exact:true})).toBeVisible();
  const cached=await cold.evaluate(async({id,assets})=>{const all=[...await(await caches.open(`isketatar-shell-${id}`)).keys(),...await(await caches.open(`isketatar-course-${id}`)).keys()].map(request=>new URL(request.url).pathname);return assets.every((asset:{url:string})=>all.includes(asset.url));},{id:release.release_id,assets:release.assets});
  expect(cached).toBe(true);expect(errors).toEqual([]);
});
test('eviction changes readiness and retry repairs the exact resource', async ({ page }) => {
  await page.goto('./#/settings');const save=page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true});await save.click();
  await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
  const release=await(await page.request.get('./release-manifest.json')).json();
  await page.evaluate(async id=>{await(await caches.open(`isketatar-course-${id}`)).delete(`/isketatar/releases/${id}/runtime/readings.json`);},release.release_id);
  await page.getByRole('button',{name:'Сакланган курсны тикшерергә',exact:true}).click();await expect(page.getByText('Курсның бер өлеше җитми. Кабат сакларга кирәк.',{exact:true})).toBeVisible();
  await save.click();await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
});
for(const failure of ['registry','cache'] as const)test(`technical ${failure} denial keeps the installed online course usable`,async({context,page,browserName})=>{
  test.skip(browserName !== 'chromium', 'Playwright exposes service-worker fault injection only in Chromium.');
  await page.goto('./#/settings');await page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true}).click();await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
  await context.serviceWorkers()[0]!.evaluate(failure=>{
    if(failure==='registry')IDBDatabase.prototype.transaction=function(){throw new DOMException('denied','SecurityError');};
    else CacheStorage.prototype.open=async()=>{throw new DOMException('denied','SecurityError');};
  },failure);
  await page.reload();await page.goto('./#/lessons/V04');await expect(page.locator('.lesson-example').first()).toBeVisible();
});
test('a lost and corrupt release manifest repairs online without changing release or progress',async({page})=>{
  await page.goto('./#/lessons/V04/practice');
  await page.getByRole('link',{name:'Юлны сайларга',exact:true}).click();
  await page.getByRole('radio',{name:'Гарәп хәрефләрен беләм',exact:false}).check();
  await page.getByRole('button',{name:'Башларга',exact:true}).click();
  await page.getByRole('button',{name:'Башларга',exact:true}).click();
  await page.getByRole('textbox',{name:'Җавабың',exact:true}).fill('әңгәмә');
  await page.getByRole('button',{name:'Саклап чыгарга',exact:true}).click();
  await expect(page).toHaveURL(/#\/lessons\/V04$/u);
  await page.getByRole('link',{name:'Көйләүләр',exact:true}).click();
  const ready=page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true});
  const incomplete=page.getByText('Курсның бер өлеше җитми. Кабат сакларга кирәк.',{exact:true});
  const save=page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true});
  await save.click();await expect(ready).toBeVisible();
  const response=await page.request.get('./release-manifest.json');
  const bytes=await response.body();const release=JSON.parse(bytes.toString());
  const manifestHash=createHash('sha256').update(bytes).digest('hex');
  const snapshot=()=>page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('iske-imla-progress',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try {
      const tx=db.transaction(['meta','sessions','presentations','attempts'],'readonly');
      const all=(name:string)=>new Promise<unknown[]>((resolve,reject)=>{const request=tx.objectStore(name).getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      const [meta,sessions,presentations,attempts]=await Promise.all(['meta','sessions','presentations','attempts'].map(all));
      return {meta,sessions,presentations,attempts};
    } finally {db.close();}
  });
  const before=await snapshot();
  expect(before.meta).toContainEqual(expect.objectContaining({key:'control',accepted_release_id:release.release_id}));
  expect(before.sessions).toContainEqual(expect.objectContaining({status:'paused',release_id:release.release_id}));
  expect(before.presentations).toContainEqual(expect.objectContaining({draft_answer:{kind:'text',text:'әңгәмә'}}));
  for(const corrupt of [false,true]){
    await page.evaluate(async({id,corrupt})=>{const cache=await caches.open(`isketatar-shell-${id}`);const path=`/isketatar/releases/${id}/release-manifest.json`;if(corrupt)await cache.put(path,new Response('{}'));else await cache.delete(path);},{id:release.release_id,corrupt});
    await page.reload();await expect(ready.or(incomplete)).toBeVisible();
    // Полная проверка при bootstrap может закончить восстановление до первого UI; промежуточный статус необязателен.
    if(await incomplete.isVisible())await save.click();
    await expect(ready).toBeVisible();
    const checked=await page.evaluate(async({release,manifestHash})=>{
      const shell=await caches.open(`isketatar-shell-${release.release_id}`);const course=await caches.open(`isketatar-course-${release.release_id}`);
      const hash=async(bytes:ArrayBuffer)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      const manifest=await shell.match(`/isketatar/releases/${release.release_id}/release-manifest.json`);
      const failures:string[]=[];
      if(!manifest||await hash(await manifest.arrayBuffer())!==manifestHash)failures.push('manifest');
      for(const asset of release.assets){
        const response=await(release.shell_assets.includes(asset.url)?shell:course).match(asset.url);
        if(!response){failures.push(asset.url);continue;}
        const bytes=await response.arrayBuffer();
        const type=response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
        const expected=asset.url.endsWith('.js')?['application/javascript','text/javascript']:asset.url.endsWith('.json')?['application/json']:asset.url.endsWith('.webmanifest')?['application/manifest+json','application/json']:asset.url.endsWith('.html')?['text/html']:asset.url.endsWith('.css')?['text/css']:asset.url.endsWith('.woff2')?['font/woff2']:asset.url.endsWith('.png')?['image/png']:['text/plain'];
        if(bytes.byteLength!==asset.bytes||await hash(bytes)!==asset.sha256||!expected.includes(type??''))failures.push(asset.url);
      }
      const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('isketatar-pwa',1);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try {
        const registry=await new Promise<any>((resolve,reject)=>{const request=db.transaction('registry').objectStore('registry').get('state');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
        return {failures,current:registry.current_release_id,manifestHash:registry.releases.find((entry:{release_id:string})=>entry.release_id===release.release_id).manifest_sha256};
      } finally {db.close();}
    },{release,manifestHash});
    expect(checked).toEqual({failures:[],current:release.release_id,manifestHash});
    expect(await snapshot()).toEqual(before);
  }
});

test('cancel aborts an in-flight download and quota has an actionable separate error',async({context,page,browserName})=>{
  test.skip(browserName !== 'chromium', 'Playwright exposes service-worker fault injection only in Chromium.');
  await page.goto('./#/settings');const save=page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true});await expect(save).toBeEnabled();
  const worker=context.serviceWorkers()[0]!;
  await worker.evaluate(()=>{const original=fetch;Object.assign(globalThis,{testFetch:original,testBlocked:false});globalThis.fetch=(input,init)=>{
    if(String(input).endsWith('/runtime/module-M01.json')){Object.assign(globalThis,{testBlocked:true});return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}));}return original(input,init);
  };});
  await save.click();await expect.poll(()=>worker.evaluate(()=>Reflect.get(globalThis,'testBlocked'))).toBe(true);
  await page.getByRole('button',{name:'Кире кагарга',exact:true}).click();await expect(page.getByText('Тулы курс әлегә сакланмаган.',{exact:true})).toBeVisible();await expect(save).toBeEnabled();
  expect(await page.evaluate(async()=> (await caches.keys()).filter(name=>name.startsWith('isketatar-course-')))).toEqual([]);
  await worker.evaluate(()=>{globalThis.fetch=Reflect.get(globalThis,'testFetch');const put=Cache.prototype.put;Cache.prototype.put=function(request,response){if(String(request).endsWith('/runtime/module-M01.json'))return Promise.reject(new DOMException('quota','QuotaExceededError'));return put.call(this,request,response);};});
  await save.click();await expect(page.getByText('Саклау урыны җитми.',{exact:false})).toBeVisible();await expect(save).toBeEnabled();
  expect(await page.evaluate(async()=> (await caches.keys()).filter(name=>name.startsWith('isketatar-course-')))).toEqual([]);
});
