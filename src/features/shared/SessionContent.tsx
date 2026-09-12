import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { StudyScope } from '../../app/StudyScope';
import type { ContentRepository } from '../../data/content/repository';
import { expectedFrom } from '../../data/progress/repository';
import type { Session } from '../../domain/learning/types';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';
import { Loading } from './ContentState';
import { HistoricalResult } from './HistoricalResult';

function RetainedContent({ session, children }: { session: Session; children: ReactNode }) {
  const { runtime, snapshot, progress, confirm } = useApp();
  const [content, setContent] = useState<ContentRepository | null>(null);
  const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setFailed(false);
    void (async () => {
      const source = await runtime.contentForRelease(session.release_id);
      await source.questions(session.question_plan.map(item => item.question_id));
      if (session.lesson_id) await source.lesson(session.lesson_id);
      if (session.reading_ids.length) await source.load('readings.json');
      if (active) setContent(source);
    })().catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [runtime, session.session_id, session.release_id, retry]);
  const pending = ['active', 'paused'].includes(session.status);
  async function leave() {
    if (!await confirm({ title: t('pwa.leave_historical'), body: t('pwa.leave_historical_confirm'), action: t('pwa.leave_historical') })) return;
    setBusy(true);
    try {
      await runtime.editor?.leave();
      const latest = await progress.snapshot();
      if (latest.control.data_generation !== snapshot.control.data_generation || latest.control.writer_epoch !== snapshot.control.writer_epoch) throw new Error('write_conflict');
      await runtime.command({ type: 'leave_historical', session_id: session.session_id, confirmed: true }, { repository: progress, expected: expectedFrom(latest) });
    }
    catch { /* Ошибка сохраняет черновик и закреплённую басму. */ } finally { setBusy(false); }
  }
  const backTo = session.kind === 'lesson_cycle' ? `/lessons/${session.lesson_id}/practice` : session.kind === 'reading_practice' ? `/reading/${session.reading_ids[0]}/questions` : session.kind === 'review' ? '/review' : `/${session.kind}`;
  const controls = pending && <Button disabled={snapshot.control.writer_id !== progress.tabId} busy={busy} onClick={() => { void leave(); }}>{t('pwa.leave_historical')}</Button>;
  if (failed) {
    if (session.status === 'submitted') return <HistoricalResult session={session} backTo={backTo} />;
    const drafts = snapshot.presentations.filter(item => item.session_id === session.session_id && item.draft_answer !== null);
    return <div className="document"><h1>{t('pwa.saved_answers')}</h1><Status tone="warning">{t('pwa.saved_draft_unavailable')}</Status>
      {drafts.map(item => <label className="field" key={item.presentation_id}>{item.question_id}<textarea readOnly value={item.draft_answer!.kind === 'text' || item.draft_answer!.kind === 'segments' ? item.draft_answer!.text : JSON.stringify(item.draft_answer)} /></label>)}
      <div className="actions"><Button onClick={() => setRetry(value => value + 1)}>{t('offline.retry')}</Button><Link to="/settings/backup">{t('settings.backup')}</Link>{controls}</div>
    </div>;
  }
  if (!content) return <Loading />;
  return <StudyScope.Provider value={{ content, releaseId: session.release_id }}><Status><p>{t('pwa.previous_study', { version: session.content_version })}</p>{controls}</Status>{children}</StudyScope.Provider>;
}

export function SessionContent({ kind, children, explicitOnly = false }: { kind: Session['kind']; children: ReactNode; explicitOnly?: boolean }) {
  const { session_id, lesson_id, reading_id } = useParams(); const { snapshot, runtime } = useApp();
  const session = snapshot.sessions.find(item => item.kind === kind && (!lesson_id || item.lesson_id === lesson_id) && (!reading_id || item.reading_ids.includes(reading_id)) && (session_id ? item.session_id === session_id : !explicitOnly && ['active', 'paused'].includes(item.status)));
  if (!session || session.release_id === runtime.releaseId) return children;
  return <RetainedContent key={`${session.session_id}:${session.release_id}`} session={session}>{children}</RetainedContent>;
}
