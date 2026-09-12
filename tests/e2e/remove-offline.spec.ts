import { test, expect, type Page } from '@playwright/test';
import { releaseServer } from '../helpers/releases';
test.use({ serviceWorkers: 'allow' });
let releases: Awaited<ReturnType<typeof releaseServer>>;
test.beforeAll(async () => { releases = await releaseServer(); });
test.afterAll(async () => { await releases?.close(); });
test.beforeEach(() => releases.reset());
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('iske-imla-progress', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['meta', 'sessions', 'presentations', 'attempts']);
    const get = (store: string, key?: string) => new Promise<any>((resolve, reject) => { const request = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [control, sessions, presentations, attempts] = await Promise.all([get('meta', 'control'), get('sessions'), get('presentations'), get('attempts')]); db.close(); return { control, sessions, presentations, attempts };
  });
}
async function save(page: Page) { await page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click(); await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible(); }
async function remove(page: Page) { await page.getByRole('button', { name: 'Сакланган курсны бетерергә', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Сакланган курсны бетерергә', exact: true }).click(); }
async function practice(page: Page) {
  await page.goto(releases.url + '#/lessons/V04/practice'); await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click(); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
}
test('removal preserves progress and shells, removes staged release, and fences an old download request', async ({ page, context }) => {
  await page.addInitScript(() => navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'isketatar:pwa-cancelled') event.stopImmediatePropagation(); }));
  await practice(page); await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('сакланган җавап');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await page.getByRole('link', { name: 'Көйләүләр', exact: true }).click(); await save(page);
  const viewer = await context.newPage(); await viewer.goto(releases.url + '#/settings');
  releases.publish(); await page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true }).click(); await expect(page.getByText(`Яңа басма бар: ${releases.next}.`, { exact: false })).toBeVisible();
  await page.evaluate(() => caches.open('another-application'));
  const before = await snapshot(page); const start = await viewer.evaluate(() => performance.timeOrigin);
  await remove(page); await expect(page.getByText('Тулы курс әлегә сакланмаган.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Сакланган курсны бетерү', exact: true })).toHaveCount(0);
  await expect(viewer.locator('main [inert]')).toHaveCount(0); expect(await viewer.evaluate(() => performance.timeOrigin)).toBe(start);
  const after = await snapshot(page); expect(after.presentations).toEqual(before.presentations); expect(after.attempts).toEqual(before.attempts); expect(after.sessions).toEqual(before.sessions);
  expect(after.control).toMatchObject({ update_gate: null, data_generation: before.control.data_generation, accepted_release_id: releases.original });
  const names = await page.evaluate(() => caches.keys()); expect(names).toContain(`isketatar-shell-${releases.original}`); expect(names).toContain('another-application'); expect(names).not.toContain(`isketatar-shell-${releases.next}`);
  expect(await page.evaluate(async id => (await (await caches.open(`isketatar-course-${id}`)).keys()).length, releases.original)).toBe(0);
  const stale = await page.evaluate(id => new Promise<string>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = event => { resolve(event.data.error); channel.port1.close(); }; navigator.serviceWorker.getRegistration().then(registration => registration!.active!.postMessage({ type: 'download', release_id: id, offline_epoch: 0 }, [channel.port2])); }), releases.original);
  expect(stale).toBe('offline_changed');
  releases.setOffline(true); await viewer.goto(releases.url + 'recovery.html'); await expect(viewer.getByRole('heading', { name: 'Курс ачылмады', exact: true })).toBeVisible();
  releases.setOffline(false); await viewer.close(); await save(page);
});
test('failed deletion keeps an incomplete marker and a different window can recover and retry', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes service-worker fault injection only in Chromium.');
  await page.goto(releases.url + '#/settings'); await save(page); const before = await snapshot(page);
  const viewer = await context.newPage(); await viewer.goto(releases.url + '#/settings');
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(() => { const remove = CacheStorage.prototype.delete; Object.assign(globalThis, { restoreDelete: () => { CacheStorage.prototype.delete = remove; } }); CacheStorage.prototype.delete = () => Promise.reject(new DOMException('test denial', 'SecurityError')); });
  await remove(page); await expect(page.getByText('Бетерү тәмамланмады.', { exact: false }).first()).toBeVisible();
  expect((await snapshot(page)).control.update_gate).toMatchObject({ phase: 'quiescing', purpose: 'remove_offline' });
  await worker.evaluate(() => Reflect.get(globalThis, 'restoreDelete')()); await page.close();
  await viewer.getByRole('button', { name: 'Бетерүне бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await viewer.getByRole('dialog').getByRole('button', { name: 'Бетерүне бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await expect(viewer.getByText('Тулы курс әлегә сакланмаган.', { exact: true })).toBeVisible();
  expect((await snapshot(viewer)).control).toMatchObject({ update_gate: null, data_generation: before.control.data_generation, writer_epoch: before.control.writer_epoch + 1 });
});
test('memory answers survive removal and a lost completion broadcast without consent to discard or reload', async ({ page, context }) => {
  await page.addInitScript(() => navigator.serviceWorker.addEventListener('message', event => { if (event.data?.type === 'isketatar:pwa-cancelled') event.stopImmediatePropagation(); }));
  await practice(page);
  await page.evaluate(() => { const put = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (value, key) { if (this.name === 'presentations' && value.draft_answer?.kind === 'text') throw new DOMException('quota', 'QuotaExceededError'); return key === undefined ? put.call(this, value) : put.call(this, value, key); }; });
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('хәтердәге җавап'); await page.getByRole('button', { name: 'Вакытлыча саклап дәвам итәргә', exact: true }).click();
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toBeVisible();
  const writer = await context.newPage(); await writer.goto(releases.url + '#/settings'); await writer.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click(); await writer.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click(); await save(writer);
  const start = await page.evaluate(() => performance.timeOrigin); await remove(writer); await expect(writer.getByText('Тулы курс әлегә сакланмаган.', { exact: true })).toBeVisible();
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toBeVisible(); expect(await page.evaluate(() => performance.timeOrigin)).toBe(start);
  await expect(page.getByRole('button', { name: 'Вакытлыча эшне калдырып яңартырга', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click(); await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('хәтердәге җавап');
});
test('an unknown window blocks removal without revoking the ready package', async ({ page, context }) => {
  test.setTimeout(60_000); await page.goto(releases.url + '#/settings'); await save(page);
  const unknown = await context.newPage(); await unknown.goto(releases.url + `releases/${releases.original}/recovery.html`);
  await remove(page); await expect(page.getByText('Бетерү тәмамланмады.', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeAttached();
  await unknown.close(); await page.getByRole('button', { name: 'Бетерүне кабатларга', exact: true }).click(); await expect(page.getByText('Тулы курс әлегә сакланмаган.', { exact: true })).toBeVisible();
});
