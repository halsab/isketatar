import { test, expect } from '@playwright/test';
import readings from '../../public/runtime/readings.json' with { type: 'json' };
import references from '../../public/runtime/references.json' with { type: 'json' };
import core from '../../public/runtime/core.json' with { type: 'json' };

test('reading catalog has ten ordinary and two locked final texts, without text previews', async ({ page }) => {
  await page.goto('./#/reading');
  await expect(page.locator('.reading-card')).toHaveCount(12);
  await expect(page.locator('.reading-card a[href^="#/reading/READ-"]')).toHaveCount(10);
  await expect(page.locator('.reading-card a[href="#/final"]')).toHaveCount(2);
  await expect(page.getByText(readings.readings[10]!.lines[0]!.display_form, { exact: true })).toHaveCount(0);
  await page.locator('.reading-card a[href="#/reading/READ-03"]').click();
  await expect(page.locator('.reading-line')).toHaveCount(readings.readings[2]!.lines.length);
  await page.locator('.primary-nav a[href="#/reading"]').filter({ visible: true }).click();
  await expect(page.locator('.reading-card')).toHaveCount(12);
});

test('reference shows the complete alphabet, profiles and real rule links', async ({ page }) => {
  await page.goto('./#/reference/letters');
  await expect(page.locator('.letter-card')).toHaveCount(34);
  await page.locator('a[href="#/reference/letters/LETTER-01"]').click();
  await expect(page.locator('.letter-card')).toHaveCount(1);
  await expect(page.getByText(references.letters[0]!.function_tt, { exact: true })).toBeVisible();
  await page.goto('./#/reference');
  await expect(page.locator('a[href^="#/reference/profiles/"]')).toHaveCount(6);
  await expect(page.locator('a[href^="#/reference/rules/"]')).toHaveCount(145);
});

test('source context validates exact section and never fetches an arbitrary source path', async ({ page }) => {
  const line = readings.readings[2]!.lines[0]!;
  const section = core.source_sections.find(section => section.line_start <= line.source_lines[0]! && section.line_end >= line.source_lines[1]!)!;
  await page.goto(`./#/sources/${section.id}?context=${line.id}`);
  await expect(page.locator('.source-fragment')).toContainText(line.source_form);
  await page.goto(`./#/sources/S-001?context=${line.id}`);
  await expect(page.locator('.source-fragment')).toHaveCount(0);
  await expect(page.getByText('Бу өзек сайланган чыганак бүлегенә туры килми яки әлегә ачылмаган.', { exact: true })).toBeVisible();
  await page.goto(`./#/sources/${section.id}`);
  await expect(page.locator('.source-fragment')).toHaveCount(0);
  await expect(page.getByText('Иске татар имлясы буенча дәреслек', { exact: false })).toBeVisible();
});

test('reference resume keeps a position inside the long rule list after loading', async ({ page }) => {
  await page.goto('./#/reference');
  const rule = page.locator('a[href="#/reference/rules/R-L07-01"]');
  await rule.scrollIntoViewIfNeeded();
  await expect.poll(() => page.evaluate(() => history.state?.iskePosition?.anchor_id)).toBe('rules');
  const scroll = await page.evaluate(() => scrollY);
  await page.reload();
  await expect(page.locator('a[href^="#/reference/rules/"]')).toHaveCount(145);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(scroll - 150);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeLessThan(scroll + 150);
});

test('source roundtrip restores the originating word-panel control', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/reading/READ-03?panel=word&word=READ-03-L01%3A0');
  const source = page.getByRole('dialog').locator('a[data-panel-control^="source:"]').first();
  await source.click();
  await expect(page.locator('.source-fragment')).toBeVisible();
  await page.goBack();
  await expect(source).toBeFocused();
});

test('the alphabet waits for confirmed help while a diagnostic is unfinished', async ({ page }) => {
  await page.goto('./#/diagnostic'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await page.goto('./#/reference');
  await page.locator('.chapter-contents a[href="#/reference?at=terms"]').click();
  await expect(page.locator('#terms')).toBeFocused();
  await page.goto('./#/reference/letters');
  await expect(page.locator('.letter-card')).toHaveCount(0);
  const open = page.getByRole('button', { name: 'Материалны ачарга', exact: true });
  await open.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await expect(page.locator('.letter-card')).toHaveCount(0);
  await open.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await expect(page.locator('.letter-card')).toHaveCount(34);
});
