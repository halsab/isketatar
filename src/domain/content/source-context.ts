import type { ContentCatalog } from './catalog';
import type { SourceSpan } from './types';
import { readingAvailable, releasedExample, releasedVocabulary, type ReleaseFacts } from '../learning/exposure';
import type { Session } from '../learning/types';

export interface SourceContext {
  rows: { id: string; source_form: string; source_lines: SourceSpan }[];
  target: { kind: 'example' | 'dictionary_entry'; id: string } | { kind: 'reading'; id: string; line_ids: string[] };
}
export function sourceContext(catalog: ContentCatalog, sourceId: string, id: string, facts: ReleaseFacts & { sessions: readonly Session[] }): SourceContext | null {
  const section = catalog.core.source_sections.find(section => section.id === sourceId);
  if (!section) return null;
  const owns = (span: SourceSpan) => span[0] >= section.line_start && span[1] <= section.line_end;
  const entry = catalog.lexicon.get(id);
  if (entry) return owns([entry.source.line, entry.source.line]) ? { rows: [{ id, source_form: entry.source_form, source_lines: [entry.source.line, entry.source.line] }], target: { kind: 'dictionary_entry', id } } : null;
  const vocabulary = catalog.vocabulary.get(id);
  if (vocabulary && !releasedVocabulary(vocabulary, facts)) return null;
  const example = catalog.examples.get(vocabulary?.source_example_id ?? id);
  if (example) return releasedExample(example, catalog, facts) && owns(example.source_lines) ? { rows: [{ id: example.id, source_form: example.source_form, source_lines: example.source_lines }], target: { kind: 'example', id: example.id } } : null;
  const question = catalog.questions.get(id);
  const reading = question?.origin === 'reading' ? catalog.readings.get(question.source_reading_id!) : [...catalog.readings.values()].find(reading => reading.lines.some(line => line.id === id));
  if (!reading || !readingAvailable(reading, facts.sessions)) return null;
  const lines = reading.lines.filter(line => (question ? question.line_ids.includes(line.id) : line.id === id) && owns(line.source_lines));
  return lines.length ? { rows: lines.map(line => ({ id: line.id, source_form: line.source_form, source_lines: line.source_lines })), target: { kind: 'reading', id: reading.id, line_ids: lines.map(line => line.id) } } : null;
}
