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
  await page.goto('./#/settings');await page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true}).click();await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
  const release=await(await page.request.get('./release-manifest.json')).json();
  for(const corrupt of [false,true]){
    await page.evaluate(async({id,corrupt})=>{const cache=await caches.open(`isketatar-shell-${id}`);const path=`/isketatar/releases/${id}/release-manifest.json`;if(corrupt)await cache.put(path,new Response('{}'));else await cache.delete(path);},{id:release.release_id,corrupt});
    await page.reload();await expect(page.getByText('Курсның бер өлеше җитми. Кабат сакларга кирәк.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Интернетсыз уку өчен сакларга',exact:true}).click();await expect(page.getByText('Курс интернетсыз уку өчен әзер.',{exact:true})).toBeVisible();
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
