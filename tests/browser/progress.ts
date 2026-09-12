import { deleteDB } from 'idb';
import { ContentRepository } from '../../src/data/content/repository';
import { ProgressRepository, expectedFrom } from '../../src/data/progress/repository';
import type { ProgressSnapshot } from '../../src/data/progress/model';
import { replacementToken } from '../../src/data/progress/transfer';

async function run() {
  const content = await ContentRepository.open();
  await Promise.all([content.load(content.catalog.core.lessons.find(lesson => lesson.id === 'V04')!.resource), content.load('assessments.json'), content.load('readings.json')]);
  const name = `iske-imla-progress-browser-${crypto.randomUUID()}`;
  const first = await ProgressRepository.open({ catalog: content.catalog, releaseId: 'browser-test', name });
  const second = await ProgressRepository.open({ catalog: content.catalog, releaseId: 'browser-test', name });
  const staleRejected = async (operation: Promise<unknown>) => { try { await operation; return false; } catch (error) { return error instanceof Error && error.message === 'write_conflict'; } };
  try {
    await first.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(await first.snapshot()));
    const id = (await first.snapshot()).sessions[0]!.active_presentation_id!;
    await first.dispatch({ type: 'show', presentation_id: id }, expectedFrom(await first.snapshot()));
    const before = await first.snapshot();
    const command = { type: 'submit' as const, presentation_id: id, answer: { kind: 'unknown' as const } };
    await Promise.all([first.dispatch(command, expectedFrom(before)), first.dispatch(command, expectedFrom(before))]);
    const submitted = await first.snapshot();
    await first.dispatch({ type: 'start', kind: 'final' }, expectedFrom(submitted));
    const beforeHelp = await first.snapshot();
    const final = beforeHelp.sessions.find(session => session.kind === 'final')!;
    await second.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(beforeHelp));
    const finish = { type: 'finish_assessment' as const, session_id: final.session_id, confirm_incomplete: true, defer_imla: false };
    const staleHelp = await staleRejected(first.dispatch(finish, expectedFrom(beforeHelp)));
    await first.dispatch(finish, expectedFrom(await first.snapshot()));
    const all = await first.snapshot();
    await second.takeover(all.control.data_generation, all.control.writer_epoch);
    const staleWriter = await staleRejected(first.dispatch({ type: 'settings', patch: { theme: 'dark' } }, expectedFrom(all)));
    const unchanged = await second.snapshot();
    try {
      await second.backend.run('readwrite', async tx => {
        await tx.put('meta', { key: 'settings', value: { ...unchanged.settings, theme: 'dark' } });
        throw new DOMException('test abort', 'AbortError');
      });
    } catch { /* Проверяется сохранность исходного снимка после abort. */ }
    const after = await second.snapshot();
    await Promise.all([...content.catalog.core.modules.map(module => content.load(content.catalog.core.lessons.find(lesson => lesson.module_id === module.id)!.resource)), content.load('dictionary.json'), content.load('references.json')]);
    const exported = await second.exportProgress();
    const preview = await second.previewImport(exported);
    await second.commitImport(preview.id, true);
    const restored = await second.snapshot();
    const importRoundtrip = JSON.stringify(restored.attempts) === JSON.stringify(after.attempts) && restored.control.data_generation !== after.control.data_generation && restored.sessions.every(session => session.status !== 'active');
    const staleGeneration = await staleRejected(first.dispatch({ type: 'observe', target: { kind: 'lesson', id: 'V04' }, confirm_assessment_help: true }, expectedFrom(after)));
    const stalePreview = await second.previewImport(exported);
    await second.dispatch({ type: 'settings', patch: { theme: 'dark' } }, expectedFrom(restored));
    const previewRejected = await staleRejected(second.commitImport(stalePreview.id, true));
    const resetBefore = await second.snapshot();
    await second.reset(replacementToken(resetBefore), true);
    const resetAfter = await second.snapshot();
    const comparable = (snapshot: ProgressSnapshot) => JSON.stringify({ control: snapshot.control, settings: snapshot.settings, attempts: snapshot.attempts });
    return { duplicate: submitted.attempts.length === 1 && submitted.review_cards[0]?.attempt_count === 1,
      staleHelp, helpSaved: all.sessions.find(session => session.session_id === final.session_id)!.assessment_help_opened_at !== null,
      finalBulk: all.attempts.filter(attempt => attempt.session_id === final.session_id).length === 20 && all.review_cards.length === 1,
      staleWriter, aborted: comparable(after) === comparable(unchanged), importRoundtrip, staleGeneration, previewRejected,
      reset: resetAfter.attempts.length === 0 && resetAfter.sessions.length === 0 && resetAfter.control.data_generation !== resetBefore.control.data_generation };
  } finally { first.close(); second.close(); await deleteDB(name); }
}
run().then(result => { document.querySelector('#result')!.textContent = JSON.stringify(result); }, error => { document.querySelector('#result')!.textContent = `failed: ${error instanceof Error ? error.message : 'unknown'}`; });
