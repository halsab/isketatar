import { test, expect, type Page } from '@playwright/test';
import moduleData from '../../public/runtime/module-M02.json' with { type: 'json' };

async function seed(page: Page, count = 2) {
  await page.goto('./#/lessons/V04'); await expect(page.locator('.lesson-example').first()).toBeVisible();
  for (let index = 1; index <= count; index++) {
    await page.goto(`./#/dictionary/COURSE-EX-V04-0${index}`);
    await page.getByRole('button', { name: 'Кабатлауга өстәргә', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Кабатлауга өстәлде.', exact: true })).toBeDisabled();
  }
}
async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('iske-imla-progress'); const db = await new Promise<IDBDatabase>(resolve => { request.onsuccess = () => resolve(request.result); });
    const tx = db.transaction(['sessions', 'presentations', 'attempts', 'review_cards']);
    const all = (name: string) => new Promise<any[]>(resolve => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); });
    const [sessions, presentations, attempts, cards] = await Promise.all(['sessions', 'presentations', 'attempts', 'review_cards'].map(all)); db.close(); return { sessions: sessions!, presentations: presentations!, attempts: attempts!, cards: cards! };
  });
}
test('due review preserves its plan through skip, pause, reload and unknown; skipped remains due', async ({ page }) => {
  await page.goto('./#/review'); await expect(page.getByText('Кабатлауга әлегә карточкалар өстәлмәгән.', { exact: false })).toBeVisible();
  await seed(page); await page.goto('./#/review');
  const initial = await records(page);
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', 'Q-V04-01');
  const url = page.url();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('җавап');
  await page.getByRole('button', { name: 'Җавап бирмичә үткәрергә', exact: true }).click();
  await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', 'Q-V04-02');
  expect((await records(page)).attempts).toHaveLength(0);
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click(); await expect(page).toHaveURL(/#\/review$/u);
  await page.getByRole('link', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', 'Q-V04-02');
  await page.reload(); await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', 'Q-V04-02');
  await page.getByRole('button', { name: 'Әлегә белмим', exact: true }).click();
  await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кабатлау нәтиҗәсе', exact: true })).toBeVisible();
  expect(page.url()).toBe(url);
  const saved = await records(page); expect(saved.sessions).toHaveLength(1); expect(saved.attempts).toHaveLength(1);
  expect(saved.cards.find(card => card.question_id === 'Q-V04-01')).toEqual(initial.cards.find(card => card.question_id === 'Q-V04-01'));
  expect(saved.cards.find(card => card.question_id === 'Q-V04-02')).toMatchObject({ unknown_count: 1, step: 0 });
  await expect(page.getByRole('button', { name: 'Киләсе карточкаларга күчәргә', exact: true })).toBeVisible();
  await page.goto('./#/review');
  await expect(page.getByRole('button', { name: 'Вакытыннан алда кабатларга', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(async () => { await document.fonts.ready; document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
  await page.getByRole('button', { name: 'Вакытыннан алда кабатларга', exact: true }).click();
  await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', 'Q-V04-02');
  expect((await records(page)).sessions.find(session => session.status === 'active').question_plan.map((plan: { question_id: string }) => plan.question_id)).toEqual(['Q-V04-02']);
});

test('early correct keeps the due date; suspending and returning retain history and a paused plan with zero due', async ({ page }) => {
  await seed(page, 1); await page.goto('./#/review'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  const answer = moduleData.questions.find(question => question.id === 'Q-V04-01')!.accepted_answers[0]!;
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(answer); await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click(); await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кабатлау нәтиҗәсе', exact: true })).toBeVisible();
  const scheduled = (await records(page)).cards[0];
  await page.goto('./#/review'); await page.getByRole('button', { name: 'Вакытыннан алда кабатларга', exact: true }).click();
  await expect(page.locator('.question-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click(); await expect(page).toHaveURL(/#\/review$/u);
  await expect(page.getByRole('link', { name: 'Сакланган эшне дәвам итәргә', exact: true })).toBeVisible();
  await page.getByText('Карточкалар белән идарә итәргә', { exact: false }).click();
  await page.getByRole('button', { name: 'Кабатлаудан алырга', exact: true }).click();
  await expect(page.getByText('Кабатлаудан вакытлыча алынган.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click(); await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(answer); await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click(); await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Кабатлау нәтиҗәсе', exact: true })).toBeVisible();
  expect((await records(page)).cards[0]).toMatchObject({ status: 'suspended', due_at: scheduled.due_at, step: scheduled.step, attempt_count: 2 });
  await page.goto('./#/review'); await expect(page.getByText('Барлык карточкалар вакытлыча кабатлаудан алынган.', { exact: false })).toBeVisible();
  await page.getByText('Карточкалар белән идарә итәргә', { exact: false }).click(); await page.getByRole('button', { name: 'Кабатлауга кайтарырга', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Башларга', exact: true })).toBeVisible();
  expect((await records(page)).cards[0]).toMatchObject({ status: 'active', step: -1, attempt_count: 2 });
});
