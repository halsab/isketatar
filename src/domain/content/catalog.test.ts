import { describe, expect, it } from 'vitest';
import { getTestCatalog, projected } from '../../../tests/content-fixture';
import { gradingPayload } from './revision';
import { normalizeReading } from './canonical';

describe('runtime content projection', () => {
  const catalog = getTestCatalog();
  it('covers every question, lesson and route of the frozen corpus', () => {
    expect(catalog.lessons.size).toBe(53);
    expect(catalog.questions.size).toBe(494);
    expect(catalog.readings.size).toBe(12);
    expect(catalog.lexicon.size).toBe(502);
    expect(catalog.core.routes.arabic_reader).toHaveLength(46);
    expect(catalog.core.routes.new_to_script).toHaveLength(53);
    expect(catalog.core.final_ids).toHaveLength(20);
  });
  it('places all A02 practice before transfer and preserves author order', () => {
    expect(catalog.lessonPlan('A02').map(q => q.id)).toEqual(['Q-A02-01', 'Q-A02-02', 'Q-A02-03', 'Q-A02-04', 'Q-A02-05', 'Q-A02-06', 'Q-A02-09', 'Q-A02-10', 'Q-A02-11', 'Q-A02-07', 'Q-A02-08']);
  });
  it('keeps null readings, source forms, and excludes editorial annotations', () => {
    expect(catalog.lexicon.get('lex-56-122')?.reading_tt).toBeNull();
    expect(catalog.examples.get('EX-L07-05')?.reading_tt).toBeNull();
    expect(catalog.examples.get('EX-V01-04')?.display_form).toBe('ئه\u200cته\u200cچ');
    expect(catalog.lexicon.has('lex-55-045')).toBe(false);
    expect(JSON.stringify(projected)).not.toContain('normalization_note');
    expect(JSON.stringify(projected)).not.toContain('editorial_note"');
  });
  it('assigns sequential UTF-16 ranges including repeated words and null dictionary links', () => {
    for (const reading of catalog.readings.values()) for (const line of reading.lines) {
      let end = 0;
      for (const word of line.words) {
        expect(word.range[0]).toBeGreaterThanOrEqual(end);
        expect(line.display_form.slice(...word.range)).toBe(word.surface);
        expect(word.word_id).toBe(`${line.id}:${word.ordinal}`);
        end = word.range[1];
      }
    }
    expect(catalog.readings.get('READ-01')?.lines[0]?.words[0]?.lexicon_id).toBeNull();
    expect(catalog.readings.get('READ-03')?.lines[0]?.words.find(w => w.surface === 'كتاب')?.lexicon_id).toBe('lex-55-044');
  });
  it('LC-28 includes visible reading context in the grading revision', () => {
    const q = catalog.question('RQ-F01-01');
    const changed = structuredClone(q);
    changed.visible_context[0]!.display_form = 'شيكر قامشدن بولا';
    expect(gradingPayload(changed)).not.toBe(gradingPayload(q));
    expect(gradingPayload({ ...q, explanation_tt: 'Башка аңлатма' })).toBe(gradingPayload(q));
    expect(gradingPayload({ ...q, options: [...q.options].reverse() })).toBe(gradingPayload(q));
  });
  it('tracks the displayed word rather than its larger source example', () => {
    expect(catalog.question('Q-H03-01').materials[0]?.visual).toBe(catalog.question('RQ-01-01').materials[0]?.visual);
    expect(catalog.question('Q-H03-01').materials[0]?.reading).toBe(catalog.question('RQ-01-01').materials[0]?.reading);
    expect(catalog.question('Q-H03-01').materials[0]?.visual).not.toBe(catalog.examples.get('EX-H03-01')?.materials[0]?.visual);
    expect(catalog.question('Q-H03-07').materials[0]?.visual).not.toBe(catalog.examples.get('EX-H03-05')?.materials[0]?.visual);
    expect(catalog.question('Q-K02-07').materials[0]?.reading_in_prompt).toBe(false);
    expect(catalog.question('Q-B07-07').materials[0]?.reading_in_prompt).toBe(true);
  });
  it('preserves every explicit answer and generates no dictionary tests', () => {
    for (const q of catalog.questions.values()) {
      expect(q.grading_revision).toMatch(/^[a-f0-9]{64}$/u);
      expect(q.accepted_answers.length).toBeGreaterThan(0);
      if (q.grading === 'tt_reading') expect(q.accepted_answers.every(a => normalizeReading(a).length > 0)).toBe(true);
      if (q.grading === 'segments') expect(q.accepted_answers.every(a => a.split('+').every(p => normalizeReading(p).length > 0))).toBe(true);
    }
    expect([...catalog.questions.keys()].some(id => id.startsWith('lex-'))).toBe(false);
  });
});
