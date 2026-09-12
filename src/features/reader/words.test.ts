import { describe, expect, it } from 'vitest';
import data from '../../../public/runtime/readings.json';
import { findPanelWord, wordSegments } from './words';
import type { ReadingData } from '../../domain/content/types';

describe('reader word addresses and original text', () => {
  const readings = (data as unknown as ReadingData).readings;
  const reading = readings.find(item => item.id === 'READ-03')!;
  it('preserves every source character and the exact linked occurrence', () => {
    for (const text of readings) for (const line of text.lines) expect(wordSegments(line).map(part => part.text).join('')).toBe(line.display_form);
    expect(findPanelWord(reading, '?panel=word&word=READ-03-L01%3A0')?.word.lexicon_id).toBe('lex-55-044');
  });
  it('rejects duplicate and foreign addresses', () => {
    for (const query of ['?panel=word&word=READ-01-L01:0', '?panel=word&word=READ-03-L01:0&word=READ-03-L01:1', '?panel=source&word=READ-03-L01:0', '?panel=word&panel=word&word=READ-03-L01:0']) expect(findPanelWord(reading, query)).toBeNull();
  });
});
