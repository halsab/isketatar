import { test, expect } from '@playwright/test';
import fixtures from '../../docs/production/typography-fixtures.json' with { type: 'json' };

const url = 'http://127.0.0.1:5176/isketatar/tests/browser/typography.html';
test('local font, logical Arabic, reflow and independent sizes', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await expect(page.locator('#graded-action')).toBeVisible();
  for (const item of fixtures.cases.filter(item => item.lang === 'tt-Arab')) {
    const text = page.locator(`[data-case="${item.id}"] bdi`);
    await expect(text).toHaveText(item.text);
    await expect(text).toHaveAttribute('dir', 'rtl');
    await expect(text).toHaveAttribute('lang', 'tt-Arab');
    await expect(text).toHaveCSS('font-weight', '400');
  }
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole('button', { name: 'Төсне алыштырырга' }).click();
  await expect(page.locator('bdi').first()).toHaveCSS('font-size', '48px');
  await expect(page.locator('.prose')).toHaveCSS('font-size', '24px');
  await page.setViewportSize({ width: 320, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('missing font hides graded surface and permits retry', async ({ page }) => {
  const fontRequest = (request: URL) => request.pathname.endsWith('/NotoNaskhArabic-Regular.woff2') && !request.searchParams.has('import');
  await page.route(fontRequest, route => route.abort());
  await page.goto(url);
  await expect(page.getByText('Иске язу шрифтын йөкләп булмады.', { exact: false }).first()).toBeVisible();
  await expect(page.locator('#graded-action')).toHaveCount(0);
  await expect(page.locator('bdi')).toHaveCount(0);
  await page.unroute(fontRequest);
  await page.getByRole('button', { name: 'Кабат эшләргә' }).first().click();
  await expect(page.locator('#graded-action')).toBeVisible();
});
