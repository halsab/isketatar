import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { mkdtemp, readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { verifyArtifact, verifyBuiltArtifact } from './release-artifact.mjs';
import { repackageRelease } from './repackage-release.mjs';
import { deliveryServer } from './delivery-server.mjs';
import { assembleArtifact } from './assemble-artifact.mjs';

export async function progressSnapshot(page) {
  return page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('iske-imla-progress'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      const stores = [...db.objectStoreNames]; const tx = db.transaction(stores);
      const entries = await Promise.all(stores.map(store => new Promise((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve([store, request.result]); request.onerror = () => reject(request.error); })));
      return Object.fromEntries(entries);
    } finally { db.close(); }
  });
}
const control = snapshot => snapshot.meta.find(record => record.key === 'control');
export function assertProgressPreserved(before, after, accepted) {
  assert.equal(control(after).accepted_release_id, accepted);
  assert.equal(control(after).data_generation, control(before).data_generation);
  assert.equal(control(after).progress_schema, control(before).progress_schema);
  assert.equal(control(after).update_gate, null);
  for (const store of ['sessions', 'presentations', 'attempts', 'exposures', 'review_cards', 'bookmarks', 'legacy']) assert.deepEqual(after[store], before[store], `Changed ${store}`);
  assert.deepEqual(after.meta.filter(record => record.key !== 'control'), before.meta.filter(record => record.key !== 'control'), 'Changed settings/positions');
}
export async function seedDraft(page, url) {
  await page.goto(url + '#/lessons/V04/practice');
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/V04$/u);
  // Примеры появляются только после записи всей группы наблюдений; URL меняется раньше.
  await expect(page.locator('.lesson-example').first()).toBeVisible();
  await page.goto(url + '#/settings');
  await expect(page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true })).toBeVisible();
  const saved = await progressSnapshot(page);
  assert.ok(saved.sessions.some(record => record.status === 'paused') && saved.presentations.some(record => record.draft_answer?.text === 'әңгәмә'));
  return saved;
}
export async function acceptRelease(page, url, id) {
  if (new URL(page.url()).hash !== '#/settings' || !await page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true }).isVisible()) await page.goto(url + '#/settings');
  await page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true }).click();
  await expect(page.getByText(`Яңа басма бар: ${id}.`, { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Саклап яңартырга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Саклап яңартырга', exact: true }).click();
  await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', new RegExp(`/releases/${id}/`, 'u'), { timeout: 30_000 });
  await expect(page.getByText(`Басма: ${id}.`, { exact: false })).toBeVisible();
}
export async function offlineSmoke(context, page, url, id) {
  await page.goto(url + '#/settings');
  const ready = page.getByText('Курс интернетсыз уку өчен әзер.', { exact: true });
  const save = page.getByRole('button', { name: 'Интернетсыз уку өчен сакларга', exact: true });
  await expect(ready.or(save)).toBeVisible();
  if (!await ready.isVisible()) await save.click({ timeout: 3000 }).catch(async error => { if (!await ready.isVisible()) throw error; });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await page.close(); await context.setOffline(true);
  const offline = await context.newPage(); await offline.goto(url + '#/lessons/V04');
  await expect(offline.locator('.lesson-example').first()).toBeVisible();
  await expect(offline.locator('.font-message')).toHaveCount(0);
  assert.equal(control(await progressSnapshot(offline)).accepted_release_id, id);
  await context.setOffline(false); await offline.close();
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const temporary = await mkdtemp(join(tmpdir(), 'iske-delivery-'));
  let server, browser;
  try {
    const provenance = JSON.parse(await readFile('quality-results/build-provenance.json', 'utf8'));
    const candidate = await verifyBuiltArtifact('dist', provenance);
    let previousRoot = process.env.PREVIOUS_DIST;
    const mode = previousRoot ? 'historical-last-good' : 'bootstrap-same-code';
    if (!previousRoot) {
      await repackageRelease('dist', temporary, candidate.current.built_at / 1000 - 1);
      previousRoot = join(temporary, 'dist');
      const simulated = JSON.parse(await readFile(join(temporary, 'quality-results/build-provenance.json'), 'utf8'));
      assert.equal(simulated.product_artifact_sha256, provenance.product_artifact_sha256, 'Bootstrap must use identical executable product');
    }
    const previous = await verifyArtifact(previousRoot);
    assert.notEqual(previous.current.release_id, candidate.current.release_id, 'Delivery requires two release identities');
    for (const field of ['progress_schema', 'content_schema', 'policy_versions']) assert.deepEqual(previous.current[field], candidate.current[field], 'Rollback needs an explicit compatibility plan when schemas/policies differ');
    const publishedRoot = join(temporary, 'published'); const rollbackRoot = join(temporary, 'rollback');
    await assembleArtifact('dist', previousRoot, publishedRoot);
    await assembleArtifact(previousRoot, 'dist', rollbackRoot);
    server = await deliveryServer(previousRoot, publishedRoot, rollbackRoot);
    browser = await chromium.launch();
    const context = await browser.newContext({ serviceWorkers: 'allow' }); const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    const before = await seedDraft(page, server.url);
    server.publish(); await acceptRelease(page, server.url, candidate.current.release_id);
    assertProgressPreserved(before, await progressSnapshot(page), candidate.current.release_id);
    await page.goto(server.url + '#/lessons/V04/practice');
    await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
    await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('яңа язма');
    await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
    await expect(page).toHaveURL(/#\/lessons\/V04$/u);
    await expect(page.locator('.lesson-example').first()).toBeVisible();
    await page.goto(server.url + '#/settings');
    await expect(page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true })).toBeVisible();
    const updated = await progressSnapshot(page);
    assert.ok(updated.presentations.some(record => record.draft_answer?.text === 'яңа язма'));
    server.rollback(); await page.reload();
    await page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Яңа басманы тикшерергә', exact: true })).toBeEnabled();
    await expect(page.getByText(`Басма: ${candidate.current.release_id}.`, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Саклап яңартырга', exact: true })).toHaveCount(0);
    assertProgressPreserved(updated, await progressSnapshot(page), candidate.current.release_id);
    await offlineSmoke(context, page, server.url, candidate.current.release_id);
    await context.close(); assert.deepEqual(errors, []);
    const rollback = await browser.newContext({ serviceWorkers: 'allow' }); const restored = await rollback.newPage();
    await restored.goto(server.url + '#/lessons/V04'); await expect(restored.locator('.lesson-example').first()).toBeVisible();
    await offlineSmoke(rollback, restored, server.url, previous.current.release_id); await rollback.close();
    server.publish(); const fresh = await browser.newContext({ serviceWorkers: 'allow' }); const clean = await fresh.newPage();
    await clean.goto(server.url + '#/lessons/V04'); await expect(clean.locator('.lesson-example').first()).toBeVisible();
    await offlineSmoke(fresh, clean, server.url, candidate.current.release_id); await fresh.close();
    await mkdir('quality-results', { recursive: true });
    const result = { status: 'pass', mode, candidate: candidate.current.release_id, previous: previous.current.release_id, artifact_sha256: provenance.artifact_sha256, browser: browser.version(), checks: ['paused draft', 'upgrade', 'same-generation records', 'new-code draft write', 'site rollback preserves accepted reader and current database', 'cold offline', 'fresh rollback browser', 'fresh candidate offline'], limitation: 'Republishing previous does not downgrade accepted installations; deliver a compatible new release to them.' };
    await writeFile('quality-results/delivery-smoke.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
  } finally { await browser?.close(); await server?.close(); await rm(temporary, { recursive: true, force: true }); }
}
