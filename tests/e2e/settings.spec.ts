import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function exportFile(page: Page) {
  await page.getByRole('button', { name: 'Нәтиҗәләр файлын әзерләргә', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Файлны йөкләп алырга', exact: true }).click();
  return readFile((await (await download).path())!);
}
async function importFile(page: Page, buffer: Buffer) {
  await page.getByLabel('Нәтиҗәләр файлын сайларга', { exact: true }).setInputFiles({ name: 'progress.json', mimeType: 'application/json', buffer });
}
test('settings persist independently and the neutral preview does not disclose assessment help', async ({ page }) => {
  await page.goto('./#/diagnostic'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/u);
  await page.goto('./#/settings');
  for (const [label, value, attribute] of [['Төс тәртибе', 'dark', 'data-theme'], ['Язу зурлыгы', '24', 'data-text-size'], ['Гарәп язуы зурлыгы', '48', 'data-arabic-size'], ['Хәрәкәтләр', 'reduce', 'data-motion']]) {
    await page.getByRole('combobox', { name: label!, exact: true }).selectOption(value!);
    await expect(page.locator('html')).toHaveAttribute(attribute!, value!);
  }
  await page.getByRole('combobox', { name: 'Уку юлы', exact: true }).selectOption('new_to_script');
  await expect(page.getByRole('combobox', { name: 'Уку юлы', exact: true })).toHaveValue('new_to_script');
  await page.getByRole('combobox', { name: 'Бер кабатлау сеансындагы карточкалар саны', exact: true }).selectOption('3');
  await expect(page.getByRole('combobox', { name: 'Бер кабатлау сеансындагы карточкалар саны', exact: true })).toHaveValue('3');
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-arabic-size', '48');
  await page.goto('./#/settings/backup'); const data = JSON.parse((await exportFile(page)).toString());
  expect(data.data.sessions[0].assessment_help_opened_at).toBeNull(); expect(data.data.settings.review_batch_size).toBe(3);
  await page.goto('./#/about');
  await expect(page.getByRole('textbox', { name: 'Техник мәгълүмат', exact: true })).toHaveValue(/1\.0\.0/u);
  expect(await page.getByRole('textbox', { name: 'Техник мәгълүмат', exact: true }).inputValue()).not.toContain(data.data.sessions[0].session_id);
  for (const href of ['licenses/Inter.txt', 'licenses/NotoNaskhArabic.txt', 'licenses/ThirdParty.txt']) expect((await page.request.get((await page.locator(`a[href$="${href}"]`).getAttribute('href'))!)).ok()).toBe(true);
});

test('download, cancel, reset and confirmed import restore exact attempts, bookmarks and draft @smoke', async ({ page }) => {
  await page.goto('./#/reading/READ-01/questions'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Әлегә белмим', exact: true }).click(); await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await page.locator('input[value="b"]').check(); await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/reading\/READ-01$/u);
  await page.goto('./#/dictionary/lex-55-044'); await page.getByRole('button', { name: 'Сакланган сүзләргә өстәргә', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сакланган сүзләрдән алырга', exact: true })).toBeVisible();
  await page.goto('./#/settings/backup'); const file = await exportFile(page); const before = JSON.parse(file.toString()).data;
  expect(before.attempts).toHaveLength(1); expect(before.bookmarks).toHaveLength(1);
  await page.getByRole('button', { name: 'Нәтиҗәләрне бетерергә', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await page.getByRole('button', { name: 'Нәтиҗәләрне бетерергә', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Нәтиҗәләрне бетерергә', exact: true }).click();
  await expect(page.getByText('Уку нәтиҗәләре бетерелде.', { exact: true })).toBeVisible();
  await importFile(page, file); await expect(page.locator('.import-preview')).toContainText('1 җавап, 1 сакланган урын');
  await page.getByRole('button', { name: 'Кире кагарга', exact: true }).click(); await expect(page.locator('.import-preview')).toHaveCount(0);
  await importFile(page, file); await page.getByRole('button', { name: 'Хәзерге нәтиҗәләрне алыштырырга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Хәзерге нәтиҗәләрне алыштырырга', exact: true }).click();
  await expect(page.getByText('Нәтиҗәләр алынды.', { exact: true })).toBeVisible();
  const restored = JSON.parse((await exportFile(page)).toString()).data;
  expect(restored.attempts).toEqual(before.attempts); expect(restored.bookmarks).toEqual(before.bookmarks); expect(restored.presentations).toEqual(before.presentations);
  expect(restored.sessions[0].data_generation).not.toBe(before.sessions[0].data_generation);
  await page.goto('./#/reading/READ-01/questions'); await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.locator('input[value="b"]')).toBeChecked();
});

test('malformed, unsupported and oversized imports have distinct errors and cancelled validation stays closed @smoke', async ({ page }) => {
  await page.goto('./#/settings/backup'); const file = await exportFile(page);
  await importFile(page, Buffer.from('{')); await expect(page.getByText('Бу файлны укып булмады.', { exact: false })).toBeVisible();
  const unsupported = JSON.parse(file.toString()); unsupported.schema_version = 999;
  await importFile(page, Buffer.from(JSON.stringify(unsupported))); await expect(page.getByText('Бу файлның форматы кушымтаның хәзерге басмасында ачылмый.', { exact: false })).toBeVisible();
  await importFile(page, Buffer.alloc(20 * 1024 * 1024 + 1)); await expect(page.getByText('Файл 20 MiB күләменнән зуррак.', { exact: false })).toBeVisible();
  await page.reload();
  let unblock!: () => void; const blocked = new Promise<void>(resolve => { unblock = resolve; });
  await page.route('**/runtime/module-M01.json', async route => { await blocked; await route.continue(); });
  await importFile(page, file); await expect(page.getByText('Файл тикшерелә…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Кире кагарга', exact: true }).click(); unblock();
  await page.getByRole('button', { name: 'Нәтиҗәләр файлын әзерләргә', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Файлны йөкләп алырга', exact: true })).toBeVisible();
  await expect(page.locator('.import-preview')).toHaveCount(0);
});
