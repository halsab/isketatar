import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import core from '../../public/runtime/core.json' with { type: 'json' };
import assessments from '../../public/runtime/assessments.json' with { type: 'json' };
import readings from '../../public/runtime/readings.json' with { type: 'json' };
import type { Question, Lesson } from '../../src/domain/content/types';

async function answer(page: Page, question: Pick<Question, 'id' | 'prompt_tt' | 'stimulus' | 'accepted_answers' | 'options'> & { type: string }) {
  await expect(page.locator('.question-prompt')).toHaveAttribute('data-question-id', question.id);
  await expect(page.locator('.question-prompt')).toHaveText(question.prompt_tt);
  await expect(page.locator('.question-stimulus')).toContainText(question.stimulus);
  if (question.type === 'reading' || question.type === 'segment') await page.getByRole('textbox', { name: 'Җавабың', exact: true }).fill(question.accepted_answers[0]!);
  else {
    await expect(page.locator('.choice input')).toHaveCount(question.options.length);
    for (const option of question.options) {
      expect(option.text_tt.trim()).not.toBe('');
      const input = page.locator(`.choice input[value="${option.id}"]`);
      await expect(input).toHaveAttribute('type', question.type === 'choice' ? 'radio' : 'checkbox');
      await expect(input).toHaveAccessibleName(option.text_tt);
      await expect(page.locator(`.choice:has(input[value="${option.id}"]) > span`)).toHaveText(option.text_tt);
    }
    for (const id of question.accepted_answers) await page.locator(`input[value="${id}"]`).check();
  }
}

test('all 494 questions and 53 lessons render, submit and retain results across both routes @full', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'The full corpus runs once; critical learning flows run in every engine.');
  test.setTimeout(600_000); page.setDefaultTimeout(10_000);
  const failures: string[] = []; page.on('pageerror', error => failures.push(error.message));
  const visited = new Set<string>();
  await page.goto('./#/start'); await page.getByRole('radio', { name: 'Гарәп хәрефләрен өйрәнәм', exact: false }).check();
  await page.getByRole('button', { name: 'Башларга', exact: true }).click();
  await expect(page).toHaveURL(/#\/lessons\/B01$/u);
  for (const module of core.modules) {
    const data = JSON.parse(readFileSync(`public/runtime/module-${module.id}.json`, 'utf8')) as { lessons: Lesson[]; questions: Question[] };
    for (const lesson of data.lessons) await test.step(lesson.id, async () => {
      await page.goto(`./#/lessons/${lesson.id}`); await expect(page.locator('h1')).toContainText(lesson.title_tt);
      await expect(page.locator('.lesson-example').first()).toBeVisible();
      await page.getByRole('link', { name: 'Күнегүләр', exact: true }).last().click();
      await page.getByRole('button', { name: 'Башларга', exact: true }).click();
      const questions = data.questions.filter(question => question.lesson_id === lesson.id).sort((a, b) => Number(a.assessment_role === 'transfer') - Number(b.assessment_role === 'transfer'));
      for (const question of questions) {
        await answer(page, question); visited.add(question.id);
        await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click(); await expect(page.locator('.feedback')).toContainText('Дөрес!');
        await page.getByRole('button', { name: 'Алга', exact: true }).click();
      }
      await expect(page).toHaveURL(new RegExp(`#/lessons/${lesson.id}/result/`, 'u'));
      const practice = questions.filter(question => question.assessment_role === 'practice').length;
      await expect(page.getByText(new RegExp(`^Күнегүләр: \\d+ / ${practice} дөрес җавап$`, 'u'))).toBeVisible();
    });
  }
  expect(visited.size).toBe(436);
  for (const reading of readings.readings.filter(item => item.role !== 'final')) await test.step(reading.id, async () => {
    await page.goto(`./#/reading/${reading.id}/questions`); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
    for (const id of reading.question_ids) {
      await answer(page, readings.questions.find(item => item.id === id)!); visited.add(id);
      await page.getByRole('button', { name: 'Тикшерергә', exact: true }).click(); await expect(page.locator('.feedback')).toContainText('Дөрес!');
      await page.getByRole('button', { name: 'Алга', exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/reading/${reading.id}/result/`, 'u'));
  });
  for (const kind of ['diagnostic', 'final'] as const) await test.step(kind, async () => {
    const ids = kind === 'final' ? core.final_ids : assessments.questions.filter(item => item.origin === 'diagnostic').map(item => item.id);
    await page.goto(`./#/${kind}`); await page.getByRole('button', { name: 'Башларга', exact: true }).click();
    for (const [index, id] of ids.entries()) {
      const question = [...assessments.questions, ...readings.questions].find(item => item.id === id)!;
      await answer(page, question); visited.add(id); await expect(page.locator('.feedback')).toHaveCount(0);
      if (index < ids.length - 1) await page.getByRole('button', { name: 'Алга', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Тәмамларга', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`#/${kind}/result/`, 'u'));
  });
  expect(visited.size).toBe(494);
  const snapshot = () => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('iske-imla-progress'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const tx = db.transaction(['attempts', 'sessions']);
    const all = (store: string) => new Promise<unknown[]>((resolve, reject) => { const request = tx.objectStore(store).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const [attempts, sessions] = await Promise.all([all('attempts'), all('sessions')]); db.close(); return { attempts, sessions };
  });
  const before = await snapshot(); expect(before.attempts).toHaveLength(494); expect(before.sessions).toHaveLength(65);
  for (const item of before.attempts!) expect(item).toMatchObject({ grade: 'correct' });
  for (const item of before.sessions!) expect(item).toMatchObject({ status: 'submitted' });
  await page.goto('./#/settings'); await page.getByRole('combobox', { name: 'Уку юлы', exact: true }).selectOption('arabic_reader');
  await expect(page.getByRole('combobox', { name: 'Уку юлы', exact: true })).toHaveValue('arabic_reader');
  await expect(page.getByRole('combobox', { name: 'Уку юлы', exact: true })).toBeEnabled();
  await page.reload(); await expect(page.getByRole('combobox', { name: 'Уку юлы', exact: true })).toHaveValue('arabic_reader');
  expect(await snapshot()).toEqual(before); expect(failures).toEqual([]);
});
