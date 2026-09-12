import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { artifactServer } from '../helpers/releases';

test.use({ serviceWorkers: 'allow' });
test('worker preloads the own manifest before application code without creating databases or caches', async ({ page }) => {
  const server = await artifactServer();
  const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
  const asset = manifest.assets.find((item: { url: string }) => /\/application-[^/]+\.js$/u.test(item.url));
  const release = server.hold(asset.url.slice('/isketatar/'.length));
  const ownManifest = `releases/${manifest.release_id}/release-manifest.json`;
  try {
    await page.goto(server.url, { waitUntil: 'domcontentloaded' });
    await expect.poll(() => server.requests.filter(path => path === ownManifest).length).toBe(1);
    expect(await page.evaluate(async () => ({ databases: await indexedDB.databases(), caches: await caches.keys() }))).toEqual({ databases: [], caches: [] });
    release();
    await expect(page.locator('.home-continuation')).toBeVisible();
    expect(server.requests.filter(path => path === ownManifest)).toHaveLength(1);
  } finally { release(); await page.close(); await server.close(); }
});
test('online home is usable while automatic shell caching waits for an unvisited page', async ({ page }) => {
  const server = await artifactServer();
  const manifest = JSON.parse(await readFile('dist/release-manifest.json', 'utf8'));
  const asset = manifest.assets.find((item: { url: string }) => /\/StartPage-[^/]+\.js$/u.test(item.url));
  expect(asset).toBeDefined();
  const release = server.hold(asset.url.slice('/isketatar/'.length));
  try {
    await page.goto(server.url);
    await expect(page.locator('.home-continuation')).toBeVisible();
    expect(await page.evaluate(async ({ id, url }) => !!await (await caches.open(`isketatar-shell-${id}`)).match(url), { id: manifest.release_id, url: asset.url })).toBe(false);
    release();
    await expect.poll(() => page.evaluate(async ({ id, url }) => !!await (await caches.open(`isketatar-shell-${id}`)).match(url), { id: manifest.release_id, url: asset.url })).toBe(true);
  } finally { release(); await page.close(); await server.close(); }
});
