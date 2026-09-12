import { SessionContent } from '../shared/SessionContent';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { POLICIES } from '../../domain/content/types';
import type { Session } from '../../domain/learning/types';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { formatDate } from '../../ui/date';
import { t } from '../../ui/copy';
import { SessionPlayer } from '../practice/SessionPlayer';
import { ContentState, Missing } from '../shared/ContentState';
import { HistoricalResult } from '../shared/HistoricalResult';
import { PracticeReview } from '../shared/PracticeReview';
import { SessionHistory } from '../shared/SessionHistory';

function QuestionLabel({ id }: { id: string }) {
  const { content } = useApp();
  const question = content.catalog.questions.get(id);
  if (!question) return <span>{t('update.needs_refresh')}</span>;
  const lesson = content.catalog.core.lessons.find(lesson => lesson.id === question.lesson_id);
  const reading = content.catalog.readings.get(question.source_reading_id ?? '');
  const ids = (lesson ?? reading)!.question_ids;
  return <><span>{t(`review.skill_${question.skill}`)}</span> · <Link to={lesson ? `/lessons/${lesson.id}` : `/reading/${reading!.id}`}><MixedText text={lesson?.title_tt ?? reading!.title_tt} /></Link> · {t('exercise.question_count', { current: ids.indexOf(id) + 1, total: ids.length })}</>;
}

