import { describe, expect, it } from 'vitest';
import { projected } from '../../../tests/content-fixture';
import { validateCore, validateModule, validateReadings } from '../../generated/content-validators.js';

describe('closed content schemas', () => {
  it('rejects unknown runtime fields', () => {
    expect(validateCore({ ...(projected.core as object), injected: 'html' })).toBe(false);
  });
  it('rejects a wrong answer control and preserves sources', () => {
    const module = structuredClone(projected.modules[0]);
    if (!validateModule(module)) throw new Error('fixture');
    Object.assign(module.questions[0]!, { type: 'reading', grading: 'exact_option' });
    expect(validateModule(module)).toBe(false);
  });
  it('rejects missing word ranges before rendering', () => {
    const readings = structuredClone(projected.readings);
    if (!validateReadings(readings)) throw new Error('fixture');
    Reflect.deleteProperty(readings.readings[0]!.lines[0]!.words[0]!, 'range');
    expect(validateReadings(readings)).toBe(false);
  });
  it.each(['difficulty', 'choice key', 'empty reading key', 'duplicate ID', 'reversed source span'])('rejects invalid semantics: %s', kind => {
    const module = structuredClone(projected.modules[0]);
    if (!validateModule(module)) throw new Error('fixture');
    const choice = module.questions.find(question => question.type === 'choice')!;
    if (kind === 'difficulty') choice.difficulty = 99;
    if (kind === 'choice key') choice.accepted_answers = ['missing-option'];
    if (kind === 'empty reading key') {
      Object.assign(choice, { type: 'reading', grading: 'tt_reading', options: [], accepted_answers: ['  '] });
    }
    if (kind === 'duplicate ID') module.questions.push(structuredClone(choice));
    if (kind === 'reversed source span') choice.source_lines = [100, 1];
    expect(validateModule(module)).toBe(false);
  });
  it('rejects reversed word ranges and unknown source sections', () => {
    const readings = structuredClone(projected.readings);
    const core = structuredClone(projected.core);
    if (!validateReadings(readings) || !validateCore(core)) throw new Error('fixture');
    readings.readings[0]!.lines[0]!.words[0]!.range.reverse();
    core.lessons[0]!.source_sections.push('missing-section');
    expect(validateReadings(readings)).toBe(false);
    expect(validateCore(core)).toBe(false);
  });
});
