import { test, expect, type Page } from '@playwright/test';
import data from '../../public/runtime/readings.json' with { type: 'json' };

async function records(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('iske-imla-progress');
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const names = ['sessions', 'attempts', 'exposures', 'review_cards']; const tx = db.transaction(names);
    const result = await Promise.all(names.map(name => new Promise<any[]>((resolve, reject) => { const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
    db.close(); return Object.fromEntries(names.map((name, index) => [name, result[index]!])) as Record<string, any[]>;
  });
}

test('all twenty ordinary RQ submit separately from the read-complete flag and final readings stay in final', async ({ page }) => {
  for (const reading of data.readings.filter(reading => reading.role !== 'final')) {
    await page.goto(`./#/reading/${reading.id}/questions`);
    await page.getByRole('button', { name: 'Башларга', exact: true }).click();
    for (const id of reading.question_ids) {
      await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', id);
      await page.getByRole('button', { name: 'Әлегә белмим', exact: true }).click();
      await expect(page.locator('.feedback')).toBeVisible();
      await page.getByRole('button', { name: 'Алга', exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/reading/${reading.id}/result/`, 'u'));
    await expect(page.getByText('0 / 2 дөрес җавап', { exact: false }).first()).toBeVisible();
  }
  const saved = await records(page);
  expect(saved.sessions).toHaveLength(10); expect(saved.attempts).toHaveLength(20); expect(saved.review_cards).toHaveLength(20);
  expect(saved.exposures!.filter(item => item.kind === 'reading' && item.first_completed_at !== null)).toHaveLength(0);
  await page.goto('./#/reading/READ-F01/questions');
  await expect(page.getByRole('link', { name: 'Йомгаклау тикшерүе', exact: true })).toBeVisible();
  await expect(page.locator('.question-prompt')).toHaveCount(0);
  expect((await records(page)).sessions).toHaveLength(10);
});

test('reading draft resumes after help and reload; only matching line loses independence', async ({ page }) => {
  await page.goto('./#/reading/READ-01/questions');
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill('бал');
  await page.getByRole('button', { name: 'Саклап чыгарга', exact: true }).click();
  await expect(page).toHaveURL(/#\/reading\/READ-01$/u);
  await page.goto('./#/reading/READ-01?panel=word&word=READ-01-L01%3A0');
  await page.getByRole('button', { name: 'Укылышны ачарга', exact: true }).click();
  await expect(page.getByText('бал', { exact: true }).last()).toBeVisible();
  await page.goto('./#/reading/READ-01/questions');
  await page.getByRole('button', { name: 'Сакланган эшне дәвам итәргә', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('бал');
  await page.reload(); await expect(page.getByRole('textbox', { name: 'Җавабың', exact: true })).toHaveValue('бал');
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await page.locator('input[value="b"]').check();
  await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click();
  await page.getByRole('button', { name: 'Алга', exact: true }).click();
  await expect(page).toHaveURL(/\/reading\/READ-01\/result\//u);
  const saved = await records(page);
  expect(saved.attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ question_id: 'RQ-01-01', grade: 'correct', independent_correct: false }),
    expect.objectContaining({ question_id: 'RQ-01-02', grade: 'correct', independent_correct: true }),
  ]));
  await page.locator('.result-question summary').first().click();
  await expect(page.locator('.result-question').first()).toContainText('бал');
  const resultId = saved.sessions![0].session_id;
  await page.goto(`./#/reading/READ-02/result/${resultId}`);
  await expect(page.locator('.result-question')).toHaveCount(0);
});
