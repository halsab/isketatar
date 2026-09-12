import { describe, expect, it } from 'vitest';
import { loadSources, projectCorpus } from '../../../tools/content-build.mjs';
import { validateReadings, validateReferences } from '../../generated/content-validators.js';

const source = await loadSources();
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('fixture object');
  return value as Record<string, unknown>;
}
function first(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) throw new Error('fixture array');
  return object(value[0]);
}
function fixture() {
  const clone = structuredClone(source);
  return { clone, sources: object(object(clone).sources) };
}
function firstLine(sources: Record<string, unknown>) {
  return first(first(object(sources['content/readings/texts.json']).texts).lines);
}

describe('source projection boundaries', () => {
  it('ignores nested editorial fields without weakening runtime schemas', () => {
    const { clone, sources } = fixture();
    const reading = first(object(sources['content/readings/texts.json']).texts);
    const letters = object(sources['content/reference/letters.json']);
    const profiles = object(sources['content/reference/profiles.json']);
    for (const target of [object(reading.provenance), object(first(letters.letters).forms), first(letters.marks), first(letters.ligatures), object(profiles.vowel_table), first(object(profiles.vowel_table).rows)]) {
      target.editorial_extra = { text: 'not runtime content' };
    }
    const result = projectCorpus(clone);
    expect(validateReadings(result.readings)).toBe(true);
    expect(validateReferences(result.references)).toBe(true);
    expect(JSON.stringify(result)).not.toContain('editorial_extra');
  });
  it('rejects missing curriculum source references during projection', () => {
    const { clone, sources } = fixture();
    first(object(sources['content/curriculum.json']).lessons).source_sections = ['missing-section'];
    expect(() => projectCorpus(clone)).toThrow('Invalid core relationships');
  });
  it('rejects an omitted module before it can orphan lessons in the release', () => {
    const { clone, sources } = fixture();
    const curriculum = object(sources['content/curriculum.json']);
    if (!Array.isArray(curriculum.modules)) throw new Error('fixture');
    curriculum.modules.shift();
    expect(() => projectCorpus(clone)).toThrow('Invalid core relationships');
  });
  it('changes line revision when word boundaries or ordinals change', () => {
    const original = projectCorpus(source).readings;
    const { clone, sources } = fixture();
    const line = firstLine(sources);
    if (!Array.isArray(line.words)) throw new Error('fixture');
    line.words.shift();
    const changed = projectCorpus(clone).readings;
    if (!validateReadings(original) || !validateReadings(changed)) throw new Error('fixture');
    expect(changed.readings[0]!.lines[0]!.display_form).toBe(original.readings[0]!.lines[0]!.display_form);
    expect(changed.readings[0]!.lines[0]!.content_revision).not.toBe(original.readings[0]!.lines[0]!.content_revision);
  });
  it.each([['بَ', 'َ'], ['بَ', 'ب'], ['𞸀', '\uDC00']])('rejects a word splitting a grapheme: %s / %s', (display, surface) => {
    const { clone, sources } = fixture();
    const line = firstLine(sources);
    const word = first(line.words);
    line.display_form = display;
    line.words = [{ ...word, surface }];
    expect(() => projectCorpus(clone)).toThrow('Invalid word range');
  });
});
