import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { Session } from '../../domain/learning/types';
import { hasAssistance, pendingAssessments } from '../../domain/learning/attempt';
import { canSubmit } from '../../domain/learning/grading';
import { ArabicFontGate, useArabicFont } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { SessionEditor } from './editor';
import { AcceptedAnswer, AnswerSummary, QuestionView } from './QuestionView';

function EditorView({ editor, session, onResult }: { editor: SessionEditor; session: Session; onResult: (id: string) => void }) {
  const { snapshot, content, progress, runtime, confirm } = useApp();
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const presentation = snapshot.presentations.find(item => item.presentation_id === editor.presentationId)!;
  const question = content.catalog.question(presentation.question_id);
  const attempt = snapshot.attempts.find(item => item.presentation_id === editor.presentationId);
  const plan = session.question_plan.find(item => item.question_id === question.id)!;
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const [validation, setValidation] = useState<string | undefined>();
  const navigate = useNavigate(); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { root.current?.querySelector<HTMLElement>('.question-prompt')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [editor.presentationId]);
  useEffect(() => { if (attempt) root.current?.querySelector<HTMLElement>('.feedback-title')?.focus(); }, [attempt?.presentation_id]);
  async function submit(unknown = false) {
    const answer = unknown ? { kind: 'unknown' as const } : state.answer;
    if (!answer || !canSubmit(question, answer)) { setValidation(t('exercise.no_answer')); return; }
    setValidation(undefined);
    try { await editor.perform({ type: 'submit', presentation_id: editor.presentationId, answer }); } catch { /* Черновик и ошибка остаются в editor. */ }
  }
  async function help(kind: 'hint' | 'rule' | 'reveal') {
    const pending = pendingAssessments(snapshot.sessions).filter(item => item.assessment_help_opened_at === null);
    const confirmed = pending.length ? await confirm({ title: t('assessment.pending_help_title'), body: t('assessment.pending_help_body', { count: pending.length }), action: t('assessment.open_learning_material') }) : false;
    if (pending.length && !confirmed) return;
    try { await editor.perform({ type: 'help', presentation_id: editor.presentationId, kind, hint_index: kind === 'hint' ? presentation.assistance.hint_indices.length : undefined, confirm_assessment_help: confirmed }); } catch { /* Помощь не раскрывается до commit. */ }
  }
  async function advance(retry: boolean) {
    try {
      const receipt = await editor.perform({ type: retry ? 'retry' : 'ack', presentation_id: editor.presentationId });
      if (!receipt.presentation_id) onResult(session.session_id);
    } catch { /* Сохраняется прежний вопрос и доступная причина ошибки. */ }
  }
  return <div ref={root} className="session-document">
    <div className="session-heading"><p>{t(question.assessment_role === 'transfer' ? 'lesson.transfer' : 'lesson.practice')} · {t('exercise.question_count', { current: session.question_plan.indexOf(plan) + 1, total: session.question_plan.length })}</p><Button onClick={() => navigate(session.lesson_id ? `/lessons/${session.lesson_id}` : '/')} busy={state.busy}>{t('session.save_exit')}</Button></div>
    {question.assessment_role === 'transfer' && <p className="muted">{t('lesson.transfer_intro')}</p>}
    <QuestionView question={question} identity={editor.presentationId} optionOrder={plan.option_order} answer={state.answer} disabled={state.busy || !!attempt || readonly} onChange={(answer, immediate) => { setValidation(undefined); editor.input(answer, immediate); }} onEnter={() => { if (!attempt) void submit(); }} composition={active => editor.composition(active)} error={validation} />
    {presentation.familiarity_at_show.reading_exposed_before ? <p className="meta">{t('exercise.familiar_reading')}</p> : presentation.familiarity_at_show.material_seen_before && <p className="meta">{t('exercise.familiar_material')}</p>}
    {(state.status !== 'saved' || state.error) && <Status tone={state.status === 'unsaved' || state.error ? 'error' : 'neutral'} announce><p>{t(state.status === 'saving' ? 'draft.saving' : 'storage.unsaved')}</p>{(state.status === 'unsaved' || state.error) && <div className="actions"><Button onClick={() => { void runtime.retry().catch(() => {}); }}>{t('draft.retry')}</Button><Button onClick={() => { void runtime.useMemory().catch(() => {}); }}>{t('storage.use_memory')}</Button></div>}</Status>}
    {!attempt && <>
      <div className="actions"><Button variant="primary" busy={state.busy} disabled={readonly} onClick={() => { void submit(); }}>{t('action.check')}</Button><Button busy={state.busy} disabled={readonly} onClick={() => { void submit(true); }}>{t('exercise.unsure')}</Button></div>
      <div className="exercise-help">{presentation.assistance.hint_indices.map(index => <p key={index}><MixedText text={question.hints_tt[index]!} /></p>)}
        {presentation.assistance.hint_indices.length < question.hints_tt.length && <Button busy={state.busy} onClick={() => { void help('hint'); }}>{t(presentation.assistance.hint_indices.length ? 'exercise.hint_next' : 'exercise.hint')}</Button>}
        {!!question.rule_ids.length && <Button busy={state.busy} onClick={() => { void help('rule'); }}>{t('lesson.rule')}</Button>}
        {presentation.assistance.rule_opened_at !== null && question.rule_ids.map(id => <p key={id}><MixedText text={content.catalog.rules.get(id)?.statement_tt ?? ''} /></p>)}
        <Button busy={state.busy} disabled={readonly} onClick={() => { void help('reveal'); }}>{t('exercise.reveal')}</Button>
      </div>
    </>}
    {attempt && <section className="feedback" aria-label={t('accessibility.answer_status')}>
      <h2 className="feedback-title" tabIndex={-1}>{t('accessibility.answer_status')}</h2>
      <Status tone={attempt.grade === 'correct' ? 'success' : 'neutral'} announce>{t(attempt.grade === 'correct' ? 'exercise.correct' : attempt.grade === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect')}</Status>
      <p>{t('exercise.answer_placeholder')}: <AnswerSummary answer={attempt.answer_raw} question={question} /></p><p><strong>{t('exercise.answer')}:</strong> <AcceptedAnswer question={question} /></p>
      <p><MixedText text={question.explanation_tt} /></p>{hasAssistance(attempt.assistance_before_submit) ? <p>{t('exercise.assisted')}</p> : attempt.independent_correct && <p>{t('exercise.independent')}</p>}
      {question.rule_ids.map(id => <p key={id}><MixedText text={content.catalog.rules.get(id)?.statement_tt ?? ''} /></p>)}
      <div className="actions"><Button variant="primary" busy={state.busy} disabled={readonly} onClick={() => { void advance(false); }}>{t('action.next')}</Button>{attempt.grade !== 'correct' && <Button busy={state.busy} disabled={readonly} onClick={() => { void advance(true); }}>{t('action.retry')}</Button>}</div>
    </section>}
  </div>;
}
function BoundEditor({ session, onResult, renderEditor }: { session: Session; onResult: (id: string) => void; renderEditor?: (editor: SessionEditor) => ReactNode }) {
  const { runtime, snapshot, progress, state } = useApp(); const [editor, setEditor] = useState<{ instance: SessionEditor; revision: number } | null>(null);
  const previous = useRef<SessionEditor | null>(null);
  useEffect(() => {
    const next = new SessionEditor(progress, snapshot, session.active_presentation_id!, () => runtime.refresh());
    const old = previous.current;
    if (old && old.generation === snapshot.control.data_generation && old.presentationId === session.active_presentation_id && old.getState().status !== 'saved') next.input(old.getState().answer);
    previous.current = next;
    setEditor({ instance: next, revision: state.editorRevision }); const unregister = runtime.registerEditor(next);
    return () => { unregister(); void next.dispose(); };
  }, [progress, session.active_presentation_id, state.editorRevision]);
  return editor && editor.revision === state.editorRevision && editor.instance.repository === progress ? renderEditor ? renderEditor(editor.instance) : <EditorView editor={editor.instance} session={session} onResult={onResult} /> : <Status>{t('boot.loading')}</Status>;
}
export function SessionPlayer({ session, onResult, renderEditor }: { session: Session; onResult: (id: string) => void; renderEditor?: (editor: SessionEditor) => ReactNode }) {
  const { snapshot, progress, command, confirm } = useApp(); const font = useArabicFont();
  const pending = ['diagnostic', 'final'].includes(session.kind) ? [] : pendingAssessments(snapshot.sessions).filter(item => item.assessment_help_opened_at === null);
  const key = `${snapshot.control.data_generation}:${session.active_presentation_id}:${pending.map(item => item.session_id).join(',')}`;
  const [shown, setShown] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (font === 'error' && snapshot.control.writer_id === progress.tabId) void command({ type: 'pause', session_id: session.session_id }).catch(() => {});
  }, [font, session.session_id]);
  useEffect(() => {
    let active = true; setError(null);
    if (font === 'ready' && !pending.length) void command({ type: 'show', presentation_id: session.active_presentation_id! }).then(() => { if (active) setShown(key); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'storage_unavailable'); });
    return () => { active = false; };
  }, [key, font]);
  if (font !== 'ready') return <ArabicFontGate>{null}</ArabicFontGate>;
  if (shown !== key) return <Status><p>{t(pending.length ? 'assessment.pending_help_title' : error ? 'storage.unsaved' : 'boot.loading')}</p>{(pending.length > 0 || error) && <Button onClick={() => { void (async () => {
    const needsConfirmation = pending.length > 0 || error === 'assessment_help_confirmation_required';
    const confirmed = needsConfirmation ? await confirm({ title: t('assessment.pending_help_title'), body: t('assessment.pending_help_body', { count: pending.length || 1 }), action: t('assessment.open_learning_material') }) : false;
    if (!needsConfirmation || confirmed) try { await command({ type: 'show', presentation_id: session.active_presentation_id!, confirm_assessment_help: confirmed }); if (!pending.length) setShown(key); } catch (reason) { setError(reason instanceof Error ? reason.message : 'storage_unavailable'); }
  })(); }}>{t(pending.length || error === 'assessment_help_confirmation_required' ? 'assessment.open_learning_material' : 'draft.retry')}</Button>}</Status>;
  return <BoundEditor key={`${snapshot.control.data_generation}:${session.active_presentation_id}`} session={session} onResult={onResult} renderEditor={renderEditor} />;
}
