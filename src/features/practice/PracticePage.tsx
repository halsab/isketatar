import { SessionContent } from '../shared/SessionContent';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { Lesson } from '../../domain/content/types';
import { POLICIES } from '../../domain/content/types';
import { lessonProgress } from '../../domain/learning/progress';
import { ArabicFontGate } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { AcceptedAnswer, AnswerSummary } from './QuestionView';
import { SessionPlayer } from './SessionPlayer';
import { HistoricalResult } from '../shared/HistoricalResult';

function Practice({ lesson }: { lesson: Lesson }) {
  const { releaseId, snapshot, command, progress, confirm } = useApp(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const unfinished = snapshot.sessions.find(session => session.kind === 'lesson_cycle' && session.lesson_id === lesson.id && ['active', 'paused'].includes(session.status));
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const compatible = !unfinished || unfinished.release_id === releaseId && unfinished.question_plan.every(item => lesson.question_ids.includes(item.question_id));
  async function start(restart = false) {
    if (restart && !await confirm({ title: t('session.restart'), body: t('session.restart_confirm'), action: t('session.restart') })) return;
    setBusy(true);
    try { await command(unfinished && !restart ? { type: 'resume', session_id: unfinished.session_id } : { type: 'start', kind: 'lesson_cycle', lesson_id: lesson.id, restart }); }
    catch { /* Команда не меняет введение до подтверждённого сохранения. */ } finally { setBusy(false); }
  }
  return <div className="session-document"><h1><MixedText text={lesson.title_tt} /></h1>
    {compatible && unfinished?.status === 'active' ? <SessionPlayer session={unfinished} onResult={id => navigate(`/lessons/${lesson.id}/result/${id}`, { replace: true })} /> : <>
      {unfinished && <Status tone={compatible ? 'neutral' : 'warning'}>{t(compatible ? 'session.existing_draft' : 'session.incompatible')}</Status>}
      <p>{t('exercise.untimed')}</p><p>{t('exercise.question_count', { current: 0, total: lesson.question_ids.length })}</p>
      {!snapshot.settings.selected_route ? <Link className="button primary" to="/start" state={{ returnTo: `/lessons/${lesson.id}/practice` }}>{t('onboarding.choose_route')}</Link> : <ArabicFontGate>
        <div className="actions">{compatible && <Button variant="primary" disabled={readonly} busy={busy} onClick={() => { void start(); }}>{t(unfinished ? 'session.resume' : 'action.start')}</Button>}{unfinished && <Button disabled={readonly} busy={busy} onClick={() => { void start(true); }}>{t('session.restart')}</Button>}</div>
      </ArabicFontGate>}
      <p><Link to={`/lessons/${lesson.id}`}>{t('lesson.theory')}</Link></p>
    </>}
  </div>;
}
function PracticePageContent() {
  const { lesson_id = '' } = useParams(); const { content } = useApp();
  if (!content.catalog.core.lessons.some(lesson => lesson.id === lesson_id)) return <Missing />;
  return <ContentState pageTitle={t('nav.lessons')} identity={lesson_id} load={() => content.lesson(lesson_id)}>{lesson => <Practice key={lesson.id} lesson={lesson} />}</ContentState>;
}
function LessonResult({ lesson, sessionId }: { lesson: Lesson; sessionId: string }) {
  const { snapshot, content, command, progress, runtime } = useApp();
  const session = snapshot.sessions.find(item => item.session_id === sessionId && item.kind === 'lesson_cycle' && item.lesson_id === lesson.id);
  if (!session) return <Missing parent={`/lessons/${lesson.id}`} />;
  if (session.status !== 'submitted') return <div className="document"><h1>{t('assessment.result')}</h1><p>{t(['active', 'paused'].includes(session.status) ? 'session.existing_draft' : 'session.incompatible')}</p><Link to={`/lessons/${lesson.id}/practice`}>{t('action.continue')}</Link></div>;
  const expected = content.catalog.lessonPlan(lesson.id);
  const current = session.question_plan.length === expected.length && session.question_plan.every((item, index) => item.question_id === expected[index]!.id && item.grading_revision === expected[index]!.grading_revision) && Object.entries(POLICIES).every(([key, version]) => Reflect.get(session.policy_versions, key) === version);
  if (!current) return <HistoricalResult session={session} backTo={`/lessons/${lesson.id}/practice`} />;
  const records = { ...snapshot, sessions: [session] };
  const score = lessonProgress(content.catalog.core, lesson.id, records);
  const route = content.catalog.core.routes[snapshot.settings.selected_route ?? 'arabic_reader'];
  const next = route[route.indexOf(lesson.id) + 1];
  return <div className="document"><h1>{t('assessment.result')} · <MixedText text={lesson.title_tt} /></h1>
    {session.content_version !== content.catalog.core.content_version && <p>{t('history.previous_version', { version: session.content_version })}</p>}
    <Disclosure identity={`result:${sessionId}`} targets={[{ kind: 'lesson', id: lesson.id }]}>
      <Status tone={score.state === 'mastered' ? 'success' : 'neutral'}>{t(`lesson.${score.state}`)}</Status>
      <p>{t('lesson.practice')}: {t('assessment.score', { correct: score.independent_practice_correct, total: score.practice_count })}</p>
      <p>{t('lesson.transfer')}: {t('assessment.score', { correct: score.independent_transfer_correct, total: score.transfer_count })}</p>
      <p>{t(score.state === 'mastered' ? 'lesson.mastered_detail' : 'lesson.practiced_detail')}</p>
      {score.needs_refresh && <Status tone="warning">{t('update.needs_refresh')}</Status>}
      <div className="actions"><Link className="button primary" to={next ? `/lessons/${next}` : '/final'}><MixedText text={next ? t('lesson.next_title', { lesson: content.catalog.core.lessons.find(item => item.id === next)!.title_tt }) : t('assessment.final')} /></Link><Link className="button" to={`/lessons/${lesson.id}/practice`}>{t('session.restart')}</Link></div>
      <h2>{t('assessment.practice_after')}</h2>
      {session.question_plan.map(plan => {
        const attempts = snapshot.attempts.filter(attempt => attempt.session_id === sessionId && attempt.question_id === plan.question_id).sort((a, b) => a.ordinal - b.ordinal);
        const first = attempts[0]; const last = attempts.at(-1); const question = content.catalog.questions.get(plan.question_id);
        if (!first || !last || !question) return null;
        return <details className="result-question" key={plan.question_id}><summary><MixedText text={question.prompt_tt} /> — {t(first.grade === 'correct' ? 'exercise.correct' : first.grade === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect')}</summary>
          <p>{t('attempt.first')}: <AnswerSummary answer={first.answer_raw} question={question} /></p>{last !== first && <p>{t('attempt.last')}: <AnswerSummary answer={last.answer_raw} question={question} /></p>}
          <p>{t('exercise.answer')}: <AcceptedAnswer question={question} /></p><p><MixedText text={question.explanation_tt} /></p>
          <Button disabled={runtime.content!.catalog.core.questions.find(item => item.id === plan.question_id)?.grading_revision !== plan.grading_revision || snapshot.control.writer_id !== progress.tabId || snapshot.review_cards.some(card => card.question_id === plan.question_id && card.status === 'active')} onClick={() => { void command({ type: 'review_add', question_id: plan.question_id, origin: { kind: 'lesson', id: lesson.id } }).catch(() => {}); }}>{t(snapshot.review_cards.some(card => card.question_id === plan.question_id && card.status === 'active') ? 'review.added' : 'review.add')}</Button>
        </details>;
      })}
    </Disclosure>
  </div>;
}
function ResultPageContent() {
  const { lesson_id = '', session_id = '' } = useParams(); const { content } = useApp();
  if (!content.catalog.core.lessons.some(lesson => lesson.id === lesson_id)) return <Missing />;
  return <ContentState pageTitle={t('nav.lessons')} identity={lesson_id} load={() => content.lesson(lesson_id)}>{lesson => <LessonResult lesson={lesson} sessionId={session_id} />}</ContentState>;
}

export function PracticePage() { return <SessionContent kind="lesson_cycle"><PracticePageContent  /></SessionContent>; }

export function ResultPage() { return <SessionContent kind="lesson_cycle"><ResultPageContent  /></SessionContent>; }
