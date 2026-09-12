import { useRef, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { POLICIES } from '../../domain/content/types';
import { courseProgress, scoreDiagnostic, scoreFinal } from '../../domain/learning/progress';
import type { Session } from '../../domain/learning/types';
import { ArabicFontGate } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { AcceptedAnswer, AnswerSummary } from '../practice/QuestionView';
import { SessionPlayer } from '../practice/SessionPlayer';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { HistoricalResult } from '../shared/HistoricalResult';
import { SessionHistory } from '../shared/SessionHistory';
import { AssessmentEditor } from './AssessmentEditor';

type Kind = 'diagnostic' | 'final';
const titleKey = (kind: Kind) => kind === 'diagnostic' ? 'diagnostic.title' : 'assessment.final';
function Assessment({ kind }: { kind: Kind }) {
  const { runtime, content, snapshot, progress, command, confirm } = useApp(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const ids = kind === 'diagnostic' ? content.catalog.core.diagnostic_ids : content.catalog.core.final_ids;
  const unfinished = snapshot.sessions.find(session => session.kind === kind && ['active', 'paused'].includes(session.status));
  const compatible = !unfinished || unfinished.release_id === runtime.releaseId && Object.entries(POLICIES).every(([key, value]) => Reflect.get(unfinished.policy_versions, key) === value) && unfinished.question_plan.length === ids.length && unfinished.question_plan.every((item, index) => item.question_id === ids[index] && item.grading_revision === content.catalog.question(item.question_id).grading_revision);
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const completed = kind === 'final' ? courseProgress(content.catalog.core, snapshot.settings.selected_route ?? 'arabic_reader', snapshot).route : null;
  const result = (id: string) => navigate(`/${kind}/result/${id}`, { replace: true });
  async function start(restart = false) {
    if (restart && !await confirm({ title: t('session.restart'), body: t('session.restart_confirm'), action: t('session.restart') })) return;
    setBusy(true);
    try { await command(unfinished && !restart ? { type: 'resume', session_id: unfinished.session_id } : { type: 'start', kind, restart }); }
    catch { /* Начало показывается только после успешной записи. */ } finally { setBusy(false); }
  }
  return <div className="session-document"><h1>{t(titleKey(kind))}</h1>
    {compatible && unfinished?.status === 'active' ? <SessionPlayer session={unfinished} onResult={result} renderEditor={editor => <AssessmentEditor editor={editor} session={unfinished} onResult={result} />} /> : <>
      <p className="study-text">{t(kind === 'diagnostic' ? 'diagnostic.intro' : 'assessment.intro')}</p><p>{t(kind === 'diagnostic' ? 'diagnostic.parts' : 'assessment.parts')}</p><p>{t('exercise.untimed')}</p>
      {completed && completed.practiced_count < completed.required_lesson_ids.length && <p>{t('assessment.prepare_first')} <Link to="/lessons">{t('course.all_lessons')}</Link></p>}
      {unfinished && <Status tone={compatible ? 'neutral' : 'warning'}>{t(compatible ? 'session.existing_draft' : 'session.incompatible')}</Status>}
      <ArabicFontGate><div className="actions">{compatible && <Button variant="primary" disabled={readonly} busy={busy} onClick={() => { void start(); }}>{t(unfinished ? 'session.resume' : 'action.start')}</Button>}{unfinished && <Button disabled={readonly} busy={busy} onClick={() => { void start(true); }}>{t('session.restart')}</Button>}</div></ArabicFontGate>
      <SessionHistory sessions={snapshot.sessions.filter(session => session.kind === kind)} resultPath={`/${kind}/result`} />
      <p><Link to="/start">{t('onboarding.choose_route')}</Link></p><p><Link to="/lessons">{t('course.all_lessons')}</Link></p>
    </>}
  </div>;
}
function AssessmentReview({ session }: { session: Session }) {
  const { snapshot, content } = useApp(); const [open, setOpen] = useState<Set<string>>(() => new Set());
  return <section><h2>{t('assessment.practice_after')}</h2>{session.question_plan.map((item, index) => {
    const question = content.catalog.question(item.question_id); const attempt = snapshot.attempts.find(attempt => attempt.presentation_id === item.first_presentation_id);
    if (!attempt || session.diagnostic_imla_deferred && question.group === 'imla') return null;
    return <details className="result-question" key={item.question_id} onToggle={event => { const expanded = event.currentTarget.open; setOpen(previous => { const next = new Set(previous); if (expanded) next.add(item.question_id); else next.delete(item.question_id); return next; }); }}>
      <summary>{index + 1} · {t(attempt.grade === 'correct' ? 'exercise.correct' : attempt.grade === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect')}</summary>
      {open.has(item.question_id) && <ArabicFontGate><Disclosure identity={`feedback:${attempt.presentation_id}`} targets={[]} feedbackIds={[attempt.presentation_id]}>
        <p><MixedText text={question.prompt_tt} /></p><div className="question-stimulus"><MixedText text={question.stimulus} />{question.visible_context.map(context => <p key={context.id}><MixedText text={context.display_form} /></p>)}</div>
        <p>{t('exercise.answer_placeholder')}: <AnswerSummary answer={attempt.answer_raw} question={question} /></p><p>{t('exercise.answer')}: <AcceptedAnswer question={question} /></p><p><MixedText text={question.explanation_tt} /></p>
      </Disclosure></ArabicFontGate>}
    </details>;
  })}</section>;
}
function Result({ kind, sessionId }: { kind: Kind; sessionId: string }) {
  const { snapshot, content, command, progress } = useApp(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const session = snapshot.sessions.find(item => item.kind === kind && item.session_id === sessionId);
  if (!session) return <Missing parent={`/${kind}`} />;
  if (session.status !== 'submitted') return <div className="document"><h1>{t('assessment.result')}</h1><p>{t(['active', 'paused'].includes(session.status) ? 'session.existing_draft' : 'session.incompatible')}</p><Link to={`/${kind}`}>{t('action.continue')}</Link></div>;
  const ids = kind === 'diagnostic' ? content.catalog.core.diagnostic_ids : content.catalog.core.final_ids;
  const current = session.question_plan.length === ids.length && session.question_plan.every((item, index) => item.question_id === ids[index] && item.grading_revision === content.catalog.question(item.question_id).grading_revision) && Object.entries(POLICIES).every(([key, value]) => Reflect.get(session.policy_versions, key) === value);
  if (!current) return <HistoricalResult session={session} backTo={`/${kind}`} />;
  const final = kind === 'final' ? scoreFinal(content.catalog.core, session, snapshot.attempts) : null;
  const diagnostic = kind === 'diagnostic' ? scoreDiagnostic(content.catalog, session, snapshot.attempts) : null;
  const first = new Map(snapshot.attempts.filter(attempt => attempt.session_id === sessionId && attempt.ordinal === 1).map(attempt => [attempt.question_id, attempt]));
  const incompleteScript = diagnostic && ids.some(id => content.catalog.question(id).group === 'script' && first.get(id)?.answer_raw.kind === 'unknown');
  const missedLessons = new Set(final ? ids.filter(id => !first.get(id)?.independent_correct).flatMap(id => content.catalog.question(id).recommend_lessons) : diagnostic?.recommend_lessons);
  const recommendations = content.catalog.core.lessons.filter(lesson => missedLessons.has(lesson.id));
  async function chooseRecommended() {
    if (!diagnostic) return; setBusy(true);
    try { await command({ type: 'settings', patch: { selected_route: diagnostic.recommended_route, onboarding_completed: true } }); if (mounted.current) navigate(`/lessons/${content.catalog.core.routes[diagnostic.recommended_route][0]}`); }
    catch { /* Прогресс уроков не меняется при выборе рекомендации. */ } finally { setBusy(false); }
  }
  return <div className="document"><h1>{t(kind === 'diagnostic' ? 'diagnostic.result' : 'assessment.result')}</h1>
    {session.content_version !== content.catalog.core.content_version && <p>{t('history.previous_version', { version: session.content_version })}</p>}
    {session.assessment_help_opened_at !== null && <Status tone="warning">{t('assessment.assisted_note')}</Status>}
    {final && <><Status tone={final.passed ? 'success' : 'neutral'}>{t(final.passed ? 'assessment.passed' : 'assessment.review_needed')}</Status><p>{t('assessment.score', { correct: final.correct, total: final.total })}</p><p>{t('assessment.independent_count', { correct: final.independent_correct, total: final.total })}</p><ul>{([[t('assessment.vowels'), final.vowels_correct], [t('assessment.morphology'), final.morphology_correct], [t('assessment.reading_group'), final.reading_correct]] as const).map(([title, correct]) => <li key={title}>{title}: {t('assessment.group_score', { correct, total: 4, required: 3 })}</li>)}</ul><p>{t('assessment.total_threshold')}</p><div className="actions"><Link to="/reading/READ-F01">{t('assessment.first_text')}</Link><Link to="/reading/READ-F02">{t('assessment.second_text')}</Link></div></>}
    {diagnostic && <>{incompleteScript && <Status tone="warning">{t('diagnostic.incomplete')}</Status>}<p className="study-text">{t(diagnostic.recommended_route === 'arabic_reader' ? 'diagnostic.bridge' : 'diagnostic.foundation')}</p><p>{t('diagnostic.script')}: {t('assessment.score', { correct: diagnostic.script_correct, total: diagnostic.script_total })}</p><p>{t('diagnostic.keep_learning')}</p>{session.diagnostic_imla_deferred ? <Status>{t('diagnostic.imla_deferred')}</Status> : diagnostic.imla_score ? <p>{t('diagnostic.imla')}: {t('assessment.score', diagnostic.imla_score)}</p> : <p>{t('diagnostic.imla_unanswered')}</p>}

      <div className="actions"><Button variant="primary" busy={busy} disabled={snapshot.control.writer_id !== progress.tabId} onClick={() => { void chooseRecommended(); }}>{t('diagnostic.choose_recommended')}</Button><Link to="/start">{t('onboarding.change_route')}</Link></div>
    </>}
    {!!recommendations.length && <><h2>{t('assessment.recommendations')}</h2><ul>{recommendations.map(lesson => <li key={lesson.id}><Link to={`/lessons/${lesson.id}`}><MixedText text={lesson.title_tt} /></Link></li>)}</ul></>}
    <AssessmentReview session={session} /><div className="actions"><Link className="button" to={`/${kind}`}>{t('assessment.new_attempt')}</Link><Link to="/lessons">{t('course.all_lessons')}</Link></div>
  </div>;
}
export function AssessmentPage({ kind }: { kind: Kind }) {
  const { content } = useApp(); const ids = kind === 'diagnostic' ? content.catalog.core.diagnostic_ids : content.catalog.core.final_ids;
  return <ContentState identity={kind} load={() => content.questions(ids)}>{() => <Assessment key={kind} kind={kind} />}</ContentState>;
}
export function AssessmentResultPage({ kind }: { kind: Kind }) {
  const { session_id = '' } = useParams(); const { content } = useApp(); const ids = kind === 'diagnostic' ? content.catalog.core.diagnostic_ids : content.catalog.core.final_ids;
  return <ContentState identity={kind} load={() => content.questions(ids)}>{() => <Result key={`${kind}:${session_id}`} kind={kind} sessionId={session_id} />}</ContentState>;
}
