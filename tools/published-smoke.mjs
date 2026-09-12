import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyArtifact } from './release-artifact.mjs';
import { mimeFor } from '../src/data/pwa/manifest.ts';
import { readBoundedBytes } from '../src/data/http.ts';
import { sha256 } from './product-scope.mjs';
import { seedDraft, acceptRelease, progressSnapshot, assertProgressPreserved, offlineSmoke } from './delivery-smoke.mjs';

export function publicationUrl(value) {
  const url = new URL(value);
  assert.ok(url.href === 'https://halsab.github.io/isketatar/' || url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.pathname === '/isketatar/' && !url.search && !url.hash && !url.username && !url.password, 'Unexpected publication URL');
  return url.href;
}
export async function checkPublished(root, value, attempts = 1) {
  const url = publicationUrl(value); const artifact = await verifyArtifact(root);
  for (let attempt = 0; ; attempt++) {
    try {
      for (let offset = 0; offset < artifact.files.length; offset += 4) {
        const results = await Promise.allSettled(artifact.files.slice(offset, offset + 4).map(async file => {
      const target = new URL(file.path, url).href;
      const response = await fetch(target, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 200, `Published status: ${file.path}`); assert.equal(response.url, target);
      assert.ok(mimeFor(file.path).includes(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()), `Published MIME: ${file.path}`);
      const bytes = await readBoundedBytes(response, file.bytes);
      assert.equal(bytes.length, file.bytes); assert.equal(sha256(bytes), file.sha256, `Published hash: ${file.path}`);
        }));
        const failure = results.find(result => result.status === 'rejected');
        if (failure) throw failure.reason;
      }
      break;
    } catch (error) {
      if (attempt + 1 >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
  return artifact;
}

export async function seedPublishedProfile(root, value, output) {
  const url = publicationUrl(value); const artifact = await checkPublished(root, url);
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ serviceWorkers: 'allow' }); const page = await context.newPage();
    await seedDraft(page, url);
    await page.close();
    const state = await context.storageState({ indexedDB: true });
    assert.deepEqual(state.cookies, [], 'Only a fresh anonymous test profile may be stored');
    const database = state.origins.find(origin => origin.origin === new URL(url).origin)?.indexedDB?.find(database => database.name === 'iske-imla-progress');
    assert.ok(database, 'Missing captured progress database');
    const before = Object.fromEntries(database.stores.map(store => [store.name, store.records.map(record => record.value)]));
    assert.equal(before.meta.find(record => record.key === 'control').accepted_release_id, artifact.current.release_id);
    assert.ok(before.sessions.some(record => record.status === 'paused') && before.presentations.some(record => record.draft_answer?.text === 'әңгәмә'));
    const body = JSON.stringify({ mode: 'previous-database-without-caches', previous_release_id: artifact.current.release_id, before, state });
    assert.ok(Buffer.byteLength(body) <= 1_000_000, 'Test profile limit'); await writeFile(output, body + '\n');
    await context.close();
  } finally { await browser.close(); }
}

export async function verifyPublishedProfiles(root, value, profilePath, attempts = 1) {
  const url = publicationUrl(value); const artifact = await checkPublished(root, url, attempts);
  const profile = JSON.parse(await readFile(profilePath, 'utf8')); const browser = await chromium.launch();
  const errors = [];
  try {
    if (profile.mode === 'previous-database-without-caches') {
      assert.deepEqual(profile.state.cookies, []);
      assert.ok(profile.state.origins.length === 1 && profile.state.origins[0].origin === new URL(url).origin, 'Unexpected test profile origin');
      const context = await browser.newContext({ serviceWorkers: 'allow', storageState: profile.state }); const page = await context.newPage();
      page.on('pageerror', error => errors.push(String(error)));
      await page.goto(url + '#/settings');
      await page.getByRole('button', { name: 'Сакланган басманы ачарга', exact: true }).click();
      await expect(page.locator('script[type="module"][src]')).toHaveAttribute('src', new RegExp(`/releases/${profile.previous_release_id}/`, 'u'));
      await page.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Монда дәвам итәргә', exact: true })).toHaveCount(0);
      assertProgressPreserved(profile.before, await progressSnapshot(page), profile.previous_release_id);
      await acceptRelease(page, url, artifact.current.release_id);
      assertProgressPreserved(profile.before, await progressSnapshot(page), artifact.current.release_id);
      await page.goto(url + '#/lessons/V04/practice');
      await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
      await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
      await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
      await expect(page).toHaveURL(/#\/lessons\/V04$/u);
      await offlineSmoke(context, page, url, artifact.current.release_id); await context.close();
    } else assert.equal(profile.mode, 'first-release');
    const context = await browser.newContext({ serviceWorkers: 'allow' }); const page = await context.newPage();
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(url + '#/lessons/V04'); await expect(page.locator('.lesson-example').first()).toBeVisible();
    await offlineSmoke(context, page, url, artifact.current.release_id); await context.close();
    assert.deepEqual(errors, []);
    return { status: 'pass', url, release_id: artifact.current.release_id, artifact_sha256: artifact.sha256, profile_mode: profile.mode, browser: browser.version(), verified_files: artifact.files.length, checked_at: new Date().toISOString() };
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const mode = process.argv[2]; const url = publicationUrl(process.env.PUBLIC_URL ?? 'https://halsab.github.io/isketatar/');
  await mkdir('quality-results', { recursive: true });
  const profile = 'quality-results/predeploy-profile.json';
  if (mode === 'seed') {
    if (process.env.PREVIOUS_DIST) await seedPublishedProfile(process.env.PREVIOUS_DIST, url, profile);
    else await writeFile(profile, JSON.stringify({ mode: 'first-release' }) + '\n');
  } else if (mode === 'verify') {
    const result = await verifyPublishedProfiles(process.env.PUBLISHED_DIST ?? 'quality-results/pages', url, profile, 3);
    await writeFile('quality-results/published-smoke.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
  } else throw new Error('Use published-smoke.mjs seed|verify');
}
