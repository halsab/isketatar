import { SessionContent } from '../shared/SessionContent';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { POLICIES, type Reading } from '../../domain/content/types';
import type { Session } from '../../domain/learning/types';
import { ArabicFontGate } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { SessionPlayer } from '../practice/SessionPlayer';
import { ContentState, Missing } from '../shared/ContentState';
import { HistoricalResult } from '../shared/HistoricalResult';
import { PracticeReview } from '../shared/PracticeReview';
import { SessionHistory } from '../shared/SessionHistory';

function ReadingQuestions({ reading, sessionId }: { reading: Reading; sessionId?: string }) {
  const { content, snapshot, releaseId, progress, command, confirm } = useApp(); const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const sessions = snapshot.sessions.filter(session => session.kind === 'reading_practice' && session.reading_ids.length === 1 && session.reading_ids[0] === reading.id);
  const unfinished = sessions.find(session => ['active', 'paused'].includes(session.status));
  const backTo = `/reading/${reading.id}/questions`;
  const current = (session: Session) => session.question_plan.length === reading.question_ids.length && session.question_plan.every((item, index) => item.question_id === reading.question_ids[index] && item.grading_revision === content.catalog.question(item.question_id).grading_revision) && Object.entries(POLICIES).every(([key, value]) => Reflect.get(session.policy_versions, key) === value);
  const compatible = !unfinished || unfinished.release_id === releaseId && current(unfinished);
  const readonly = snapshot.control.writer_id !== progress.tabId;
  async function start(restart = false) {
    if (restart && !await confirm({ title: t('session.restart'), body: t('session.restart_confirm'), action: t('session.restart') })) return;
    setBusy(true);
    try { await command(unfinished && !restart ? { type: 'resume', session_id: unfinished.session_id } : { type: 'start', kind: 'reading_practice', reading_id: reading.id, restart }); }
    catch { /* Переход к вопросам происходит только после сохранённого start/resume. */ } finally { setBusy(false); }
  }
  if (reading.role === 'final') {
    if (sessionId !== undefined) return <Missing parent={`/reading/${reading.id}`} />;
    const final = snapshot.sessions.filter(session => session.kind === 'final' && session.status === 'submitted').sort((a, b) => (b.submitted_at ?? 0) - (a.submitted_at ?? 0))[0];
    return <div className="document"><h1>{t('reading.questions')}</h1><p>{t('reading.final_questions')}</p><Link className="button primary" to={final ? `/final/result/${final.session_id}` : '/final'}>{t(final ? 'assessment.result' : 'assessment.final')}</Link></div>;
  }
  if (sessionId !== undefined) {
    const session = sessions.find(item => item.session_id === sessionId);
    if (!session) return <Missing parent={`/reading/${reading.id}`} />;
    if (session.status !== 'submitted') return <div className="document"><h1>{t('assessment.result')}</h1><p>{t(['active', 'paused'].includes(session.status) ? 'session.existing_draft' : 'session.incompatible')}</p><Link to={backTo}>{t('action.continue')}</Link></div>;
    if (!current(session)) return <HistoricalResult session={session} backTo={backTo} />;
    const first = session.question_plan.flatMap(plan => snapshot.attempts.filter(item => item.presentation_id === plan.first_presentation_id));
    return <div className="document"><h1>{t('assessment.result')} · <MixedText text={reading.title_tt} /></h1>
      {session.content_version !== content.catalog.core.content_version && <p>{t('history.previous_version', { version: session.content_version })}</p>}
      <p>{t('assessment.score', { correct: first.filter(item => item.grade === 'correct').length, total: session.question_plan.length })}</p>
      <p>{t('reading.independent_score', { correct: first.filter(item => item.independent_correct).length, total: session.question_plan.length })}</p>
      <p>{t('reading.questions_separate')}</p><div className="actions"><Link className="button primary" to={`/reading/${reading.id}`}>{t('reading.title')}</Link><Link className="button" to={backTo}>{t('assessment.new_attempt')}</Link></div>
      <PracticeReview session={session} />
    </div>;
  }
  return <div className="session-document"><h1>{t('reading.questions')} · <MixedText text={reading.title_tt} /></h1>
    {compatible && unfinished?.status === 'active' ? <SessionPlayer session={unfinished} onResult={id => navigate(`/reading/${reading.id}/result/${id}`, { replace: true })} /> : <>
      <p>{t('exercise.untimed')}</p><p>{t('reading.questions_separate')}</p><p>{t('exercise.question_count', { current: 0, total: reading.question_ids.length })}</p>
      {unfinished && <Status tone={compatible ? 'neutral' : 'warning'}>{t(compatible ? 'session.existing_draft' : 'session.incompatible')}</Status>}
      <ArabicFontGate><div className="actions">{compatible && <Button variant="primary" disabled={readonly} busy={busy} onClick={() => { void start(); }}>{t(unfinished ? 'session.resume' : 'action.start')}</Button>}{unfinished && <Button disabled={readonly} busy={busy} onClick={() => { void start(true); }}>{t('session.restart')}</Button>}</div></ArabicFontGate>
      <p><Link to={`/reading/${reading.id}`}>{t('reading.title')}</Link></p><SessionHistory sessions={sessions} resultPath={`/reading/${reading.id}/result`} />
    </>}
  </div>;
}
function ReadingQuestionsPageContent({ result = false }: { result?: boolean }) {
  const { reading_id = '', session_id = '' } = useParams(); const { content } = useApp();
  if (!content.catalog.core.reading_ids.includes(reading_id)) return <Missing parent="/reading" />;
  return <ContentState pageTitle={t('reading.questions')} identity={reading_id} load={async () => {
    await content.load('readings.json'); const reading = content.catalog.readings.get(reading_id)!;
    await content.questions(reading.question_ids);
    return reading;
  }}>{reading => <ReadingQuestions key={`${reading.id}:${session_id}`} reading={reading} sessionId={result ? session_id : undefined} />}</ContentState>;
}

export function ReadingQuestionsPage({ result = false }: { result?: boolean }) { return <SessionContent kind="reading_practice"><ReadingQuestionsPageContent result={result} /></SessionContent>; }
