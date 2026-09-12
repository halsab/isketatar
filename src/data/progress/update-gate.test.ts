import 'fake-indexeddb/auto';
import { afterEach, expect, it } from 'vitest';
import { catalog } from '../../../tests/learning-fixture';
import { ProgressRepository, expectedFrom } from './repository';
import { replacementToken } from './transfer';
const target='1.0.1-0123456789abcdef';const opened:ProgressRepository[]=[];
async function open(name:string=crypto.randomUUID(),tabId:string=crypto.randomUUID(),releaseId='old-release'){const repository=await ProgressRepository.open({catalog,releaseId,name,tabId});opened.push(repository);return repository;}
afterEach(()=>{for(const repository of opened.splice(0))repository.close();});
it('quiesces new work while allowing already admitted observation, draft flush and owner pause',async()=>{
  const repo=await open();await repo.dispatch({type:'start',kind:'lesson_cycle',lesson_id:'V04'},expectedFrom(await repo.snapshot()));
  const started=await repo.snapshot();const session=started.sessions[0]!;const id=session.active_presentation_id!;
  await repo.dispatch({type:'show',presentation_id:id},expectedFrom(started));const before=await repo.snapshot();
  const gate=await repo.beginUpdate(replacementToken(before),target);
  await expect(repo.dispatch({type:'start',kind:'diagnostic'},expectedFrom(await repo.snapshot()))).rejects.toThrow('update_in_progress');
  await expect(repo.dispatch({type:'observe',target:{kind:'lesson',id:'V04'},confirm_assessment_help:false},expectedFrom(await repo.snapshot()))).rejects.toThrow('update_in_progress');
  await repo.dispatch({type:'observe',target:{kind:'lesson',id:'V04'},confirm_assessment_help:false},expectedFrom(before));
  await repo.dispatch({type:'draft',presentation_id:id,answer:{kind:'text',text:'китап'}},expectedFrom(await repo.snapshot()));
  await expect(repo.commitUpdate(replacementToken(await repo.snapshot()),gate.update_id)).rejects.toThrow('update_not_quiet');
  await repo.dispatch({type:'pause',session_id:session.session_id},expectedFrom(await repo.snapshot()));
  await repo.commitUpdate(replacementToken(await repo.snapshot()),gate.update_id);
  await expect(repo.dispatch({type:'observe',target:{kind:'lesson',id:'V04'},confirm_assessment_help:false},expectedFrom(before))).rejects.toThrow('update_in_progress');
  expect((await repo.snapshot()).presentations.find(item=>item.presentation_id===id)?.draft_answer).toEqual({kind:'text',text:'китап'});
  expect(JSON.parse(await(await repo.exportProgress()).text()).data).not.toHaveProperty('update_gate');
});
it('only the owner begins or cancels; a committed gate requires the target reader to finish',async()=>{
  const repo=await open();const other=await open(repo.options.name!);const token=replacementToken(await repo.snapshot());
  await expect(other.beginUpdate(token,target)).rejects.toThrow('write_conflict');
  const gate=await repo.beginUpdate(token,target);
  await expect(repo.reset(replacementToken(await repo.snapshot()),true)).rejects.toThrow('update_in_progress');
  await expect(repo.takeover(token.data_generation,token.writer_epoch)).rejects.toThrow('update_in_progress');
  await expect(other.cancelUpdate(replacementToken(await other.snapshot()),gate.update_id)).rejects.toThrow('write_conflict');
  await repo.commitUpdate(replacementToken(await repo.snapshot()),gate.update_id);
  await expect(repo.cancelUpdate(replacementToken(await repo.snapshot()),gate.update_id)).rejects.toThrow('update_already_committed');
  await expect(repo.finishUpdate(replacementToken(await repo.snapshot()),gate.update_id)).rejects.toThrow('unsupported_release');
  const next=await open(repo.options.name!,repo.tabId,target);await next.finishUpdate(replacementToken(await next.snapshot()),gate.update_id);
  expect((await next.snapshot()).control.update_gate).toBeNull();
});
it('recovery changes the coordinator epoch without cancelling the operation and fences old callbacks',async()=>{
  const repo=await open();const gate=await repo.beginUpdate(replacementToken(await repo.snapshot()),target);const stale=replacementToken(await repo.snapshot());
  const other=await open(repo.options.name!);
  await expect(other.recoverUpdate(stale,gate.update_id,false)).rejects.toThrow('confirmation_required');
  await other.recoverUpdate(stale,gate.update_id,true);const recovered=await other.snapshot();
  expect(recovered.control.update_gate).toMatchObject({update_id:gate.update_id,coordinator_id:other.tabId,phase:'quiescing'});expect(recovered.control.writer_epoch).toBe(stale.writer_epoch+1);
  await expect(repo.cancelUpdate(stale,gate.update_id)).rejects.toThrow('write_conflict');
  await other.cancelUpdate(replacementToken(recovered),gate.update_id);expect((await other.snapshot()).control.update_gate).toBeNull();
});
