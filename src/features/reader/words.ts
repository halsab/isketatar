import type { Reading, ReadingLine, ReadingWord } from '../../domain/content/types';

export function wordSegments(line: Pick<ReadingLine, 'display_form' | 'words'>) {
  const parts: { text: string; word?: ReadingWord }[] = []; let offset = 0;
  for (const word of line.words) {
    if (word.range[0] > offset) parts.push({ text: line.display_form.slice(offset, word.range[0]) });
    parts.push({ text: line.display_form.slice(...word.range), word }); offset = word.range[1];
  }
  if (offset < line.display_form.length) parts.push({ text: line.display_form.slice(offset) });
  return parts;
}
export function findPanelWord(reading: Pick<Reading, 'lines'>, search: string) {
  const query = new URLSearchParams(search);
  if (query.getAll('panel').length !== 1 || query.get('panel') !== 'word' || query.getAll('word').length !== 1) return null;
  for (const line of reading.lines) {
    const word = line.words.find(item => item.word_id === query.get('word'));
    if (word) return { line, word };
  }
  return null;
}
