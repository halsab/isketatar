import { canonical } from '../../domain/content/canonical';
import { preparedReviewQuestions, readingAvailable, releasedVocabulary } from '../../domain/learning/exposure';
import type { Command } from './commands';
import type { CommandEngine } from './engine';
import type { Settings } from './model';

async function validTarget(engine: CommandEngine, kind: string, id: string) {
  const { catalog, tx } = engine;
  if (kind === 'lesson') return catalog.core.lessons.some(lesson => lesson.id === id);
  if (kind === 'reading') {
    const reading = catalog.readings.get(id);
    return reading !== undefined && readingAvailable(reading, await tx.all('sessions'));
  }
  if (kind === 'rule') return catalog.rules.has(id);
  if (kind === 'reference') return ['letters', 'profiles', 'rules', 'terms'].includes(id) || catalog.rules.has(id) || catalog.references?.letters.some(letter => letter.id === id) === true || catalog.references?.profiles.some(profile => profile.id === id) === true;
  if (kind === 'dictionary') {
    if (catalog.lexicon.has(id)) return true;
    const entry = catalog.vocabulary.get(id);
    if (!entry) return false;
    const attempts = (await Promise.all(entry.question_ids.map(id => tx.byQuestion(id)))).flat();
    return releasedVocabulary(entry, { attempts, exposures: await engine.exposures([`lesson:${entry.lesson_id}`]) });
  }
  return false;
}
export async function settingsCommand(engine: CommandEngine, command: Extract<Command, { type: 'settings' }>) {
  const record = await engine.tx.get('meta', 'settings');
  if (!record || record.key !== 'settings') throw new Error('storage_corrupt');
  const allowed = ['selected_route', 'onboarding_completed', 'theme', 'arabic_size_px', 'text_size_px', 'reduced_motion', 'review_batch_size', 'last_location'];
  if (Object.keys(command.patch).some(key => !allowed.includes(key))) throw new Error('invalid_settings');
  const next: Settings = { ...record.value, ...command.patch };
  if (![null, 'arabic_reader', 'new_to_script'].includes(next.selected_route) || typeof next.onboarding_completed !== 'boolean' || !['system', 'light', 'dark'].includes(next.theme) || ![28, 32, 40, 48].includes(next.arabic_size_px) || ![18, 20, 22, 24].includes(next.text_size_px) || !['system', 'reduce'].includes(next.reduced_motion) || !Number.isInteger(next.review_batch_size) || next.review_batch_size < 1 || next.review_batch_size > 10) throw new Error('invalid_settings');
  if (next.last_location !== null && (Object.keys(next.last_location).sort().join(',') !== 'id,kind' || !await validTarget(engine, next.last_location.kind, next.last_location.id))) throw new Error('invalid_settings');
  if (canonical(next) !== canonical(record.value)) await engine.context.put('meta', { key: 'settings', value: { ...next, revision: next.revision + 1, updated_at: engine.at } });
  return {};
}
export async function bookmarkCommand(engine: CommandEngine, command: Extract<Command, { type: 'bookmark' }>) {
  const key = `${command.kind}:${command.target_id}`;
  if (command.remove) { await engine.context.delete('bookmarks', key); return {}; }
  if (!await validTarget(engine, command.kind, command.target_id)) throw new Error('unknown_bookmark_target');
  if (command.position) {
    if (command.kind !== 'reading') throw new Error('invalid_bookmark_position');
    const line = engine.catalog.readings.get(command.target_id)?.lines.find(line => line.id === command.position!.line_id);
    if (!line || line.content_revision !== command.position.line_revision || command.position.word_ordinal !== null && (!Number.isInteger(command.position.word_ordinal) || !line.words[command.position.word_ordinal])) throw new Error('invalid_bookmark_position');
  }
  const previous = await engine.tx.get('bookmarks', key);
  await engine.context.put('bookmarks', { bookmark_key: key, kind: command.kind, target_id: command.target_id, created_at: previous?.created_at ?? engine.at, updated_at: engine.at, position: command.position });
  return {};
}
export async function positionCommand(engine: CommandEngine, command: Extract<Command, { type: 'position' }>) {
  const position = command.position;
  if (!await validTarget(engine, position.kind, position.target_id) || !Number.isFinite(position.within_block_ratio) || position.within_block_ratio < 0 || position.within_block_ratio > 1 || !/^[a-f0-9]{64}$/u.test(position.content_revision)) throw new Error('invalid_position');
  const lesson = engine.catalog.lessons.get(position.target_id);
  const reading = engine.catalog.readings.get(position.target_id);
  const anchors = position.kind === 'lesson' && lesson ? [`${lesson.id}:theory`, ...lesson.rules.map(rule => rule.id), ...lesson.examples.map(example => example.id)] : position.kind === 'reading' && reading ? reading.lines.map(line => line.id) : ['letters', 'profiles', 'rules', 'terms', ...(engine.catalog.references?.letters.map(letter => letter.id) ?? []), ...(engine.catalog.references?.profiles.map(profile => profile.id) ?? []), ...engine.catalog.rules.keys()];
  if (position.anchor_id !== null && !anchors.includes(position.anchor_id)) throw new Error('invalid_position');
  if (lesson && position.content_revision !== lesson.content_revision || reading && position.content_revision !== reading.content_revision) throw new Error('invalid_position');
  await engine.context.put('meta', { key: `position:${position.kind}:${position.target_id}`, value: { ...position, updated_at: engine.at } });
  return {};
}
export async function validateReviewOrigin(engine: CommandEngine, command: Extract<Command, { type: 'review_add' }>) {
  const question = engine.catalog.question(command.question_id);
  const origin = command.origin;
  if (origin.kind === 'manual' && origin.id === question.id || origin.kind === 'lesson' && origin.id === question.lesson_id || origin.kind === 'reading' && origin.id === question.source_reading_id) return;
  if (origin.kind === 'dictionary') {
    const entries = [...engine.catalog.vocabulary.values()].filter(entry => entry.id === origin.id || entry.source_dictionary_ids.includes(origin.id));
    const questionIds = [...new Set(entries.flatMap(entry => entry.question_ids))];
    const attempts = (await Promise.all(questionIds.map(id => engine.tx.byQuestion(id)))).flat();
    const exposures = await engine.exposures(entries.map(entry => `lesson:${entry.lesson_id}`));
    if (preparedReviewQuestions(origin.id, engine.catalog, { attempts, exposures }).includes(question.id)) return;
  }
  throw new Error('invalid_review_origin');
}
export async function markReadingComplete(engine: CommandEngine, id: string) {
  if (!await validTarget(engine, 'reading', id)) throw new Error('reading_unavailable');
  await engine.exposeResource('reading', id, { completed: true });
  return {};
}
