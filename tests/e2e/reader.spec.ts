import { test, expect } from '@playwright/test';

test('word help uses the local inflected form and persists before display', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/reading/READ-01');
  await page.locator('#READ-01-L01').getByRole('button', { name: 'Сүз сайларга', exact: true }).click();
  await page.locator('#READ-01-L01').getByRole('button', { name: 'بال', exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Умарта кортлары җыйган татлы азык.', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('link', { name: 'Сүзлек', exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: 'Укылышны ачарга', exact: true }).click();
  await expect(panel.getByText('бал', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Мәгънәсен ачарга', exact: true }).click();
  await expect(panel.getByText('Умарта кортлары җыйган татлы азык.', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Ябарга', exact: true }).click();
  await expect(page.locator('#READ-01-L01').getByRole('button', { name: 'بال', exact: true })).toBeFocused();
  await page.goForward();
  await expect(page.getByRole('dialog').getByText('бал', { exact: true })).toBeVisible();
});

test('exact dictionary link returns to the word panel and direct panels close locally', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/reading/READ-03?panel=word&word=READ-03-L01%3A0');
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Мәгънәсен ачарга', exact: true }).click();
  await expect(panel.getByText('Уку өчен язылган әсәр яки басма.', { exact: true })).toBeVisible();
  await panel.getByRole('link', { name: 'Сүзлек', exact: true }).click();
  await expect(page).toHaveURL(/#\/dictionary\/lex-55-044$/u);
  await expect(page.getByText('Уку өчен язылган һәм бергә тупланган әсәр яки басма.', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('dialog').getByText('Уку өчен язылган әсәр яки басма.', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Ябарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/reading\/READ-03$/u);
});

test('closed final text and a foreign word URL never expose a word', async ({ page }) => {
  await page.goto('./#/reading/READ-F01?panel=word&word=READ-F01-L01%3A0');
  await expect(page.getByRole('link', { name: 'Йомгаклау тикшерүе', exact: true })).toBeVisible();
  await expect(page.locator('.reading-line')).toHaveCount(0);
  await page.goto('./#/reading/READ-03?panel=word&word=READ-01-L01%3A0');
  await expect(page.locator('#READ-03-L01')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/reading\/READ-03$/u);
});

test('semantic anchors, keyboard trigger and independent mode survive an article roundtrip', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./#/reading/READ-03?at=READ-03-L01');
  await page.getByLabel('Уку тәртибе').selectOption('independent');
  await page.locator('#READ-03-L01').getByRole('button', { name: 'Сүз сайларга', exact: true }).click();
  await page.locator('#READ-03-L01').getByRole('button', { name: 'كتاب', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Сүзлек', exact: true }).click();
  await page.getByRole('button', { name: 'Текстка кайтырга', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Укылышны ачарга', exact: true })).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Ябарга', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('#READ-03-L01').getByRole('button', { name: 'كتاب', exact: true })).toBeFocused();
  expect(await page.locator('#READ-03-L01').getByRole('button', { name: 'كتاب', exact: true }).evaluate(node => node.tabIndex)).toBe(0);
  await expect(page.getByLabel('Уку тәртибе')).toHaveValue('independent');
});

test('selection does not open a panel and an unsuccessful help write exposes no explanation', async ({ page }) => {
  await page.goto('./#/reading/READ-01');
  const word = page.locator('[id="word:READ-01-L01:0"]');
  await word.evaluate(node => { const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection!.removeAllRanges(); selection!.addRange(range); });
  await word.dispatchEvent('click', { detail: 1 });
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.goto('./#/reading/READ-01?panel=word&word=READ-01-L01%3A0');
  const panel = page.getByRole('region', { name: 'Сүз турында', exact: true });
  await panel.getByRole('button', { name: 'Мәгънәсен ачарга', exact: true }).waitFor();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'exposures' && value.first_meaning_exposed_at !== null) throw new DOMException('test quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await panel.getByRole('button', { name: 'Мәгънәсен ачарга', exact: true }).click();
  await expect(panel.getByText('Соңгы үзгәрешләр бу җайланмада сакланмады.', { exact: true })).toBeVisible();
  await expect(panel.getByText('Умарта кортлары җыйган татлы азык.', { exact: true })).toHaveCount(0);
});

test('Forward to a panel closes the compact menu instead of stacking modal layers', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./#/reading/READ-03');
  await page.locator('[id="word:READ-03-L01:0"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ябарга', exact: true }).click();
  await page.getByRole('button', { name: 'Бүлекләрне ачарга', exact: true }).click();
  await page.goForward();
  await expect(page.getByRole('dialog', { name: 'Сүз турында', exact: true })).toBeVisible();
  await expect(page.locator('dialog[open][data-modal=true]')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Ябарга', exact: true }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('pending assessment confirmation temporarily replaces the panel and cancel keeps help hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:5176/isketatar/#/reading/READ-01');
  await expect(page.locator('#READ-01-L01')).toBeVisible();
  await page.evaluate(async () => {
    const contentPath = '/isketatar/src/data/content/repository.ts'; const progressPath = '/isketatar/src/data/progress/repository.ts';
    const { ContentRepository } = await import(/* @vite-ignore */ contentPath); const { ProgressRepository, expectedFrom } = await import(/* @vite-ignore */ progressPath);
    const content = await ContentRepository.open(); await content.load('assessments.json');
    const repository = await ProgressRepository.open({ catalog: content.catalog, releaseId: `development-${content.catalog.core.content_version}`, tabId: sessionStorage.getItem('iske-imla-tab') });
    await repository.dispatch({ type: 'start', kind: 'diagnostic' }, expectedFrom(await repository.snapshot())); repository.close();
  });
  await page.reload();
  await page.locator('[id="word:READ-01-L01:0"]').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Мәгънәсен ачарга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Тәмамланмаган тикшерүләр бар', exact: true })).toBeVisible();
  await expect(page.locator('dialog[open][data-modal=true]')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Сүз турында', exact: true })).toBeVisible();
  await expect(page.getByText('Умарта кортлары җыйган татлы азык.', { exact: true })).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await page.getByRole('dialog', { name: 'Тәмамланмаган тикшерүләр бар', exact: true }).getByRole('button', { name: 'Материалны ачарга', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Сүз турында', exact: true }).getByText('Умарта кортлары җыйган татлы азык.', { exact: true })).toBeVisible();
  await expect(page.locator('dialog[open][data-modal=true]')).toHaveCount(1);
});

test('reload restores panel position only after delayed letter details are ready', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('./#/reading/READ-03?panel=word&word=READ-03-L01%3A0');
  const panel = page.getByRole('dialog', { name: 'Сүз турында', exact: true });
  for (const name of ['Хәрефләрне күрсәтергә', 'Кагыйдә', 'Укылышны ачарга', 'Мәгънәсен ачарга']) await panel.getByRole('button', { name, exact: true }).click();
  await expect(panel.locator('.letter-help')).toBeVisible();
  await panel.getByRole('link', { name: 'Сүзлек', exact: true }).focus();
  await panel.evaluate(node => { node.scrollTop = 400; node.dispatchEvent(new Event('scroll')); });
  await page.route('**/runtime/references.json', async route => { await new Promise(resolve => setTimeout(resolve, 500)); await route.continue(); });
  await page.reload();
  await expect(panel.locator('.letter-help')).toBeVisible();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await panel.evaluate(node => node.scrollTop)).toBe(400);
  await expect(panel.getByRole('link', { name: 'Сүзлек', exact: true })).toBeFocused();
});
