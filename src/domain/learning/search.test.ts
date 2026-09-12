import { describe, expect, it } from 'vitest';
import searchCases from '../../../content/lexicon/search-cases.json';
import { catalog, now } from '../../../tests/learning-fixture';
import { DictionaryIndex, tatarCompare } from './search';
import { preparedReviewQuestions, recordExposure } from './exposure';

describe('dictionary search and eligibility', () => {
  const index = new DictionaryIndex([...catalog.lexicon.values()], []);
  for (const fixture of searchCases.cases.filter(item => item.id.startsWith('search-'))) {
    it(fixture.id + ' ' + fixture.query, () => {
      const results = index.search(fixture.query!).map(result => result.id);
      expect(results).toEqual(expect.arrayContaining(fixture.expected_ids ?? []));
      for (const id of fixture.excluded_ids ?? []) expect(results).not.toContain(id);
    });
  }
  it('LC-27 keeps null reading, excludes archive and offers no generated question', () => {
    expect(catalog.lexicon.get('lex-56-122')!.reading_tt).toBeNull();
    expect(preparedReviewQuestions('lex-56-122', catalog, { exposures: [], attempts: [] })).toEqual([]);
    expect(preparedReviewQuestions('lex-55-001', catalog, { exposures: [], attempts: [] })).toEqual([]);
    expect(index.search('كاعد').map(result => result.id)).not.toContain('lex-55-045');
    expect(index.search('')).toEqual([]);
    expect(index.search('ـ')).toEqual([]);
  });
  it('indexes only opened course vocabulary and keeps base homographs separate', () => {
    expect(index.search('عالم').slice(0, 2).map(result => result.id).sort()).toEqual(['lex-55-046', 'lex-55-158']);
    const allowed = [...catalog.vocabulary.values()].filter(entry => entry.release === 'with_lesson' && entry.lesson_id === 'V04');
    const next = new DictionaryIndex([...catalog.lexicon.values()], allowed);
    const entry = allowed[0]!;
    expect(index.search(entry.display_form).some(result => result.id === entry.id)).toBe(false);
    expect(next.search(entry.display_form).some(result => result.id === entry.id)).toBe(true);
    const opened = recordExposure([], 'lesson', 'V04', now);
    expect(preparedReviewQuestions(entry.id, catalog, { exposures: opened, attempts: [] })).toEqual(entry.question_ids);
  });
  it('keeps near spelling explicit and never strips vowel marks in Tatar teaching profiles', () => {
    const source = catalog.lexicon.get('lex-55-025')!;
    const near = { ...source, id: 'near', display_form: 'کیتاب', forms: [], reading_tt: null, meaning_tt: '' };
    const teaching = { ...source, id: 'teaching', display_form: 'وُ', forms: [], profile: 'book_jadid_10' as const, reading_tt: null, meaning_tt: '' };
    const synthetic = new DictionaryIndex([near, teaching], []);
    expect(synthetic.search('كيتاب')).toEqual([]);
    expect(synthetic.search('كيتاب', { expanded: true })).toMatchObject([{ id: 'near', tier: 'near' }]);
    expect(synthetic.search('و')).toEqual([]);
    expect(['Б', 'Ә', 'А', 'Ө', 'О', 'Җ', 'Ж'].sort(tatarCompare)).toEqual(['А', 'Ә', 'Б', 'Ж', 'Җ', 'О', 'Ө']);
  });
});
