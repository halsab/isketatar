import { test, expect } from '@playwright/test';
import dictionary from '../../public/runtime/vocabulary.json' with { type: 'json' };

test('first course exposure in another window preserves the live search input during vocabulary loading', async ({ page, context }) => {
  await page.goto('./#/dictionary'); await expect(page.locator('.dictionary-group').first()).toBeVisible();
  const writer = await context.newPage(); await writer.goto('./#/settings');
  await writer.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await writer.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  const input = page.getByRole('searchbox'); await input.fill('тәһарәт');
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/runtime/vocabulary.json')), writer.goto('./#/lessons/V04')]);
  await expect(writer.locator('.lesson-example').first()).toBeVisible();
  await expect(page.locator('.dictionary-group').first()).toBeVisible();
  await expect(input).toHaveValue('тәһарәт'); await expect(input).toBeFocused();
  await writer.close();
});

test('search separates homographs and explicit near spellings without replacing input focus', async ({ page }) => {
  await page.goto('./#/dictionary?q=عالم');
  await expect(page.locator('.dictionary-group h3 a[href="#/dictionary/lex-55-046"]')).toBeVisible();
  await expect(page.locator('.dictionary-group h3 a[href="#/dictionary/lex-55-158"]')).toBeVisible();
  const input = page.getByRole('searchbox');
  await input.fill('کتاب');
  await expect(input).toBeFocused();
  await expect(page).toHaveURL(/q=%DA%A9%D8%AA%D8%A7%D8%A8/u);
  await expect(page.locator('.dictionary-group h3 a[href="#/dictionary/lex-55-044"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Киңәйтелгән эзләү', exact: true }).check();
  await expect(page.locator('.dictionary-group h3 a[href="#/dictionary/lex-55-044"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Якын язылышлар', exact: true })).toBeVisible();
});

test('more groups preserve scroll and an article return restores the query, count and focused result', async ({ page }) => {
  await page.goto('./#/dictionary');
  await expect(page.locator('.dictionary-group')).toHaveCount(30);
  const more = page.getByRole('button', { name: 'Тагын күрсәтергә', exact: true });
  await more.scrollIntoViewIfNeeded(); const before = await page.evaluate(() => scrollY);
  await more.click();
  await expect(page.locator('.dictionary-group')).toHaveCount(60);
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(before - 200);
  const entry = page.locator('.dictionary-group h3 a').nth(45); const id = await entry.getAttribute('data-result-id');
  await entry.click();
  await expect(page).toHaveURL(new RegExp(`/dictionary/${id}$`, 'u'));
  await expect(page.getByRole('button', { name: 'Артка', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Артка', exact: true }).click();
  await expect(page.locator('.dictionary-group')).toHaveCount(60);
  await expect(page.locator(`.dictionary-group h3 a[data-result-id="${id}"]`)).toBeFocused();
  await expect(page.locator(`.dictionary-group h3 a[data-result-id="${id}"]`)).toBeInViewport();
});

test('null readings stay source-only and saved filtering is distinct from an empty search', async ({ page }) => {
  await page.goto('./#/dictionary?scope=saved');
  await expect(page.getByText('Әлегә сакланган сүзләр юк.', { exact: false })).toBeVisible();
  await page.goto('./#/dictionary/lex-56-122');
  await expect(page.getByText('Татарча укылышы күрсәтелмәгән.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Кабатлауга өстәргә', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Сакланган сүзләргә өстәргә', exact: true }).click();
  await page.goto('./#/dictionary?scope=saved');
  await expect(page.locator('.dictionary-group')).toHaveCount(1);
  await expect(page.locator('.dictionary-group h3 a')).toHaveAttribute('href', '#/dictionary/lex-56-122');
  await page.getByRole('searchbox').fill('а'.repeat(257));
  await expect(page.getByText('Эзләү соравы 256 билгедән озынрак булмаска тиеш.', { exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox')).toHaveValue('а'.repeat(257));
  await expect(page.locator('.dictionary-group')).toHaveCount(0);
});

test('results disclose help before showing meanings during an unfinished diagnostic', async ({ page }) => {
  await page.goto('./#/diagnostic'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/$/u);
  await page.goto('./#/dictionary?q=عالم');
  await expect(page.locator('.dictionary-group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await expect(page.locator('.dictionary-group')).toHaveCount(0);
  await page.getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await expect(page.locator('.dictionary-group').first()).toBeVisible();
});

test('released course entries can add only their prepared question to review', async ({ page }) => {
  const entry = dictionary.vocabulary.find(entry => entry.lesson_id === 'V04' && entry.release === 'with_lesson' && entry.question_ids.length)!;
  await page.goto('./#/lessons/V04'); await expect(page.locator('.lesson-example').first()).toBeVisible();
  await page.goto(`./#/dictionary/${entry.id}`);
  await page.getByRole('button', { name: 'Кабатлауга өстәргә', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Кабатлауга өстәлде.', exact: true })).toBeDisabled();
});

test('filters and clearing push history while typing debounces replace and Escape preserves the query', async ({ page }) => {
  await page.goto('./#/dictionary?q=кыямәт');
  await expect(page.locator('.dictionary-group')).toHaveCount(3);
  await page.locator('.dictionary-group summary').click();
  const input = page.getByRole('searchbox');
  await input.focus(); await input.press('Escape');
  await expect(input).toHaveValue('кыямәт');
  await expect(page.locator('.dictionary-group details')).not.toHaveAttribute('open');
  const old = page.url();
  await page.getByRole('checkbox', { name: 'Сакланган сүзләр', exact: true }).check();
  await expect(page).toHaveURL(/scope=saved/u);
  await page.goBack(); await expect(page).toHaveURL(old);
  await expect(page.getByRole('checkbox', { name: 'Сакланган сүзләр', exact: true })).not.toBeChecked();
  await input.fill(''); await expect(page).toHaveURL(/#\/dictionary$/u);
  await page.goBack(); await expect(input).toHaveValue('кыямәт');
  const length = await page.evaluate(() => history.length);
  await input.fill('галим'); await expect(page).toHaveURL(/q=%D0%B3%D0%B0%D0%BB%D0%B8%D0%BC/u);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('submit before debounce preserves the previous query group state', async ({ page }) => {
  await page.goto('./#/dictionary?q=кыямәт');
  await page.locator('.dictionary-group summary').click();
  const old = page.url(); const input = page.getByRole('searchbox');
  await input.focus(); await input.press('End'); await input.pressSequentially('xx'); await input.press('Enter');
  await expect(page).toHaveURL(/xx$/u);
  await page.goBack(); await expect(page).toHaveURL(old);
  await expect(input).toHaveValue('кыямәт');
  await expect(page.locator('.dictionary-group details')).toHaveAttribute('open');
});
