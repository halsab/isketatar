import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { getTestCatalog } from '../../../tests/content-fixture';
import { correctAnswer } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import { ContentCatalog } from '../../domain/content/catalog';
import { replacementToken } from './transfer';
const opened:ProgressRepository[]=[];afterEach(()=>{for(const repo of opened.splice(0))repo.close();});
function copyCatalog(){const source=getTestCatalog();const result=new ContentCatalog(structuredClone(source.core));result.addModule({lessons:structuredClone([...source.lessons.values()]),questions:structuredClone([...source.questions.values()])});result.addReadings({readings:structuredClone([...source.readings.values()]),questions:[]});result.addDictionary({entries:structuredClone([...source.lexicon.values()]),vocabulary:structuredClone([...source.vocabulary.values()])});result.references=structuredClone(source.references);return result;}
async function setup(){
  const previous=copyCatalog();const current=copyCatalog();
  const changed=structuredClone(current.question('Q-V04-01'));changed.grading_revision='b'.repeat(64);changed.accepted_answers=['яңа'];changed.prompt_tt='Яңа басма соравы';current.questions.set(changed.id,changed);
  current.core.questions=current.core.questions.map(item=>item.id===changed.id?{...item,grading_revision:changed.grading_revision}:item);
  const name=crypto.randomUUID();const tabId=crypto.randomUUID();
  const old=await ProgressRepository.open({catalog:previous,releaseId:'R1',name,tabId});opened.push(old);
  await old.dispatch({type:'start',kind:'lesson_cycle',lesson_id:'V04'},expectedFrom(await old.snapshot()));const session=(await old.snapshot()).sessions[0]!;
  await old.dispatch({type:'show',presentation_id:session.active_presentation_id!},expectedFrom(await old.snapshot()));
  await old.dispatch({type:'draft',presentation_id:session.active_presentation_id!,answer:correctAnswer('Q-V04-01')},expectedFrom(await old.snapshot()));
  await old.dispatch({type:'pause',session_id:session.session_id},expectedFrom(await old.snapshot()));
  const next=await ProgressRepository.open({catalog:current,releaseId:'R2',name,tabId,catalogs:new Map([['R1',previous],['R2',current]])});opened.push(next);return{previous,current,old,next,session};
}
it('resumes and grades a pinned old plan using its catalog while keeping current SRS unchanged',async()=>{
  const{next,session}=await setup();
  await next.dispatch({ type: 'review_add', question_id: 'Q-V04-01', origin: { kind: 'lesson', id: 'V04' } }, expectedFrom(await next.snapshot()));
  const cards = (await next.snapshot()).review_cards;
  await next.dispatch({type:'resume',session_id:session.session_id},expectedFrom(await next.snapshot()));
  const result=await next.dispatch({type:'submit',presentation_id:session.active_presentation_id!,answer:correctAnswer('Q-V04-01')},expectedFrom(await next.snapshot()));
  expect(result.attempt).toMatchObject({grade:'correct',release_id:'R1'});expect((await next.snapshot()).review_cards).toEqual(cards);
  expect((await next.snapshot()).sessions[0]!.question_plan).toEqual(session.question_plan);
});
it('regrades an imported pinned old revision against its own known catalog',async()=>{
  const{old,next,session}=await setup();const backup=await old.exportProgress();await next.reset(replacementToken(await next.snapshot()),true);
  const preview=await next.previewImport(backup);expect(preview.legacy_records).toBe(0);await next.commitImport(preview.id,true);
  await next.dispatch({type:'resume',session_id:session.session_id},expectedFrom(await next.snapshot()));
  const result=await next.dispatch({type:'submit',presentation_id:session.active_presentation_id!,answer:correctAnswer('Q-V04-01')},expectedFrom(await next.snapshot()));expect(result.attempt?.grade).toBe('correct');
});
it('leaves an unavailable old draft in history only with explicit confirmation and a fresh revision',async()=>{
  const { next, session } = await setup();
  next.options.catalogs!.delete('R1');
  const before = await next.snapshot();
  await expect(next.dispatch({ type: 'leave_historical', session_id: session.session_id, confirmed: false }, expectedFrom(before))).rejects.toThrow('confirmation_required');
  const command = { type: 'leave_historical', session_id: session.session_id, confirmed: true } as const;
  const stale = expectedFrom(before); stale.revisions.find(item => item.store === 'sessions' && item.key === session.session_id)!.revision = 0;
  await expect(next.dispatch(command, stale)).rejects.toThrow('write_conflict');
  await next.dispatch(command, expectedFrom(before));
  const after = await next.snapshot();
  expect(after.sessions[0]).toMatchObject({ status: 'incompatible', incompatibility_reason: 'release_not_continued' });
  expect(after.presentations).toEqual(before.presentations); expect(after.attempts).toEqual(before.attempts);
  expect(after.control.active_session_id).toBeNull();
  const created = await next.dispatch({ type: 'start', kind: 'lesson_cycle', lesson_id: 'V04' }, expectedFrom(after));
  expect((await next.snapshot()).sessions.find(item => item.session_id === created.session_id)?.release_id).toBe('R2');
});
it('does not silently discard a known retained draft when its catalog is only partially loaded', async () => {
  const { old, next, previous } = await setup();
  const backup = await old.exportProgress(); previous.questions.delete('Q-V04-01');
  await expect(next.previewImport(backup)).rejects.toThrow('content_unavailable');
});
it('records cross-release word help on the retained line without importing a foreign word ID', async () => {
  const previous = copyCatalog(); const current = copyCatalog(); const name = crypto.randomUUID(); const tabId = crypto.randomUUID();
  current.readings.get('READ-01')!.lines[0]!.words[0]!.word_id = 'READ-01-L01:2';
  const old = await ProgressRepository.open({ catalog: previous, releaseId: 'R1', name, tabId }); opened.push(old);
  await old.dispatch({ type: 'start', kind: 'reading_practice', reading_id: 'READ-01' }, expectedFrom(await old.snapshot()));
  const session = (await old.snapshot()).sessions[0]!;
  await old.dispatch({ type: 'pause', session_id: session.session_id }, expectedFrom(await old.snapshot()));
  const next = await ProgressRepository.open({ catalog: current, releaseId: 'R2', name, tabId, catalogs: new Map([['R1', previous], ['R2', current]]) }); opened.push(next);
  await next.dispatch({ type: 'observe', target: { kind: 'reading_word', id: 'READ-01-L01:2', reading_id: 'READ-01', line_id: 'READ-01-L01', level: 'meaning' }, confirm_assessment_help: false }, expectedFrom(await next.snapshot()));
  expect((await next.snapshot()).sessions[0]!.reading_help).toContainEqual(expect.objectContaining({ line_id: 'READ-01-L01', word_id: null, kind: 'meaning' }));
  const backup = await next.exportProgress(); const preview = await next.previewImport(backup); expect(preview.legacy_records).toBe(0);
});
