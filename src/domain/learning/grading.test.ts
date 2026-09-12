import { describe, expect, it } from 'vitest';
import cases from '../../../docs/production/learning-cases.json';
import { getTestCatalog } from '../../../tests/content-fixture';
import { canSubmit, gradeAnswer, isAnswerValue } from './grading';
import type { AnswerValue } from './types';

const catalog = getTestCatalog();
describe('prepared grading cases', () => {
  for (const fixture of cases.cases.filter(item => item.kind === 'grading')) {
    const input = fixture.input as { question_id: string; answer_raw?: AnswerValue; variants?: { answer_raw: AnswerValue }[] };
    const expected = fixture.expected as { grade?: string; answer_normalized?: unknown; variants?: { grade: string; answer_normalized: unknown }[] };
    const variants = input.variants ?? [{ answer_raw: input.answer_raw! }];
    it(fixture.id + ' ' + fixture.description, () => {
      variants.forEach((variant, index) => {
        const question = catalog.question(input.question_id);
        expect(isAnswerValue(variant.answer_raw, question)).toBe(true);
        expect(gradeAnswer(question, variant.answer_raw)).toMatchObject(expected.variants?.[index] ?? { grade: expected.grade, answer_normalized: expected.answer_normalized });
      });
    });
  }
  it('LC-10 distinguishes missing draft, explicit unknown and empty segment', () => {
    const question = catalog.question('Q-V04-07');
    expect(canSubmit(question, null)).toBe(false);
    expect(canSubmit(question, { kind: 'text', text: '   ' })).toBe(false);
    expect(gradeAnswer(question, { kind: 'unknown' })).toEqual({ grade: 'unknown', answer_normalized: null });
    expect(gradeAnswer(catalog.question('Q-A05-09'), { kind: 'segments', text: 'ал++мак' })).toEqual({ grade: 'incorrect', answer_normalized: ['ал', '', 'мак'] });
  });
  it('rejects invalid shapes, foreign options and controls without silent correction', () => {
    const q = catalog.question('Q-V04-07');
    for (const answer of [{ kind: 'text', text: 'ызан\t' }, { kind: 'text', text: 'ызан', grade: 'correct' }, { kind: 'unknown', text: '' }, { kind: 'option', option_id: 'a' }, { kind: 'text', text: 'a'.repeat(4097) }]) expect(isAnswerValue(answer, q)).toBe(false);
    for (const text of ['азан', 'ызан.', 'ызан\u2009', 'ЫЗАН\u0301']) expect(gradeAnswer(q, { kind: 'text', text }).grade).toBe('incorrect');
    expect(isAnswerValue({ kind: 'option', option_id: 'missing' }, catalog.question('Q-L07-07'))).toBe(false);
  });
  it('accepts every explicit author key across all 494 questions and four answer types', () => {
    expect(catalog.questions.size).toBe(494);
    const types = new Set<string>();
    for (const question of catalog.questions.values()) {
      types.add(question.type);
      const answers: AnswerValue[] = question.type === 'select_many' ? [{ kind: 'set', option_ids: [...question.accepted_answers].reverse() }] : question.accepted_answers.map(key => question.type === 'choice' ? { kind: 'option', option_id: key } : { kind: question.type === 'segment' ? 'segments' : 'text', text: key });
      for (const answer of answers) expect(gradeAnswer(question, answer).grade, question.id).toBe('correct');
    }
    expect([...types].sort()).toEqual(['choice', 'reading', 'segment', 'select_many']);
  });
});
