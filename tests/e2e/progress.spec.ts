import { test, expect } from '@playwright/test';

test('real browser IndexedDB preserves atomicity, idempotency, help and writer fencing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5176/isketatar/tests/browser/progress.html');
  await expect(page.locator('#result')).not.toHaveText('running');
  const text = await page.locator('#result').textContent();
  expect(text).not.toContain('failed:');
  expect(JSON.parse(text!)).toEqual({ duplicate: true, staleHelp: true, helpSaved: true, finalBulk: true, staleWriter: true, aborted: true, importRoundtrip: true, staleGeneration: true, previewRejected: true, reset: true });
  expect(errors).toEqual([]);
});
