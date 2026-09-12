import { test, expect } from '@playwright/test';

test('route settings survive reload and duplicated tabs need explicit takeover', async ({ page }) => {
  await page.goto('./#/start');
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен өйрәнәм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/B01$/u);
  const id = await page.evaluate(() => sessionStorage.getItem('iske-imla-tab'));
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('iske-imla-tab'))).toBe(id);
  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(() => { window.open(location.href); });
  const popup = await popupPromise;
  await expect(popup.getByText('Нәтиҗәләрне хәзер башка кыстыргыч үзгәртә ала.', { exact: false })).toBeVisible();
  expect(await popup.evaluate(() => sessionStorage.getItem('iske-imla-tab'))).not.toBe(id);
  await popup.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await popup.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await expect(page.getByText('Нәтиҗәләрне хәзер башка кыстыргыч үзгәртә ала.', { exact: false })).toBeVisible();
  await popup.goto('./#/start');
  await expect(popup.getByRole('radio', { name: 'Гарәп хәрефләрен өйрәнәм', exact: false })).toBeChecked();
  await popup.close();
});

test('storage denial offers an explicit temporary branch', async ({ page }) => {
  await page.addInitScript(() => { indexedDB.open = () => { throw new DOMException('test denial', 'SecurityError'); }; });
  await page.goto('./#/start');
  await page.getByRole('button', { name: 'Вакытлыча саклап дәвам итәргә' }).click();
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toBeVisible();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\//u);
});

for (const incompatible of [{ progress_schema: 2 }, { min_reader_version: '99.0.0' }]) test(`incompatible release ${JSON.stringify(incompatible)} is rejected before creating progress storage`, async ({ page }) => {
  await page.route('**/release-manifest.json', async route => {
    const response = await route.fetch(); const manifest = await response.json();
    await route.fulfill({ response, json: { ...manifest, ...incompatible } });
  });
  await page.goto('./#/start');
  await expect(page.getByText('Курс ачылмады.', { exact: false })).toBeVisible();
  expect(await page.evaluate(async () => (await indexedDB.databases()).map(item => item.name))).not.toContain('iske-imla-progress');
  await page.unroute('**/release-manifest.json');
  await page.getByRole('button', { name: 'Йөкләүне кабатларга' }).click();
  await expect(page.getByRole('heading', { name: 'Кайдан башлыйбыз?' })).toBeVisible();
});
