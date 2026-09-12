import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { canSubmit } from '../../domain/learning/grading';
import type { Session } from '../../domain/learning/types';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';
import { QuestionView } from '../practice/QuestionView';
import type { SessionEditor } from '../practice/editor';

export function AssessmentEditor({ editor, session, onResult }: { editor: SessionEditor; session: Session; onResult: (id: string) => void }) {
  const { snapshot, content, progress, runtime, confirm } = useApp(); const navigate = useNavigate();
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const [finishing, setFinishing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const index = session.question_plan.findIndex(item => item.question_id === editor.questionId);
  const plan = session.question_plan[index]!; const question = content.catalog.question(plan.question_id);
  const presentation = snapshot.presentations.find(item => item.presentation_id === editor.presentationId)!;
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const busy = state.busy || finishing;
  const drafts = new Map(snapshot.presentations.filter(item => item.session_id === session.session_id).map(item => [item.question_id, item.draft_answer]));
  drafts.set(editor.questionId, state.answer);
  useEffect(() => { root.current?.querySelector<HTMLElement>('.question-prompt')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [editor.presentationId]);
  async function move(next: number, unknown = false) {
    if (busy || readonly) return;
    if (unknown) editor.input({ kind: 'unknown' }, true);
    try {
      const destination = session.question_plan[next];
      if (destination) await editor.perform({ type: 'navigate_question', session_id: session.session_id, question_id: destination.question_id }); else await editor.flush();
    } catch { /* Ошибка и исходный черновик остаются в editor. */ }
  }
  async function finish(defer = false) {
    if (busy || readonly) return;
    setFinishing(true);
    try {
      await editor.flush();
      const missing = session.question_plan.filter(item => { const answer = drafts.get(item.question_id); return !answer || !canSubmit(content.catalog.question(item.question_id), answer); }).length;
      if ((missing > 0 || defer) && !await confirm({ title: t('assessment.finish'), body: defer ? t('diagnostic.defer_confirm') : t('assessment.unanswered_confirm', { count: missing }), action: t('assessment.finish') })) return;
      await editor.perform({ type: 'finish_assessment', session_id: session.session_id, confirm_incomplete: missing > 0 || defer, defer_imla: defer });
      onResult(session.session_id);
    } catch { /* До атомарной отправки результат не отображается. */ } finally { setFinishing(false); }
  }
  return <div ref={root} className="session-document">
    <div className="session-heading"><p>{t('exercise.question_count', { current: index + 1, total: session.question_plan.length })}</p><Button busy={busy} onClick={() => navigate('/')}>{t('session.save_exit')}</Button></div>
    {session.kind === 'diagnostic' && <p>{t(question.group === 'script' ? 'diagnostic.script' : 'diagnostic.imla')}</p>}
    <QuestionView question={question} identity={editor.presentationId} optionOrder={plan.option_order} answer={state.answer} disabled={readonly || busy} onChange={(answer, immediate) => editor.input(answer, immediate)} onEnter={() => { void move(index + 1); }} composition={active => editor.composition(active)} />
    {state.answer?.kind === 'unknown' && <p>{t('exercise.unsure')}</p>}
    {presentation.familiarity_at_show.reading_exposed_before ? <p className="meta">{t('exercise.familiar_reading')}</p> : presentation.familiarity_at_show.material_seen_before && <p className="meta">{t('exercise.familiar_material')}</p>}
    {session.assessment_help_opened_at !== null && <Status tone="warning">{t('assessment.assisted_note')}</Status>}
    {(state.status !== 'saved' || state.error) && <Status announce tone={state.status === 'unsaved' || state.error ? 'error' : 'neutral'}><p>{t(state.status === 'saving' ? 'draft.saving' : 'storage.unsaved')}</p>{(state.status === 'unsaved' || state.error) && <div className="actions"><Button onClick={() => { void runtime.retry().catch(() => {}); }}>{t('draft.retry')}</Button><Button onClick={() => { void runtime.useMemory().catch(() => {}); }}>{t('storage.use_memory')}</Button></div>}</Status>}
    <div className="actions"><Button busy={busy} disabled={readonly || index === 0} onClick={() => { void move(index - 1); }}>{t('action.back')}</Button><Button variant="primary" busy={busy} disabled={readonly || index === session.question_plan.length - 1} onClick={() => { void move(index + 1); }}>{t('action.next')}</Button><Button busy={busy} disabled={readonly} onClick={() => { void move(index + 1, true); }}>{t('exercise.unsure')}</Button></div>
    <details className="assessment-navigation"><summary>{t('assessment.questions')}</summary><nav aria-label={t('assessment.questions')}>{session.question_plan.map((item, position) => {
      const answer = drafts.get(item.question_id); const answered = answer && canSubmit(content.catalog.question(item.question_id), answer);
      return <Button key={item.question_id} busy={busy} disabled={readonly} aria-current={position === index ? 'step' : undefined} aria-label={`${t('accessibility.question_progress', { current: position + 1, total: session.question_plan.length })} ${t(answered ? 'assessment.answered' : 'assessment.unanswered')}`} onClick={() => { void move(position); }}>{position + 1}{answered ? ' ✓' : ''}</Button>;
    })}</nav></details>
    <div className="actions"><Button busy={busy} disabled={readonly} onClick={() => { void finish(); }}>{t('assessment.finish')}</Button>{session.kind === 'diagnostic' && index >= 7 && <Button busy={busy} disabled={readonly} onClick={() => { void finish(true); }}>{t('diagnostic.defer_imla')}</Button>}</div>
  </div>;
}
