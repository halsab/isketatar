import { canonical } from '../../domain/content/canonical';
import type { Material } from '../../domain/content/types';
import { exposeMaterials, readingAvailable, releasedVocabulary } from '../../domain/learning/exposure';
import type { Exposure } from '../../domain/learning/types';
import type { ObservationTarget } from './commands';
import type { CommandEngine } from './engine';

interface TargetData { kind: Exposure['kind'] | null; id: string; materials: Material[]; lessonId?: string; ruleId?: string; readingId?: string; lineId?: string; wordId?: string; questionId?: string; educational: boolean }
async function resolve(engine: CommandEngine, target: ObservationTarget): Promise<TargetData[]> {
  const { catalog, tx } = engine;
  const base = { id: 'id' in target ? target.id : '', materials: [] as Material[], educational: true };
  if (target.kind === 'dictionary_results') {
    if (target.ids.length > 1000 || new Set(target.ids).size !== target.ids.length) throw new Error('invalid_observation');
    const items = await Promise.all(target.ids.map(id => resolve(engine, { kind: 'dictionary_entry', id, level: 'reading' })));
    return items.flat();
  }
  if (target.kind === 'lesson') {
    if (!catalog.core.lessons.some(lesson => lesson.id === target.id)) throw new Error('unknown_lesson');
    return [{ ...base, kind: 'lesson', lessonId: target.id }];
  }
  if (target.kind === 'dictionary_entry') {
    const entry = catalog.lexicon.get(target.id) ?? catalog.vocabulary.get(target.id);
    if (!entry) throw new Error('unknown_entry');
    if ('release' in entry) {
      const exposures = await engine.exposures([`lesson:${entry.lesson_id}`]);
      const attempts = (await Promise.all(entry.question_ids.map(id => tx.byQuestion(id)))).flat();
      if (!releasedVocabulary(entry, { exposures, attempts })) throw new Error('content_locked');
    }
    return [{ ...base, kind: 'dictionary_entry', materials: entry.materials }];
  }
  if (target.kind === 'example') {
    const example = catalog.examples.get(target.id);
    if (!example) throw new Error('unknown_example');
    if (example.usage === 'assessment_source') {
      const entries = [...catalog.vocabulary.values()].filter(entry => entry.source_example_id === example.id);
      let released = false;
      for (const entry of entries) {
        const attempts = (await Promise.all(entry.question_ids.map(id => tx.byQuestion(id)))).flat();
        if (releasedVocabulary(entry, { attempts, exposures: await engine.exposures([`lesson:${entry.lesson_id}`]) })) released = true;
      }
      if (!released) throw new Error('content_locked');
    }
    return [{ ...base, kind: 'example', materials: example.materials }];
  }
  if (target.kind === 'rule') {
    const rule = catalog.rules.get(target.id);
    if (!rule) throw new Error('unknown_rule');
    return [{ ...base, kind: null, ruleId: rule.id }];
  }
  if (target.kind === 'reference') {
    if (!['letters', 'profiles', 'terms', 'rules'].includes(target.id)) throw new Error('unknown_reference');
    return [{ ...base, kind: null }];
  }
  const readingId = 'reading_id' in target ? target.reading_id : target.id;
  const reading = catalog.readings.get(readingId);
  if (!reading || !readingAvailable(reading, await tx.all('sessions'))) throw new Error('reading_unavailable');
  if (target.kind === 'reading') return [{ ...base, kind: 'reading', readingId, educational: target.level !== undefined }];
  if (!('line_id' in target)) throw new Error('invalid_observation');
  const line = reading.lines.find(line => line.id === target.line_id);
  if (!line) throw new Error('unknown_line');
  if (target.kind === 'reading_line') {
    if (target.id !== line.id) throw new Error('unknown_line');
    return [{ ...base, kind: 'reading_line', readingId, lineId: line.id, materials: line.words.flatMap(word => word.materials), educational: target.level !== undefined }];
  }
  const word = line.words.find(word => word.word_id === target.id);
  if (!word) throw new Error('unknown_word');
  return [{ ...base, kind: 'reading_word', readingId, lineId: line.id, wordId: word.word_id, materials: word.materials, educational: target.level !== undefined }];
}
export async function observe(engine: CommandEngine, target: ObservationTarget, confirmation: boolean) {
  const targets = await resolve(engine, target);
  if (targets.some(target => target.educational)) await engine.confirmDisclosure(confirmation);
  await markRelatedHelp(engine, targets, 'level' in target ? target.level ?? 'rule' : 'reading', target.kind === 'reference');
  for (const item of targets) {
    const reading = target.kind === 'dictionary_results' || 'level' in target && target.level === 'reading';
    const meaning = target.kind === 'dictionary_results' || 'level' in target && target.level === 'meaning';
    if (item.kind) await engine.exposeResource(item.kind, item.id, { reading, meaning });
    const keys = item.materials.flatMap(material => [`material:${material.visual}`, ...(material.reading === null ? [] : [`material:${material.reading}`])]);
    await engine.putExposures(exposeMaterials(await engine.exposures(keys), item.materials, engine.at, { reading, meaning }));
  }
  return {};
}

export async function markRelatedHelp(engine: CommandEngine, targets: TargetData[], level: 'letters' | 'rule' | 'reading' | 'meaning' = 'reading', broad = false) {
  const pending = await engine.tx.unfinishedSessions();
  for (const session of pending.filter(session => !['diagnostic', 'final'].includes(session.kind))) {
    const presentations = await engine.tx.bySession('presentations', session.session_id);
    let updatedSession = session;
    for (const targetData of targets.filter(item => item.educational)) {
      if (session.kind === 'reading_practice' && targetData.readingId && targetData.lineId && session.reading_ids.includes(targetData.readingId)) {
        const unfinished = presentations.some(presentation => presentation.status === 'draft' && engine.catalog.question(presentation.question_id).line_ids.includes(targetData.lineId!));
        if (unfinished) {
          const help = { line_id: targetData.lineId, word_id: targetData.wordId ?? null, kind: level, opened_at: engine.at } as const;
          if (!updatedSession.reading_help.some(item => item.line_id === help.line_id && item.word_id === help.word_id && item.kind === help.kind)) updatedSession = { ...updatedSession, reading_help: [...updatedSession.reading_help, help] };
        }
      }
      const current = presentations.find(presentation => presentation.presentation_id === session.active_presentation_id);
      if (!current || current.status !== 'draft' || current.shown_at === null) continue;
      const question = engine.catalog.question(current.question_id);
      const related = targetData.lessonId === question.lesson_id || targetData.ruleId !== undefined && question.rule_ids.includes(targetData.ruleId) || targetData.materials.some(material => question.materials.some(item => item.visual === material.visual)) || broad || targetData.questionId === question.id;
      if (related && current.assistance.reference_opened_at === null) {
        const updated = { ...current, assistance: { ...current.assistance, reference_opened_at: Math.max(engine.at, current.shown_at) }, revision: current.revision + 1 };
        await engine.context.put('presentations', updated);
        Object.assign(current, updated);
      }
    }
    if (canonical(updatedSession) !== canonical(session)) await engine.context.put('sessions', { ...updatedSession, revision: session.revision + 1, updated_at: engine.at });
  }
}