function Review({ sessionId }: { sessionId?: string }) {
  const { snapshot, content, releaseId, progress, command, confirm } = useApp(); const navigate = useNavigate();
  const [at, setAt] = useState(Date.now); const [busy, setBusy] = useState(false); const [limit, setLimit] = useState(30);
  useEffect(() => {
    const tick = () => setAt(Date.now()); const timer = setInterval(tick, 60_000);
    window.addEventListener('focus', tick); return () => { clearInterval(timer); window.removeEventListener('focus', tick); };
  }, []);
  useEffect(() => setAt(Date.now()), [snapshot.control.state_revision]);
  const now = at;
  const sessions = snapshot.sessions.filter(session => session.kind === 'review');
  const unfinished = sessions.find(session => ['active', 'paused'].includes(session.status));
  const active = snapshot.review_cards.filter(card => card.status === 'active').sort((a, b) => a.due_at - b.due_at || a.question_id.localeCompare(b.question_id));
  const due = active.filter(card => card.due_at <= now);
  const future = active.filter(card => card.due_at > now);
  const nextAt = future[0]?.due_at;
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const current = (session: Session) => session.question_plan.every(plan => content.catalog.questions.get(plan.question_id)?.grading_revision === plan.grading_revision) && Object.entries(POLICIES).every(([key, value]) => Reflect.get(session.policy_versions, key) === value);
  async function start(early = false, restart = false) {
    if (restart && !await confirm({ title: t('session.restart'), body: t('session.restart_confirm'), action: t('session.restart') })) return;
    const startedAt = Date.now();
    const earlyIds = active.filter(card => card.due_at > startedAt).slice(0, snapshot.settings.review_batch_size).map(card => card.question_id);
    if (early && !earlyIds.length) { setAt(startedAt); return; }
    setBusy(true);
    try {
      const result = await command({ type: 'start', kind: 'review', restart, early_question_ids: early ? earlyIds : undefined });
      navigate(`/review/session/${result.session_id}`);
    } catch { /* Старый план остаётся доступен при отказе новой транзакции. */ } finally { setBusy(false); }
  }
  if (sessionId !== undefined) {
    const session = sessions.find(item => item.session_id === sessionId);
    if (!session) return <Missing parent="/review" />;
    const compatible = current(session) && session.release_id === releaseId;
    if (session.status === 'submitted') {
      if (!current(session)) return <HistoricalResult session={session} backTo="/review" />;
      const attempts = session.question_plan.flatMap(plan => snapshot.attempts.filter(item => item.presentation_id === plan.first_presentation_id));
      const missed = attempts.filter(attempt => !attempt.independent_correct);
      const recommended = new Set(missed.flatMap(attempt => content.catalog.question(attempt.question_id).recommend_lessons));
      return <div className="document review-document"><h1>{t('review.result')}</h1>
        {session.content_version !== content.catalog.core.content_version && <p>{t('history.previous_version', { version: session.content_version })}</p>}
        <p>{t('review.reviewed_count', { count: attempts.length, total: session.question_plan.length })}</p><p>{t('review.independent_count', { count: attempts.filter(item => item.independent_correct).length })}</p><p>{t('review.skipped_count', { count: session.question_plan.length - attempts.length })}</p>
        <p>{t('review.due', { count: due.length })}</p>{nextAt && <p>{t('review.next_at', { date: formatDate(nextAt) })}</p>}
        <div className="actions">{due.length > 0 && !unfinished && <Button variant="primary" disabled={readonly} busy={busy} onClick={() => { void start(); }}>{t('review.next_batch')}</Button>}<Link className="button" to="/review">{t('nav.review')}</Link></div>
        {!!recommended.size && <section><h2>{t('assessment.recommendations')}</h2><ul>{content.catalog.core.lessons.filter(lesson => recommended.has(lesson.id)).map(lesson => <li key={lesson.id}><Link to={`/lessons/${lesson.id}`}><MixedText text={lesson.title_tt} /></Link></li>)}</ul></section>}
        <PracticeReview session={session} />
      </div>;
    }
    return <div className="session-document"><h1>{t('nav.review')}</h1>{session.status === 'active' && compatible ? <SessionPlayer session={session} onResult={() => {}} /> : <>
      <Status tone={compatible && session.status === 'paused' ? 'neutral' : 'warning'}>{t(compatible && session.status === 'paused' ? 'session.existing_draft' : 'session.incompatible')}</Status>
      {compatible && session.status === 'paused' && <Button variant="primary" busy={busy} disabled={readonly} onClick={() => { setBusy(true); void command({ type: 'resume', session_id: session.session_id }).catch(() => {}).finally(() => setBusy(false)); }}>{t('session.resume')}</Button>}
      <p><Link to="/review">{t('nav.review')}</Link></p>
    </>}</div>;
  }
  const todayDone = sessions.some(session => session.status === 'submitted' && new Date(session.submitted_at!).toDateString() === new Date(now).toDateString());
  const empty = !snapshot.review_cards.length ? 'review.no_cards' : !active.length ? 'review.all_suspended' : todayDone ? 'review.today_done' : 'review.empty';
  const manager = snapshot.review_cards.slice().sort((a, b) => a.status.localeCompare(b.status) || a.due_at - b.due_at || a.question_id.localeCompare(b.question_id));
  return <div className="document review-document"><h1>{t('review.title')}</h1>
    {unfinished ? <section><p>{t('session.existing_draft')}</p><Link className="button primary" to={`/review/session/${unfinished.session_id}`}>{t('session.resume')}</Link>{!!active.length && <p><Button disabled={readonly} busy={busy} onClick={() => { void start(!due.length, true); }}>{t('session.restart')}</Button></p>}</section> : due.length ? <section><p>{t('review.due', { count: due.length })}</p><Button variant="primary" disabled={readonly} busy={busy} onClick={() => { void start(); }}>{t('action.start')}</Button></section> : <Status><p>{t(empty)}</p>{!snapshot.review_cards.length && <div className="actions"><Link to="/lessons">{t('nav.lessons')}</Link><Link to="/reading">{t('nav.reading')}</Link></div>}</Status>}
    {nextAt && <p>{t('review.next_at', { date: formatDate(nextAt) })}</p>}
    <p>{t('review.batch_count', { count: snapshot.settings.review_batch_size })} <Link to="/settings">{t('nav.settings')}</Link></p>
    {!!future.length && !unfinished && <section><h2>{t('review.free')}</h2><p>{t('review.early_note')}</p><Button disabled={readonly} busy={busy} onClick={() => { void start(true); }}>{t('review.start_early')}</Button></section>}
    <p>{t('review.no_penalty')}</p>
    {!!manager.length && <details><summary>{t('review.manage')} · {manager.length}</summary><ul className="review-cards">{manager.slice(0, limit).map(card => <li data-review-id={card.question_id} key={card.question_id}>
      <p><QuestionLabel id={card.question_id} /></p><p>{t(card.status === 'suspended' ? 'review.suspended' : 'review.next_at', { date: formatDate(card.due_at) })}</p>
      <Button disabled={readonly} busy={busy} onClick={() => { setBusy(true); void command(card.status === 'active' ? { type: 'review_suspend', question_id: card.question_id } : { type: 'review_add', question_id: card.question_id, origin: card.origins[0]! }).catch(() => {}).finally(() => setBusy(false)); }}>{t(card.status === 'active' ? 'review.remove' : 'review.restore')}</Button>
    </li>)}</ul>{manager.length > limit && <Button onClick={() => setLimit(value => value + 30)}>{t('dictionary.show_more')}</Button>}</details>}
    <SessionHistory sessions={sessions} resultPath="/review/session" />
  </div>;
}
function ReviewPageContent() {
  const { session_id } = useParams(); const { content, snapshot } = useApp();
  const known = new Set(content.catalog.core.questions.map(question => question.id));
  const ids = [...new Set([...snapshot.review_cards.map(card => card.question_id), ...snapshot.sessions.filter(session => session.kind === 'review').flatMap(session => session.question_plan.map(plan => plan.question_id))])].filter(id => known.has(id)).sort();
  return <ContentState identity={`review:${ids.join(',')}`} load={() => content.questions(ids)}>{() => <Review key={session_id ?? 'queue'} sessionId={session_id} />}</ContentState>;
}

export function ReviewPage() { return <SessionContent kind="review" explicitOnly><ReviewPageContent  /></SessionContent>; }
