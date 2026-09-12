import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { offline } from '../../data/pwa/client';
import { expectedFrom } from '../../data/progress/repository';
import { replacementToken } from '../../data/progress/model';
import type { Session } from '../../domain/learning/types';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';

function sessionPath(session: Session) {
  if (session.kind === 'lesson_cycle') return `/lessons/${session.lesson_id}/practice`;
  if (session.kind === 'reading_practice') return `/reading/${session.reading_ids[0]}/questions`;
  if (session.kind === 'review') return `/review/session/${session.session_id}`;
  return `/${session.kind}`;
}
function failure(code: string) {
  return t(code === 'draft_not_saved' ? 'pwa.save_input' : code === 'composition_in_progress' ? 'pwa.finish_input' : code === 'update_memory_mode' ? 'pwa.memory_decision' : code === 'update_clients_blocked' || code === 'update_timeout' || code === 'update_writer_unavailable' ? 'pwa.windows_blocked' : code === 'release_pinned' ? 'pwa.pinned' : code === 'retained_incomplete' || code === 'content_unavailable' || code === 'content_corrupt' ? 'pwa.repair_needed' : code === 'unsupported_release' ? 'pwa.unsupported' : 'pwa.update_failed');
}
export function UpdateStatus() {
  const { runtime, snapshot, progress, confirm, content } = useApp(); const pwa = useSyncExternalStore(offline.subscribe, offline.getState);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const gate = snapshot.control.update_gate;
  const operation = gate ? { ...gate, data_generation: snapshot.control.data_generation, writer_epoch: snapshot.control.writer_epoch } : pwa.update.operation;
  const removing = operation?.purpose === 'remove_offline';
  const owned = progress.mode === 'durable' && snapshot.control.writer_id === progress.tabId;
  const pins = snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status));
  const blocked = pins.filter(session => session.release_id !== pwa.registry?.current_release_id);
  const candidate = pwa.candidate;
  const cleanup = !gate && pwa.registry?.operation?.phase === 'committed' && pwa.registry.operation.target_release_id === runtime.releaseId ? pwa.registry.operation : null;
  const bytes = (candidate?.assets.reduce((total, asset) => total + asset.bytes, 0) ?? 0) + (pins.length ? pwa.manifest?.assets.reduce((total, asset) => total + asset.bytes, 0) ?? 0 : 0);
  const run = (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(null); void action().catch(error => setError(error instanceof Error ? error.message : 'pwa_unavailable')).finally(() => setBusy(false)); };
  async function accept() {
    if (!candidate) return;
    const expected = replacementToken(snapshot);
    if (!await confirm({ title: t('pwa.update_action'), body: t('pwa.update_confirm', { size: (bytes / 1024 / 1024).toFixed(2) }), action: t('pwa.update_action') })) return;
    await offline.perform('download-update', candidate.release_id);
    await offline.accept(await runtime.beginReleaseUpdate(candidate.release_id, expected));
  }
  async function recover() {
    if (!operation || !await confirm({ title: t(removing ? 'pwa.remove_recover' : 'pwa.recover'), body: t('pwa.recover_confirm'), action: t(removing ? 'pwa.remove_recover' : 'pwa.recover') })) return;
    const recovered = await runtime.recoverReleaseUpdate(operation.update_id, true); await offline.accept(recovered);
  }
  async function leave(session: Session) {
    const expected = replacementToken(snapshot);
    if (!await confirm({ title: t('pwa.leave_historical'), body: t('pwa.leave_historical_confirm'), action: t('pwa.leave_historical'), danger: true })) return;
    await runtime.editor?.leave(); const current = await progress.snapshot();
    if (current.control.data_generation !== expected.data_generation || current.control.writer_epoch !== expected.writer_epoch) throw new Error('write_conflict');
    await runtime.command({ type: 'leave_historical', session_id: session.session_id, confirmed: true }, { repository: progress, expected: expectedFrom(current) });
  }
  if (cleanup) return <section className="update-status" aria-label={t('pwa.update_title')}><Status tone="warning"><p>{t('pwa.cleanup_pending')}</p>{error && <p role="alert">{failure(error)}</p>}<Button busy={busy} onClick={() => run(async () => { await offline.finishBoot(cleanup.target_release_id, cleanup.update_id); await offline.perform('status'); })}>{t('pwa.finish_update')}</Button></Status></section>;
  if (pwa.supported === false || !candidate && !operation && !pwa.update.memoryRequest && !pwa.update.requested) return null;
  return <section className="update-status" aria-label={t(removing ? 'pwa.removing' : 'pwa.update_title')}><Status tone="warning">
    <h2>{t(removing ? 'pwa.removing' : operation ? 'pwa.updating' : 'pwa.update_title')}</h2>
    {operation ? <p>{t(removing ? 'pwa.remove_waiting' : 'pwa.quiescing')}</p> : <><p>{t('pwa.update_available', { version: candidate?.release_id ?? '' })}</p><p>{t('pwa.update_size', { size: (bytes / 1024 / 1024).toFixed(2) })}</p></>}
    {pwa.update.requested && <p>{t('pwa.requested')}</p>}
    {pwa.progress && <p role="status">{t('pwa.progress', { ...pwa.progress, size: (pwa.progress.bytes / 1024 / 1024).toFixed(2) })}</p>}
    {pwa.update.memoryRequest && <><p>{t('pwa.memory_decision')}</p><Link to="/settings/backup">{t('settings.export')}</Link><div className="actions"><Button busy={busy} onClick={() => run(async () => { if (await confirm({ title: t('pwa.memory_continue'), body: t('pwa.memory_confirm'), action: t('pwa.memory_continue'), danger: true })) await offline.acceptMemoryLoss(); })}>{t('pwa.memory_continue')}</Button></div></>}
    {!operation && blocked.length > 0 && <><p>{t('pwa.pinned')}</p><ul>{blocked.map(session => <li key={session.session_id}><Link to={sessionPath(session)}>{session.lesson_id ? `${session.lesson_id} · ${content.catalog.core.lessons.find(lesson => lesson.id === session.lesson_id)?.title_tt ?? ''}` : session.kind === 'reading_practice' ? session.reading_ids[0] : t(session.kind === 'diagnostic' ? 'diagnostic.title' : session.kind === 'final' ? 'assessment.final' : 'nav.review')}</Link>{owned && <Button busy={busy} onClick={() => run(() => leave(session))}>{t('pwa.leave_historical')}</Button>}</li>)}</ul></>}
    {(error || pwa.update.error) && <p role="alert">{removing ? t('pwa.remove_failed') : failure(error ?? pwa.update.error!)}</p>}
    {pwa.update.blockers.length > 0 && <ul>{pwa.update.blockers.map((blocker, index) => <li key={blocker.client_id}>{t('pwa.window', { number: index + 1 })}: {failure(blocker.reason)}</li>)}</ul>}
    <div className="actions">{operation ? <>
      {owned && <Button busy={busy || pwa.loading} onClick={() => run(() => offline.accept(operation))}>{t(removing ? 'pwa.remove_retry' : 'pwa.retry_update')}</Button>}
      {owned && operation.phase === 'quiescing' && <Button busy={busy || pwa.loading} onClick={() => run(() => offline.cancelUpdate(operation.update_id))}>{t(removing ? 'action.cancel' : 'pwa.defer')}</Button>}
      {owned && !removing && <Button busy={busy || pwa.loading} onClick={() => run(async () => { await offline.repairUpdate(operation); await offline.accept(operation); })}>{t('pwa.repair_update')}</Button>}
      {progress.mode === 'durable' && <Button busy={busy || pwa.loading} onClick={() => run(recover)}>{t(removing ? 'pwa.remove_recover' : 'pwa.recover')}</Button>}
    </> : owned ? <Button variant="primary" disabled={blocked.length > 0 || !candidate} busy={busy || pwa.loading} onClick={() => run(accept)}>{t('pwa.update_action')}</Button> : <Button busy={busy || pwa.loading} onClick={() => run(() => offline.perform('request-update'))}>{t('pwa.request_update')}</Button>}
    {pwa.progress && <Button onClick={() => { void offline.perform('cancel').catch(() => {}); }}>{t('action.cancel')}</Button>}
    </div>
  </Status></section>;
}
