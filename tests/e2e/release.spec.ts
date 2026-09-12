import { test, expect } from '@playwright/test';

test('entry and direct immutable shell use one complete release and stable installation identity', async ({ page }) => {
  const response = await page.request.get('./release-manifest.json'); const release = await response.json();
  const root = `/isketatar/releases/${release.release_id}/`;
  await page.goto('./#/reading/READ-03'); await expect(page.locator('.reading-line').first()).toBeVisible();
  const resources = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
  for(const url of resources.filter(url => /\.(js|css|woff2|json)(?:$|\?)/u.test(url)))expect(new URL(url).pathname).toContain(root);
  const manifest = await (await page.request.get('./manifest.webmanifest')).json();
  expect(manifest).toMatchObject({id:'/isketatar/',scope:'/isketatar/',start_url:'/isketatar/',display:'standalone',lang:'tt-Cyrl'});
  expect(manifest.icons.map((icon: {purpose: string})=>icon.purpose)).toEqual(['any','any','maskable']);
  for(const icon of manifest.icons){expect(icon.src).toContain(root);expect((await page.request.get(icon.src)).headers()['content-type']).toContain('image/png');}
  await page.goto(`${root}index.html#/dictionary/lex-55-044`);await expect(page.getByRole('heading',{name:'Сүзлек',exact:true})).toBeVisible();
  expect((await page.request.get(root+'runtime/missing.json')).headers()['content-type']).not.toContain('application/json');
});
