import { test, expect, type Page } from '@playwright/test';
import { releaseServer } from '../helpers/releases';
test.use({ serviceWorkers: 'allow' });
test.setTimeout(60_000);
let releases: Awaited<ReturnType<typeof releaseServer>>;
test.beforeAll(async () => { releases = await releaseServer(); });
test.afterAll(async () => { await releases?.close(); });
test.beforeEach(() => releases.reset());
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('iske-imla-progress', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['meta', 'sessions', 'presentations']);
    const get = (store: string, key?: string) => new Promise<any>((resolve, reject) => { const request = key ? tx.objectStore(store).get(key) : tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [control, sessions, presentations] = await Promise.all([get('meta', 'control'), get('sessions'), get('presentations')]); db.close(); return { control, sessions, presentations };
  });
}
async function check(page: Page) {
  releases.publish(); await page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true }).click();
  await expect(page.getByText(`Яңа басма бар: ${releases.next}.`, { exact: false })).toBeVisible();
}
async function accept(page: Page) {
  await page.getByRole('button', { name: 'Саклап яңартырга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Саклап яңартырга', exact: true }).click();
  // Скачивание двух пакетов предшествует протоколу согласования и не входит в ожидание UI-ответа окна.
  const preparing = page.getByRole('heading', { name: 'Яңартуга әзерләнү', exact: true });
  const nextShell = page.locator(`script[type="module"][src*="/releases/${releases.next}/"]`);
  await expect(preparing.or(nextShell).first()).toBeAttached({ timeout: 45_000 });
}

