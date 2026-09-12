import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page, type TestInfo } from '@playwright/test';

async function audit(page: Page, info: TestInfo, state: string) {
  await expect(page.getByText('Курс ачыла…', { exact: true })).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})));
  });
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  await info.attach(state, { body: JSON.stringify(result), contentType: 'application/json' });
  expect.soft(result.violations, state).toEqual([]);
  if (result.incomplete.length) await info.attach(`${state}-manual-review`, { body: await page.screenshot(), contentType: 'image/png' });
}
const screens = [
  ['home', '/', '.home-continuation'], ['onboarding', '/start', 'input[type=radio]'],
  ['course', '/lessons', '.course-module'], ['lesson', '/lessons/V04', '.lesson-example'],
  ['reading-list', '/reading', '.reading-card'], ['reader', '/reading/READ-03', '.reading-line'],
  ['dictionary', '/dictionary', 'input[type=search]'], ['entry', '/dictionary/lex-55-044', '.source-card'],
  ['reference', '/reference', '#rules'], ['alphabet', '/reference/letters', '.letter-card'],
  ['letter', '/reference/letters/LETTER-01', '.letter-card'], ['rule', '/reference/rules/R-L07-01', '.reference-detail'],
  ['source', '/sources/S-001', '.source-document'], ['review', '/review', '#main h1'],
  ['diagnostic-start', '/diagnostic', '#main h1'], ['final-start', '/final', '#main h1'],
  ['settings', '/settings', '#install'], ['backup', '/settings/backup', 'input[type=file]'],
  ['about', '/about', 'textarea'], ['not-found', '/missing-page', '#main h1'],
] as const;
for (const theme of ['light', 'dark']) test(`screen families have no axe violations in ${theme} @quality`, async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'The shared semantic DOM is scanned once; interaction tests run in all engines.');
  test.setTimeout(240_000);
  for (const [name, route, ready] of screens) {
    await page.goto(`./#${route}`); await expect(page.locator('.site-header')).toBeVisible();
    await expect(page.locator(ready).first()).toBeVisible();
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    await audit(page, info, `${theme}-${name}`);
  }
});

test('confirmation cancellation returns pointer focus to its trigger', async ({ page }) => {
  await page.goto('./#/settings/backup');
  const trigger = page.getByRole('button', { name: 'Нәтиҗәләрне бетерергә', exact: true });
  await trigger.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await expect(trigger).toBeFocused();
});

test('question, feedback, reader panel, confirmation and import error are accessible @quality', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Shared DOM audit.'); test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/lessons/V04/practice');
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
  await audit(page, info, 'text-question');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await audit(page, info, 'empty-answer-error');
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('ялгыш');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await expect(page.locator('.feedback')).toBeVisible(); await audit(page, info, 'incorrect-feedback');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click(); await expect(page).toHaveURL(/#\/lessons\/V04$/u);
  await page.goto('./#/reading/READ-03?panel=word&word=READ-03-L01%3A0');
  await expect(page.getByRole('dialog')).toBeVisible(); await audit(page, info, 'word-dialog');
  await page.setViewportSize({ width: 1280, height: 900 }); await expect(page.getByRole('dialog', { name: 'Сүз турында', exact: true })).toBeVisible();
  await audit(page, info, 'word-region');
  await page.goto('./#/settings/backup');
  await page.getByRole('button', { name: 'Нәтиҗәләрне бетерергә', exact: true }).click(); await audit(page, info, 'reset-confirmation');
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await page.getByLabel('Нәтиҗәләр файлын сайларга', { exact: true }).setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{') });
  await expect(page.getByText('Бу файлны укып булмады.', { exact: false })).toBeVisible(); await audit(page, info, 'import-error');
});

for (const [name, route, ready] of screens.filter(([name]) => ['home', 'course', 'lesson', 'reader', 'dictionary', 'entry', 'alphabet', 'settings', 'backup'].includes(name))) {
  test(`${name} reflows with enlarged text, script sizes and spacing @quality`, async ({ page, browserName }, info) => {
    test.skip(browserName !== 'chromium', 'Layout matrix is run once; browser-specific controls are covered separately.');
    await page.goto(`./#${route}`); await expect(page.locator('.site-header')).toBeVisible(); await expect(page.locator(ready).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { const sheet = document.styleSheets[0]!; sheet.insertRule('p { margin-bottom: 2em !important; }', sheet.cssRules.length); sheet.insertRule('*:not(.arabic):not(.arabic *) { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; }', sheet.cssRules.length); });
    for (const [index, width] of [320, 360, 640, 1120].entries()) for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(({ scale, index }) => {
        const root = document.documentElement; root.style.fontSize = `${scale}%`;
        root.dataset.textSize = '24'; root.dataset.arabicSize = ['28', '32', '40', '48'][index]; root.dataset.theme = scale === 100 ? 'light' : 'dark';
      }, { scale, index });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
      expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}/${width}/${scale}/page`).toBe(true);
      expect.soft(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('#main *')].filter(node => { const rect = node.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && getComputedStyle(node).position !== 'fixed'; }).map(node => ({ tag: node.tagName, class: node.className, text: node.textContent?.slice(0, 60) }))), `${name}/${width}/${scale}`).toEqual([]);
    }
    if (['lesson', 'reader', 'settings'].includes(name)) {
      await page.setViewportSize({ width: 320, height: 844 });
      await page.screenshot({ path: info.outputPath(`${name}-320-large.png`), fullPage: false });
      await info.attach(`${name}-320-large`, { path: info.outputPath(`${name}-320-large.png`), contentType: 'image/png' });
      await page.emulateMedia({ forcedColors: 'active' });
      await page.screenshot({ path: info.outputPath(`${name}-forced-colors.png`), fullPage: false });
      await info.attach(`${name}-forced-colors`, { path: info.outputPath(`${name}-forced-colors.png`), contentType: 'image/png' });
    }
  });
}

for (const kind of ['diagnostic', 'final']) test(`${kind} navigation and submitted review are accessible @quality`, async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Shared DOM audit.');
  await page.goto(`./#/${kind}`); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.locator('.question-prompt')).toBeVisible();
  await page.locator('.assessment-navigation > summary').click(); await audit(page, info, `${kind}-navigation`);
  await page.getByRole('button', { name: 'Әлегә белмим', exact: true }).click();
  await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await audit(page, info, `${kind}-unanswered-confirmation`);
  await page.getByRole('dialog').getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`#/${kind}/result/`, 'u'));
  await expect(page.locator('.result-question').first()).toBeVisible(); await audit(page, info, `${kind}-result`);
});

test('loading failures expose an accessible retry and memory choice @quality', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Shared DOM audit.');
  await page.route('**/runtime/module-M02.json', route => route.abort());
  await page.goto('./#/lessons/V04');
  await expect(page.getByText('Материалны ачып булмады.', { exact: false }).first()).toBeVisible(); await audit(page, info, 'content-failure');
  await page.unroute('**/runtime/module-M02.json');
  await page.route('**/NotoNaskhArabic-Regular*.woff2', route => route.abort());
  await page.reload();
  await expect(page.getByText('Иске язу шрифтын йөкләп булмады.', { exact: false }).first()).toBeVisible(); await audit(page, info, 'font-failure');
  await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('test denied', 'SecurityError'); }; });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Вакытлыча саклап дәвам итәргә', exact: true })).toBeVisible(); await audit(page, info, 'storage-failure');
});
