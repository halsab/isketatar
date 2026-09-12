import { test, expect, type Page } from '@playwright/test';
import moduleData from '../../public/runtime/module-M02.json' with { type: 'json' };
import morphologyData from '../../public/runtime/module-M05.json' with { type: 'json' };
import foundationData from '../../public/runtime/module-M00.json' with { type: 'json' };

async function chooseRoute(page: Page) {
  await page.getByRole('link', { name: 'Юлны сайларга', exact: true }).click();
  await page.getByRole('radio', { name: 'Гарәп хәрефләрен беләм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
}
async function snapshot(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('iske-imla-progress'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['sessions', 'presentations', 'attempts']);
    const all = (store: string) => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [sessions, presentations, attempts] = await Promise.all([all('sessions'), all('presentations'), all('attempts')]); db.close();
    return { sessions, presentations, attempts };
  });
}

test('a direct example anchor waits for the checked disclosure before restoring focus and position', async ({ page }) => {
  await page.goto('./#/lessons/V04?at=EX-V04-03');
  await expect(page.locator('#EX-V04-03')).toBeFocused();
  await expect(page.locator('#EX-V04-03')).toBeInViewport();
});

test('direct practice keeps onboarding intent, flushes draft on exit and restores the exact session', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice');
  await chooseRoute(page);
  await expect(page).toHaveURL(/#\/lessons\/V04\/practice$/u);
  expect((await snapshot(page)).sessions).toHaveLength(0);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/V04$/u);
  const paused = await snapshot(page);
  expect(paused.sessions).toHaveLength(1);
  expect(paused.sessions[0]).toMatchObject({ status: 'paused' });
  expect(paused.presentations).toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'әңгәмә' } }));
  await page.getByRole('link', { name: 'Күнегүләр', exact: true }).first().click();
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә' }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
  expect((await snapshot(page)).sessions).toHaveLength(1);
});

test('failed draft stays visible and is copied only to an explicit memory branch', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice'); await chooseRoute(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'presentations' && value.draft_answer?.kind === 'text') throw new DOMException('test quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  await expect(page.getByText('Соңгы үзгәрешләр бу җайланмада сакланмады.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Вакытлыча саклап дәвам итәргә', exact: true }).click();
  await expect(page.getByText('Бу юлы нәтиҗәләр вакытлыча гына саклана.', { exact: false })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
  expect((await snapshot(page)).presentations).not.toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'әңгәмә' } }));
});

test('wrong answer, retry and acknowledgement remain distinct', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice'); await chooseRoute(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('ялгыш');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).dblclick();
  await expect(page.locator('.feedback')).toContainText('Бу җавап туры килмәде.');
  await expect(page.getByRole('heading', { name: 'Җавап нәтиҗәсе', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Кабат эшләргә', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('ылыс');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await expect(page.locator('.feedback')).toContainText('Дөрес!');
  const records = await snapshot(page);
  expect(records.attempts).toHaveLength(2);
  expect(records.attempts).toContainEqual(expect.objectContaining({ ordinal: 1, grade: 'incorrect', first_submission_in_cycle: true }));
  expect(records.attempts).toContainEqual(expect.objectContaining({ ordinal: 2, grade: 'correct', first_submission_in_cycle: false }));
  await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await expect(page.locator('.question-prompt')).not.toContainText('Бу сүзне хәзерге татар кириллицасы белән яз.');
});

test('read-only practice can exit and explicit takeover gives a new editor valid permissions', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice'); await chooseRoute(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
  const popupPromise = page.waitForEvent('popup'); await page.evaluate(() => { window.open(location.href); }); const popup = await popupPromise;
  await expect(popup.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeDisabled();
  await popup.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(popup).toHaveURL(/#\/lessons\/V04$/u);
  await popup.getByRole('link', { name: 'Күнегүләр', exact: true }).first().click();
  await popup.getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await popup.getByRole('dialog').getByRole('button', { name: 'Монда дәвам итәргә', exact: true }).click();
  await popup.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('ылыс');
  await popup.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await expect(popup.locator('.feedback')).toContainText('Дөрес!');
  await popup.close();
});

test('retrying a failed show opens the question without creating another session', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice'); await chooseRoute(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
    IDBObjectStore.prototype.put = function (value, key) {
      if (this.name === 'presentations' && value.shown_at !== null) throw new DOMException('test quota', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Саклауны кабатларга', exact: true })).toBeVisible();
  expect(await page.locator('.question-stimulus').count()).toBe(0);
  await page.evaluate(() => { Reflect.get(window, 'restorePut')(); });
  await page.getByRole('button', { name: 'Саклауны кабатларга', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toBeVisible();
  expect((await snapshot(page)).sessions).toHaveLength(1);
});

test('font failure pauses an existing draft and recovery requires explicit resume', async ({ page }) => {
  await page.goto('./#/lessons/V04/practice'); await chooseRoute(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('әңгәмә');
  await expect.poll(async () => (await snapshot(page)).presentations).toContainEqual(expect.objectContaining({ draft_answer: { kind: 'text', text: 'әңгәмә' } }));
  await page.route('**/NotoNaskhArabic-Regular*.woff2', route => route.abort());
  await page.reload();
  await expect(page.getByText('Иске язу шрифтын йөкләп булмады.', { exact: false })).toBeVisible();
  await expect.poll(async () => (await snapshot(page)).sessions).toContainEqual(expect.objectContaining({ status: 'paused' }));
  expect(await page.locator('.question-stimulus').count()).toBe(0);
  await page.unroute('**/NotoNaskhArabic-Regular*.woff2');
  await page.getByRole('button', { name: 'Кабат эшләргә', exact: true }).click();
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә' }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('әңгәмә');
});

for (const [id, data, practiceCount] of [['V04', moduleData, 6], ['A02', morphologyData, 9], ['B01', foundationData, 6]] as const) test(`${id} completes its real practice/transfer plan with correct denominator`, async ({ page }) => {
  await page.goto(`./#/lessons/${id}/practice`); await chooseRoute(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  const questions = data.questions.filter(question => question.lesson_id === id).sort((a, b) => Number(a.assessment_role === 'transfer') - Number(b.assessment_role === 'transfer'));
  for (const question of questions) {
    await expect(page.locator('.question-prompt')).toHaveText(question.prompt_tt);
    if (question.type === 'reading' || question.type === 'segment') await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(question.accepted_answers[0]!);
    else for (const answer of question.accepted_answers) await page.locator(`input[value="${answer}"]`).check();
    await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
    await expect(page.locator('.feedback')).toContainText('Дөрес!');
    await page.getByRole('button', { name: 'Алга', exact: true }).click();
  }
  await expect(page).toHaveURL(new RegExp(`#/lessons/${id}/result/`));
  await expect(page.getByText(`Күнегүләр: ${practiceCount} / ${practiceCount} дөрес җавап`, { exact: true })).toBeVisible();
  const result = await snapshot(page);
  expect(result.sessions).toHaveLength(1); expect(result.attempts).toHaveLength(questions.length);
  expect(result.sessions[0]).toMatchObject({ status: 'submitted' });
});
