import { test, expect } from '@playwright/test';

const url = 'http://127.0.0.1:5176/isketatar/tests/browser/controls.html';
test('Tatar keys replace selection, undo safely, and respect IME', async ({ page }) => {
  await page.goto(url);
  const input = page.getByLabel('Җавабың', { exact: true });
  await input.fill('китап');
  await input.evaluate((node: HTMLInputElement) => { node.focus(); node.setSelectionRange(1, 4); node.dispatchEvent(new Event('select', { bubbles: true })); });
  await page.getByRole('button', { name: 'ә хәрефен куярга', exact: true }).click();
  await expect(input).toHaveValue('кәп');
  await expect(input).toBeFocused();
  await page.getByRole('button', { name: 'Кертүне кире кайтарырга' }).click();
  await expect(input).toHaveValue('китап');
  await input.dispatchEvent('compositionstart');
  expect(await input.evaluate(node => node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true })))).toBe(true);
  await expect(page.locator('#submitted')).toHaveText('0');
  await page.getByRole('button', { name: 'ө хәрефен куярга', exact: true }).click();
  await expect(input).toHaveValue('китап');
  await input.dispatchEvent('compositionend');
  await input.press('Enter');
  await expect(page.locator('#submitted')).toHaveText('1');
  await page.getByRole('button', { name: 'ө хәрефен куярга', exact: true }).click();
  await input.fill('яңа');
  await expect(page.getByRole('button', { name: 'Кертүне кире кайтарырга' })).toHaveCount(0);
});

test('context panel changes modality without losing focus or content', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(url);
  await page.getByRole('button', { name: 'Чыганакны ачарга' }).click();
  await expect(page.getByRole('region', { name: 'Чыганак' })).toBeVisible();
  const inside = page.getByLabel('Билге');
  await inside.fill('саклана');
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('dialog', { name: 'Чыганак' })).toHaveAttribute('aria-modal', 'true');
  await expect(inside).toBeFocused();
  await expect(inside).toHaveValue('саклана');
  const dialog = page.getByRole('dialog', { name: 'Чыганак' });
  await dialog.evaluate(node => { const paragraph = document.createElement('p'); paragraph.textContent = 'Озын текст. '.repeat(500); node.append(paragraph); node.scrollTop = 220; });
  const scroll = await dialog.evaluate(node => node.scrollTop);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole('region', { name: 'Чыганак' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node => node.scrollTop)).toBe(scroll);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Чыганакны ачарга' })).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Чыганакны ачарга' }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('heading', { name: 'Чыганак', exact: true })).toBeFocused();
  expect(await dialog.evaluate(node => node.scrollTop)).toBe(0);
  await page.keyboard.press('Escape');
  for (const width of [320, 360, 640, 1120]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: 'Бүлекләрне ачарга' }).click();
  await page.setViewportSize({ width: 640, height: 900 });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Сузыкларны уку', exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.addStyleTag({ content: ':root { font-size: 200% }' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('pointer dismissal returns focus to the compact menu trigger without a resize', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto(url);
  const trigger = page.getByRole('button', { name: 'Бүлекләрне ачарга', exact: true });
  await trigger.click(); const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Ябарга', exact: true }).click();
  await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});
