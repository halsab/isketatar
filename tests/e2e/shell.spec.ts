import { test, expect } from '@playwright/test';

test('Pages subpath, direct hash route and reload @smoke', async ({ page }) => {
  const failures: string[] = [];
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.goto('./#/about');
  await expect(page.getByRole('heading', { name: 'Курс турында' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('margin', '0px');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Курс турында' })).toBeVisible();
  await page.getByRole('link', { name: 'Иске имля', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Иске имля', exact: true })).toBeVisible();
  expect(failures).toEqual([]);
});
