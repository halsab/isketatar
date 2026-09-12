import { expect, it } from 'vitest';
import { catalog, fixtureSession } from '../../../tests/learning-fixture';
import { recordExposure } from '../learning/exposure';
import { sourceContext } from './source-context';

const facts = { exposures: [], attempts: [], sessions: [] };
it('only resolves exact context rows owned by the selected section', () => {
  const line = catalog.readings.get('READ-03')!.lines[0]!;
  const owner = catalog.core.source_sections.find(section => section.line_start <= line.source_lines[0] && section.line_end >= line.source_lines[1])!;
  expect(sourceContext(catalog, owner.id, line.id, facts)?.rows).toEqual([{ id: line.id, source_form: line.source_form, source_lines: line.source_lines }]);
  expect(sourceContext(catalog, 'S-001', line.id, facts)).toBeNull();
  expect(sourceContext(catalog, owner.id, `${line.id}:0`, facts)).toBeNull();
  expect(sourceContext(catalog, owner.id, '../../sources/textbook.txt', facts)).toBeNull();
});
it('fences final RQ and final lines until submission', () => {
  const question = catalog.question('RQ-F01-01');
  const reading = catalog.readings.get(question.source_reading_id!)!;
  const line = reading.lines.find(line => line.id === question.line_ids[0])!;
  const section = catalog.core.source_sections.find(section => section.line_start <= line.source_lines[0] && section.line_end >= line.source_lines[1])!;
  expect(sourceContext(catalog, section.id, question.id, facts)).toBeNull();
  expect(sourceContext(catalog, section.id, line.id, facts)).toBeNull();
  const { session } = fixtureSession(catalog.core.final_ids, 'final'); session.status = 'submitted';
  expect(sourceContext(catalog, section.id, question.id, { ...facts, sessions: [session] })?.rows[0]?.id).toBe(line.id);
});
it('requires a released course entry and its exact source example', () => {
  const entry = [...catalog.vocabulary.values()].find(entry => entry.release === 'after_linked_question' && entry.source_lines[0] > 0)!;
  const example = catalog.examples.get(entry.source_example_id)!;
  const section = catalog.core.source_sections.find(section => section.line_start <= example.source_lines[0] && section.line_end >= example.source_lines[1])!;
  expect(sourceContext(catalog, section.id, entry.id, facts)).toBeNull();
  expect(sourceContext(catalog, section.id, example.id, facts)).toBeNull();
  const released = { ...facts, exposures: recordExposure([], 'question', entry.question_ids[0]!, 1, { answer: true }) };
  expect(sourceContext(catalog, section.id, entry.id, released)?.rows[0]?.id).toBe(example.id);
  expect(sourceContext(catalog, section.id, example.id, released)?.rows[0]?.source_form).toBe(example.source_form);
});