async function accepted(page: Page) {
  // DOM новой версии появляется после перезагрузки; чтение старого context в этот момент обрывается.
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', new RegExp(`/releases/${releases.next}/`, 'u'), { timeout: 20_000 });
  await expect(page.locator('.app-main')).toBeVisible({ timeout: 20_000 });
  expect((await snapshot(page)).control.accepted_release_id).toBe(releases.next);
}
async function practice(page: Page) {
  await page.goto(releases.url + '#/lessons/V04/practice');
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
}
test('explicit update flushes a live draft, reloads both windows and resumes the pinned old lesson offline @smoke', async ({ page, context }) => {
  await practice(page);
  const second = await context.newPage(); await second.goto(releases.url + '#/settings');
  await check(second);
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  const before = await snapshot(page);
  await accept(page);
  await accepted(page);
  await expect(page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true })).toBeVisible();
  await expect(second.getByText(`Басма: ${releases.next}.`, { exact: false })).toBeVisible();
  const after = await snapshot(page); expect(after.control.accepted_release_id).toBe(releases.next); expect(after.control.data_generation).toBe(before.control.data_generation); expect(after.control.update_gate).toBeNull();
  expect(after.sessions).toContainEqual(expect.objectContaining({ release_id: releases.original, status: 'paused' }));
  expect(after.presentations).toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'әңгәмә' } }));
  releases.setUnavailable(true); await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
});
test('IME blocks acceptance, cancellation preserves the same input, and a later retry accepts', async ({ page, context }) => {
  await practice(page); const second = await context.newPage(); await second.goto(releases.url + '#/settings'); await check(second);
  const input = page.getByRole('textbox', { name: 'Җавабың', exact: true });
  await input.fill('яңа'); await input.dispatchEvent('compositionstart');
  await accept(page);
  await expect(page.getByText('Башланган текст кертүне тәмамла', { exact: false }).first()).toBeVisible();
  expect((await snapshot(page)).control.accepted_release_id).toBe(releases.original);
  for (const width of [1366, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    for (const size of ['100%', '200%']) { await page.evaluate(size => { document.documentElement.style.fontSize = size; }, size); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
  }
  await page.screenshot({ path: test.info().outputPath('update-blocked-320-large.png'), fullPage: false });
  await page.locator('.update-status .actions').screenshot({ path: test.info().outputPath('update-actions-320-large.png') });
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; }); await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'Яңартуны кичектерергә', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Саклап яңартырга', exact: true })).toBeEnabled();
  await input.fill('яңа сүз'); await input.dispatchEvent('compositionend', { data: 'яңа сүз' });
  await expect.poll(async () => (await snapshot(page)).presentations).toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'яңа сүз' } }));
  await accept(page); await accepted(page);
});
test('a blocked round can be recovered from a fresh window after the coordinator disappears', async ({ page, context }) => {
  await practice(page); const second = await context.newPage(); await second.goto(releases.url + '#/settings'); await check(second);
  const input = page.getByRole('textbox', { name: 'Җавабың', exact: true }); await input.fill('сакланмаган'); await input.dispatchEvent('compositionstart');
  await accept(page); await expect(page.getByText('Башланган текст кертүне тәмамла', { exact: false }).first()).toBeVisible();
  const before = await snapshot(second); await page.close();
  const fresh = await context.newPage(); await fresh.goto(releases.url + '#/settings');
  await fresh.getByRole('button', { name: 'Яңартуны бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await fresh.getByRole('dialog').getByRole('button', { name: 'Яңартуны бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await accepted(fresh);
  expect((await snapshot(fresh)).control.writer_epoch).toBe(before.control.writer_epoch + 1);
});
test('memory work can be exported before an explicit per-window decision permits reload @smoke', async ({ page, context }) => {
  await practice(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'presentations' && value.draft_answer?.kind === 'text') throw new DOMException('test quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('хәтердәге җавап');
  await page.getByRole('button', { name: 'Вакытлыча саклап дәвам итәргә', exact: true }).click();
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toBeVisible();
  const writer = await context.newPage(); await writer.goto(releases.url + '#/settings');
  await writer.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await writer.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await check(writer); await accept(writer);
  const consent = page.getByRole('button', { name: 'Вакытлыча эшне калдырып яңартырга', exact: true }); await expect(consent).toBeVisible();
  expect((await snapshot(writer)).control.accepted_release_id).toBe(releases.original);
  await page.getByRole('link', { name: 'Нәтиҗәләрне файлга сакларга', exact: true }).click();
  await page.getByRole('button', { name: 'Нәтиҗәләр файлын әзерләргә', exact: true }).click();
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('link', { name: 'Файлны йөкләп алырга', exact: true }).click(); const download = await downloadPromise;
  const stream = await download.createReadStream(); let text = ''; for await (const chunk of stream!) text += chunk.toString();
  expect(text).toContain('хәтердәге җавап');
  await consent.click(); await page.getByRole('dialog').getByRole('button', { name: 'Вакытлыча эшне калдырып яңартырга', exact: true }).click();
  await expect(consent).toHaveCount(0);
  await writer.getByRole('button', { name: 'Тәрәзәләрне кабат тикшерергә', exact: true }).click();
  await accepted(writer);
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toHaveCount(0);
  expect((await snapshot(writer)).presentations).not.toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'хәтердәге җавап' } }));
});
test('a nonresponding window blocks acceptance until its closure is observed', async ({ page, context }) => {
  await page.goto(releases.url + '#/settings'); await check(page);
  const unknown = await context.newPage(); await unknown.goto(releases.url + `releases/${releases.original}/recovery.html`);
  await accept(page);
  await expect(page.getByText('Кайбер тәрәзәләр әзер түгел.', { exact: false }).first()).toBeVisible({ timeout: 20_000 });
  expect((await snapshot(page)).control.accepted_release_id).toBe(releases.original);
  await unknown.close(); await page.getByRole('button', { name: 'Тәрәзәләрне кабат тикшерергә', exact: true }).click();
  await accepted(page);
});
test('a fresh coordinator recovers commit phase, repairs an evicted candidate and finishes the same update', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes service-worker fault injection only in Chromium.');
  await page.goto(releases.url + '#/settings'); await check(page);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(id => {
    const match = Cache.prototype.match; Object.assign(globalThis, { restoreMatch: () => { Cache.prototype.match = match; } });
    Cache.prototype.match = async function (request, options) {
      if (String(request).endsWith(`/releases/${id}/runtime/readings.json`)) {
        const phase = await new Promise<string>(resolve => { const open = indexedDB.open('iske-imla-progress', 1); open.onsuccess = () => { const db = open.result; const get = db.transaction('meta').objectStore('meta').get('control'); get.onsuccess = () => { resolve(get.result?.update_gate?.phase); db.close(); }; }; });
        if (phase === 'commit') return undefined;
      }
      return match.call(this, request, options);
    };
  }, releases.next);
  await accept(page); await expect(page.getByText('Яңарту өчен кирәкле пакет тулы түгел.', { exact: false })).toBeVisible();
  const before = await snapshot(page); expect(before.control.update_gate.phase).toBe('commit'); expect(before.control.accepted_release_id).toBe(releases.original);
  await worker.evaluate(async id => { Reflect.get(globalThis, 'restoreMatch')(); await (await caches.open(`isketatar-course-${id}`)).delete(`/isketatar/releases/${id}/runtime/readings.json`); }, releases.next);
  await page.close(); const fresh = await context.newPage(); await fresh.goto(releases.url + '#/reference');
  await fresh.getByRole('button', { name: 'Яңартуны бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await fresh.getByRole('dialog').getByRole('button', { name: 'Яңартуны бу тәрәзәдән дәвам итәргә', exact: true }).click();
  await expect(fresh.getByText('Яңарту өчен кирәкле пакет тулы түгел.', { exact: false })).toBeVisible();
  await fresh.getByRole('button', { name: 'Материалларны төзәтеп яңартырга', exact: true }).click();
  await accepted(fresh);
  expect((await snapshot(fresh)).control).toMatchObject({ update_gate: null, data_generation: before.control.data_generation, writer_epoch: before.control.writer_epoch + 1 });
});
test('a window booted during a blocked round resumes when the writer defers that round', async ({ page, context }) => {
  await practice(page); const second = await context.newPage(); await second.goto(releases.url + '#/settings'); await check(second);
  const input = page.getByRole('textbox', { name: 'Җавабың', exact: true }); await input.dispatchEvent('compositionstart');
  await accept(page); await expect(page.getByText('Башланган текст кертүне тәмамла', { exact: false }).first()).toBeVisible();
  const fresh = await context.newPage(); await fresh.goto(releases.url + '#/settings');
  await expect(fresh.locator('main [inert]')).toBeVisible();
  await page.getByRole('button', { name: 'Яңартуны кичектерергә', exact: true }).click();
  await expect(fresh.locator('main [inert]')).toHaveCount(0);
  await fresh.getByRole('link', { name: 'Курс турында', exact: true }).click(); await expect(fresh).toHaveURL(/#\/about$/u);
  await input.dispatchEvent('compositionend');
});
test('failed post-bootstrap cleanup remains visible and can be retried without changing progress', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright exposes service-worker fault injection only in Chromium.');
  await page.goto(releases.url + '#/settings'); await page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click();
  await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible();
  const before = await snapshot(page); const obsolete = '1.0.0-1111111111111111';
  await page.evaluate(obsolete => new Promise<void>(resolve => {
    const open = indexedDB.open('isketatar-pwa', 1); open.onsuccess = () => {
      const db = open.result; const tx = db.transaction('registry', 'readwrite'); const store = tx.objectStore('registry'); const get = store.get('state');
      get.onsuccess = () => { const value = get.result; const previous = '1.0.0-2222222222222222';
        for (const id of [previous, obsolete]) value.releases.push({ ...value.releases[0], release_id: id, manifest_url: `/isketatar/releases/${id}/release-manifest.json`, shell_cache: `isketatar-shell-${id}`, course_cache: `isketatar-course-${id}` });
        value.previous_release_id = previous; value.operation = { update_id: crypto.randomUUID(), from_release_id: previous, target_release_id: value.current_release_id, phase: 'committed' }; store.put(value, 'state');
      }; tx.oncomplete = () => { db.close(); resolve(); };
    };
  }), obsolete);
  const worker = context.serviceWorkers()[0]!;
  await worker.evaluate(id => { const remove = CacheStorage.prototype.delete; Object.assign(globalThis, { restoreDelete: () => { CacheStorage.prototype.delete = remove; } }); CacheStorage.prototype.delete = function (name) { if (name.endsWith(id)) return Promise.reject(new DOMException('test denial', 'SecurityError')); return remove.call(this, name); }; }, obsolete);
  await page.reload(); await expect(page.getByRole('button', { name: 'Яңартуны тәмамларга', exact: true })).toBeVisible();
  await worker.evaluate(() => { Reflect.get(globalThis, 'restoreDelete')(); });
  await page.getByRole('button', { name: 'Яңартуны тәмамларга', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Яңартуны тәмамларга', exact: true })).toHaveCount(0);
  expect((await snapshot(page)).control).toMatchObject({ accepted_release_id: before.control.accepted_release_id, data_generation: before.control.data_generation, update_gate: null });
});
