import { test, expect } from '@playwright/test';
import core from '../../public/runtime/core.json' with { type: 'json' };

test('eight modules expose all 53 lessons with route-specific foundation requirements', async ({ page }) => {
  await page.goto('./#/start');
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.goto('./#/lessons');
  await expect(page.getByText('0 / 46 дәрес', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.course-module')).toHaveCount(8);
  for (const module of core.modules) {
    const group = page.locator(`[data-module="${module.id}"]`);
    if (!await group.evaluate(node => (node as HTMLDetailsElement).open)) await group.locator('summary').click();
    await expect(group.locator('.course-lesson')).toHaveCount(module.lesson_ids.length);
  }
  await expect(page.locator('.course-lesson')).toHaveCount(53);
  await expect(page.locator('a[href="#/lessons/K01"] bdi[lang="tt-Arab"]').first()).toHaveText('ق / ك');
  await expect(page.locator('[data-module="M00"]')).toContainText('Өстәмә');
  await page.getByRole('link', { name: 'Уку юлын үзгәртергә', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен өйрәнәм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.goto('./#/lessons');
  await expect(page.getByText('0 / 53 дәрес', { exact: true }).first()).toBeVisible();
  await expect(page.locator('[data-module="M00"] summary')).not.toContainText('Өстәмә');
});

test('course module titles reflow at 200 percent text on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./#/lessons');
  await expect(page.locator('.course-lesson').first()).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; document.documentElement.style.fontSize = '200%'; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('home offers one saved continuation without creating a new session', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice');
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await page.getByRole('link', { name: 'Иске имля', exact: true }).click();
  await expect(page.locator('.home-continuation')).toContainText('1 / 8');
  await page.locator('.home-continuation').getByRole('link', { name: 'Дәвам итәргә', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/V04\/practice$/u);
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
});
