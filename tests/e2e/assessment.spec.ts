import { test, expect } from '@playwright/test';
import data from '../../public/runtime/assessments.json' with { type: 'json' };
import readings from '../../public/runtime/readings.json' with { type: 'json' };
import core from '../../public/runtime/core.json' with { type: 'json' };

test('diagnostic drafts navigate and reload without feedback; imla can be deferred', async ({ page }) => {
  await page.goto('./#/diagnostic');
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  const script = data.questions.filter(question => question.origin === 'diagnostic' && question.group === 'script');
  for (const [index, question] of script.entries()) {
    await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', question.id);
    if (question.type === 'reading' || question.type === 'segment') await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(question.accepted_answers[0]!);
    else for (const id of question.accepted_answers) await page.locator(`input[value="${id}"]`).check();
    if (index === 0) { await page.getByRole('button', { name: 'Алга', exact: true }).click(); await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', script[1]!.id); await page.getByRole('button', { name: 'Артка', exact: true }).click(); await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', question.id); await page.reload(); await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', question.id); }
    await expect(page.locator('.feedback')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Җавапны ачарга', exact: true })).toHaveCount(0);
    if (index < script.length - 1) await page.getByRole('button', { name: 'Алга', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Әлегә хәрефләр өлеше белән тәмамларга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/diagnostic\/result\//u);
  await expect(page.getByText('Татар имлясы өлеше бәяләнмәде.', { exact: false })).toBeVisible();
  await expect(page.getByText('Гарәп язуыннан татар имлясына күчү дәресләреннән башлый аласың.', { exact: true })).toBeVisible();
  await expect(page.getByText('8 / 8 дөрес җавап', { exact: false })).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open('iske-imla-progress');
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const transaction = database.transaction(['sessions', 'presentations', 'attempts'], 'readwrite');
    const sessions = transaction.objectStore('sessions');
    const records = sessions.getAll();
    records.onsuccess = () => { for (const session of records.result) if (session.kind === 'diagnostic') { session.content_version = '0.9.0'; session.question_plan[0].grading_revision = '0'.repeat(64); sessions.put(session); } };
    for (const name of ['presentations', 'attempts']) {
      const store = transaction.objectStore(name); const items = store.getAll();
      items.onsuccess = () => { for (const item of items.result) {
        if (item.question_id.startsWith('D-') && name === 'attempts') item.content_version = '0.9.0';
        if (item.question_id === 'D-01') item.grading_revision = '0'.repeat(64);
        store.put(item);
      } };
    }
    await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); });
    database.close();
  });
  await page.reload();
  await expect(page.getByText('Татар имлясы өлеше бәяләнмәде.', { exact: false })).toBeVisible();
  await expect(page.getByText('8 / 8 дөрес җавап', { exact: false })).toBeVisible();
  await expect(page.getByText('8 / 18 дөрес җавап', { exact: true })).toHaveCount(0);
  await expect(page.locator('.result-question')).toHaveCount(8);

});

test('final combines all 16 F and four RQ with hidden feedback until commit', async ({ page }) => {
  await page.goto('./#/final');
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  const questions = [...data.questions, ...readings.questions];
  for (const [index, id] of core.final_ids.entries()) {
    const question = questions.find(question => question.id === id)!;
    await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', question.id);
    if (question.type === 'reading' || question.type === 'segment') await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(question.accepted_answers[0]!);
    else for (const answer of question.accepted_answers) await page.locator(`input[value="${answer}"]`).check();
    await expect(page.locator('.feedback')).toHaveCount(0);
    if (index < core.final_ids.length - 1) await page.getByRole('button', { name: 'Алга', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/final\/result\//u);
  await expect(page.getByText('Төп күнекмәләр мөстәкыйль күрсәтелде.', { exact: true })).toBeVisible();
  await expect(page.getByText('20 / 20 дөрес җавап', { exact: true })).toBeVisible();
  await page.goto('./#/reading/READ-F01');
  await expect(page.locator('.reading-line').first()).toBeVisible();
});

test('incomplete final needs confirmation and cancel preserves every draft', async ({ page }) => {
  await page.goto('./#/final'); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('20');
  await page.getByRole('dialog').getByRole('button', { name: 'Кире кагарга', exact: true }).click();
  await expect(page.locator('.question-prompt')).toBeVisible();
  await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/final\/result\//u);
  await expect(page.getByText('0 / 20 дөрес җавап', { exact: true })).toBeVisible();
  await expect(page.locator('a[href="#/lessons/L09"]')).toBeVisible();
});

test('incomplete diagnostic explains limited evidence instead of implying a complete assessment', async ({ page }) => {
  await page.goto('./#/diagnostic');
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Тәмамларга', exact: true }).click();
  await expect(page.getByText('Тәкъдим тулы булмаган мәгълүматка нигезләнә;', { exact: false })).toBeVisible();
  await expect(page.getByText('Татар имлясы өлешенә җаваплар бирелмәде.', { exact: true })).toBeVisible();
});
