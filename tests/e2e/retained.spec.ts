import { test, expect, type Page } from '@playwright/test';
import type { PackageManifest } from '../../src/data/pwa/manifest';
import type { Registry } from '../../src/data/pwa/registry';
import type { CoreData, ModuleData } from '../../src/domain/content/types';
import type { Session, Presentation } from '../../src/domain/learning/types';
test.use({ serviceWorkers: 'allow' });

async function pinnedFixture(page: Page, retained: boolean) {
  await page.goto('./#/settings');
  await page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true }).click();
  await expect(page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true })).toBeVisible();
  await page.goto('./#/lessons/V04/practice');
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('элек');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/V04$/u);
  const manifest = await (await page.request.get('./release-manifest.json')).json() as PackageManifest;
  return page.evaluate(async ({ manifest, retained }) => {
    const oldId = '1.0.0-1111111111111111'; const revision = 'b'.repeat(64);
    const open = (name: string) => new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const read = <T,>(store: IDBObjectStore, key: IDBValidKey) => new Promise<T>((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    if (retained) {
      const old = structuredClone(manifest); old.release_id = oldId; old.question_revisions['Q-V04-01'] = revision;
      const prefix = `/isketatar/releases/${oldId}`;
      const shell = await caches.open(`isketatar-shell-${oldId}`); const course = await caches.open(`isketatar-course-${oldId}`);
      const hash = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      for (const asset of old.assets) {
        const url = asset.url; const cached = await caches.match(url); if (!cached) throw new Error(`fixture_cache_missing:${url}`);
        let bytes = new Uint8Array(await cached.arrayBuffer());
        if (url.endsWith('/runtime/core.json')) { const core = JSON.parse(new TextDecoder().decode(bytes)) as CoreData; core.questions.find(item => item.id === 'Q-V04-01')!.grading_revision = revision; bytes = new TextEncoder().encode(JSON.stringify(core)); }
        if (url.endsWith('/runtime/module-M02.json')) { const module = JSON.parse(new TextDecoder().decode(bytes)) as ModuleData; const question = module.questions.find(item => item.id === 'Q-V04-01')!; question.grading_revision = revision; question.accepted_answers = ['элек']; question.prompt_tt = 'Элекке басма соравы'; bytes = new TextEncoder().encode(JSON.stringify(module)); }
        asset.url = url.replace(`/isketatar/releases/${manifest.release_id}`, prefix); asset.bytes = bytes.length; asset.sha256 = await hash(bytes);
        await (old.shell_assets.includes(url) ? shell : course).put(asset.url, new Response(bytes, { headers: cached.headers }));
      }
      old.shell_assets = old.shell_assets.map(url => url.replace(`/isketatar/releases/${manifest.release_id}`, prefix));
      const bytes = new TextEncoder().encode(JSON.stringify(old)); const digest = await hash(bytes); const url = `${prefix}/release-manifest.json`;
      await shell.put(url, new Response(bytes, { headers: { 'Content-Type': 'application/json' } }));
      const db = await open('isketatar-pwa'); const tx = db.transaction('registry', 'readwrite'); const state = await read<Registry>(tx.objectStore('registry'), 'state');
      state.previous_release_id = oldId; state.releases.push({ release_id: oldId, manifest_url: url, manifest_sha256: digest, shell_cache: `isketatar-shell-${oldId}`, course_cache: `isketatar-course-${oldId}`, completeness: 'ready', created_at: Date.now(), verified_at: Date.now() });
      tx.objectStore('registry').put(state, 'state'); await done(tx); db.close();
    }
    const db = await open('iske-imla-progress'); const tx = db.transaction(['sessions', 'presentations'], 'readwrite');
    const request = tx.objectStore('sessions').getAll(); const sessions = await new Promise<Session[]>(resolve => { request.onsuccess = () => resolve(request.result); });
    const session = sessions[0]!; session.release_id = oldId; session.question_plan[0]!.grading_revision = revision; tx.objectStore('sessions').put(session);
    const presentation = await read<Presentation>(tx.objectStore('presentations'), session.active_presentation_id!); presentation.grading_revision = revision; tx.objectStore('presentations').put(presentation); await done(tx); db.close(); return oldId;
  }, { manifest, retained });
}
for (const loseRegistry of [false, true]) test(`new shell resumes cached previous content offline and grades against its old answer (lost registry=${loseRegistry})`, async ({ page, context }) => {
  const oldId = await pinnedFixture(page, true); await context.setOffline(true);
  if (loseRegistry) await page.evaluate(() => new Promise<void>(resolve => { const open = indexedDB.open('isketatar-pwa', 1); open.onsuccess = () => { const db = open.result; const tx = db.transaction('registry', 'readwrite'); tx.objectStore('registry').delete('state'); tx.oncomplete = () => { db.close(); resolve(); }; }; }));
  await page.goto('./#/lessons/V04/practice'); await page.reload();
  await expect(page.getByText('Бу дәрес сакланган элекке басма буенча дәвам итә:', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.getByText('Элекке басма соравы', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('элек');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await expect(page.locator('.feedback-title')).toBeVisible();
  const records = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('iske-imla-progress'); request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['attempts', 'review_cards']);
    const all = (store: string) => new Promise<unknown[]>(resolve => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); });
    const [attempts, cards] = await Promise.all([all('attempts'), all('review_cards')]); db.close(); return { attempts, cards };
  });
  expect(records.attempts).toContainEqual(expect.objectContaining({ grade: 'correct', release_id: oldId, answer_raw: { kind: 'text', text: 'элек' } })); expect(records.cards).toEqual([]);
});
test('missing old package preserves raw input and explicit release of the pin starts current content', async ({ page, context }) => {
  await pinnedFixture(page, false); await context.setOffline(true); await page.goto('./#/lessons/V04/practice'); await page.reload();
  await expect(page.getByRole('heading', { name: 'Сакланган җаваплар', exact: true })).toBeVisible();
  await expect(page.locator('textarea').first()).toHaveValue('элек');
  await page.getByRole('button', { name: 'Дәресне тарихта калдырырга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Дәресне тарихта калдырырга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('');
  await expect(page.getByText('Элекке басма соравы', { exact: true })).toHaveCount(0);
});
