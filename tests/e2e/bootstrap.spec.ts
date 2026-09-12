import { test, expect } from '../helpers/pwa';
import type { Page } from '@playwright/test';
test.use({ serviceWorkers: 'allow' });
const old = '1.0.0-1111111111111111';
async function seedCommit(page: Page, phase: 'quiescing' | 'commit') {
  return page.evaluate(async ({ old, phase }) => {
    const db = (name: string) => new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name, 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = (database: IDBDatabase, store: string, key: string) => new Promise<any>((resolve, reject) => { const request = database.transaction(store).objectStore(store).get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const put = (database: IDBDatabase, store: string, value: unknown, key?: string) => new Promise<void>((resolve, reject) => { const tx = database.transaction(store, 'readwrite'); if (key) tx.objectStore(store).put(value, key); else tx.objectStore(store).put(value); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    const progress = await db('iske-imla-progress'); const control = await read(progress, 'meta', 'control');
    const registry = await db('isketatar-pwa'); const state = await read(registry, 'registry', 'state'); const current = state.current_release_id; const updateId = crypto.randomUUID();
    state.previous_release_id = old;
    state.releases.push({ ...state.releases.find((entry: any) => entry.release_id === current), release_id: old, manifest_url: `/isketatar/releases/${old}/release-manifest.json`, shell_cache: `isketatar-shell-${old}`, course_cache: `isketatar-course-${old}` });
    state.operation = { update_id: updateId, from_release_id: old, target_release_id: current, phase: 'committed' };
    control.accepted_release_id = old; control.update_gate = { update_id: updateId, target_release_id: current, coordinator_id: control.writer_id, phase, requested_at: Date.now() };
    await put(registry, 'registry', state, 'state'); await put(progress, 'meta', control); progress.close(); registry.close();
    return { current, generation: control.data_generation, revision: control.state_revision };
  }, { old, phase });
}
async function control(page: Page) {
  return page.evaluate(() => new Promise<any>((resolve, reject) => { const open = indexedDB.open('iske-imla-progress', 1); open.onerror = () => reject(open.error); open.onsuccess = () => { const db = open.result; const request = db.transaction('meta').objectStore('meta').get('control'); request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => { db.close(); reject(request.error); }; }; }));
}
test('a hard reload with an unaccepted shell cannot write and offers the accepted release', async ({ page }) => {
  await page.goto('./#/settings'); await expect(page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true })).toBeEnabled();
  const before = await control(page);
  await page.evaluate(old => new Promise<void>((resolve, reject) => { const open = indexedDB.open('iske-imla-progress', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('meta', 'readwrite'); const store = tx.objectStore('meta'); const request = store.get('control'); request.onsuccess = () => store.put({ ...request.result, accepted_release_id: old }); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); }; }), old);
  await page.reload(); await expect(page.getByRole('button', { name: 'Сакланган басманы ачарга', exact: true })).toBeVisible();
  expect(await control(page)).toMatchObject({ accepted_release_id: old, state_revision: before.state_revision, data_generation: before.data_generation });
  for (const width of [1366, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const size of ['100%', '200%']) { await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  }
  await page.screenshot({ path: test.info().outputPath('unaccepted-shell.png'), fullPage: true });
});
test('a verified committed bootstrap finishes without resetting progress while contradictory phases stay blocked', async ({ page }) => {
  await page.goto('./#/settings'); await page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click(); await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible();
  const before = await seedCommit(page, 'quiescing'); await page.reload();
  await expect(page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true })).toHaveCount(0);
  expect(await control(page)).toMatchObject({ accepted_release_id: old, state_revision: before.revision, update_gate: { phase: 'quiescing' } });
  await page.evaluate(() => new Promise<void>(resolve => { const open = indexedDB.open('iske-imla-progress', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('meta', 'readwrite'); const store = tx.objectStore('meta'); const request = store.get('control'); request.onsuccess = () => { const value = request.result; value.update_gate.phase = 'commit'; store.put(value); }; tx.oncomplete = () => { db.close(); resolve(); }; }; }));
  await page.reload(); await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible();
  expect(await control(page)).toMatchObject({ accepted_release_id: before.current, data_generation: before.generation, state_revision: before.revision + 1, update_gate: null });
});
for (const [offline, immutable] of [[false, false], [true, false], [true, true]] as const) test(`the accepted shell recovers after the technical registry is lost (offline=${offline}, immutable=${immutable})`, async ({ page, context, network }) => {
  await page.goto('./#/settings'); await page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click(); await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible();
  const before = await control(page);
  await page.evaluate(() => new Promise<void>(resolve => { const open = indexedDB.open('isketatar-pwa', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('registry', 'readwrite'); tx.objectStore('registry').delete('state'); tx.oncomplete = () => { db.close(); resolve(); }; }; }));
  network.setOffline(offline); await page.close(); const cold = await context.newPage(); await cold.goto(immutable ? `./releases/${before.accepted_release_id}/index.html#/settings` : './#/settings');
  await expect(cold.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible(); expect(await control(cold)).toMatchObject({ accepted_release_id: before.accepted_release_id, data_generation: before.data_generation, state_revision: before.state_revision });
});
