import { useEffect, useState, useSyncExternalStore } from 'react';
import { useApp } from '../../app/AppProvider';
import { offline } from '../../data/pwa/client';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';
import { formatDate } from '../../ui/date';
import { replacementToken } from '../../data/progress/transfer';
export function OfflineSettings() {
  const { runtime, snapshot, progress, confirm } = useApp(); const state = useSyncExternalStore(offline.subscribe, offline.getState);
  const [persistence, setPersistence] = useState<boolean | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  useEffect(() => { setRemoveFailed(false); }, [snapshot.control.update_gate?.update_id]);
  const entry = state.registry?.releases.find(item => item.release_id === state.registry?.current_release_id);
  const total = state.manifest?.assets.reduce((sum, asset) => sum + asset.bytes, 0) ?? 0;
  const downloading = !!state.progress || entry?.completeness === 'downloading' || entry?.completeness === 'verifying';
  const run = (type: 'download' | 'verify') => { void offline.perform(type, runtime.releaseId).then(async () => { if (type === 'download' && navigator.storage?.persist) { try { setPersistence(await navigator.storage.persist()); } catch { setPersistence(false); } } }).catch(() => {}); };
  async function remove() {
    const expected = replacementToken(snapshot);
    const releases = [...new Set(snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status)).map(session => session.release_id))];
    if (!await confirm({ title: t('pwa.remove'), body: t('pwa.remove_confirm') + (releases.length ? ' ' + t('pwa.remove_pins', { releases: releases.join(', ') }) : ''), action: t('pwa.remove'), danger: true })) return;
    setRemoving(true); setRemoveFailed(false);
    try { await offline.accept(await runtime.beginReleaseUpdate(runtime.releaseId, expected, 'remove_offline')); }
    catch { setRemoveFailed(true); }
    finally { setRemoving(false); }
  }
  return <section id="offline"><h2 id="offline-heading" tabIndex={-1}>{t('settings.offline')}</h2><p>{t('pwa.separate')}</p>
    {state.supported === false ? <Status>{t('pwa.unavailable')}</Status> : <>
      <Status announce>{t(`pwa.${entry?.completeness ?? 'not_saved'}`)}</Status>
      {state.progress && <p role="status">{t('pwa.progress', { count: state.progress.count, total: state.progress.total, size: (state.progress.bytes / 1024 / 1024).toFixed(2) })}</p>}
      {entry?.completeness === 'ready' && <p>{t('pwa.verified', { version: entry.release_id, date: formatDate(entry.verified_at!) })}</p>}
      {total > 0 && <p>{t('pwa.size', { size: (total / 1024 / 1024).toFixed(2) })}</p>}
      <div className="actions">{downloading ? <Button onClick={() => { void offline.perform('cancel').catch(() => {}); }}>{t('action.cancel')}</Button> : <>
        {state.manifest && <Button variant="primary" disabled={state.loading} onClick={() => run(entry?.completeness === 'ready' ? 'verify' : 'download')}>{t(entry?.completeness === 'ready' ? 'pwa.check' : 'pwa.save')}</Button>}
        {!state.manifest && <Button disabled={state.loading} onClick={() => { void offline.start(runtime.releaseId); }}>{t('offline.retry')}</Button>}
      </>}</div>
      {state.error && <Status tone="error">{t(state.error === 'quota' ? 'pwa.quota' : state.error === 'content_corrupt' ? 'pwa.corrupt' : state.error === 'release_not_current' ? 'pwa.other_release' : 'pwa.failed_detail')}</Status>}
    </>}
    {persistence !== null && <Status>{t(persistence ? 'pwa.persisted' : 'pwa.persist_denied')}</Status>}
    <p>{t('pwa.storage_note')}</p>
    {state.supported && <Button disabled={state.loading} onClick={() => { void offline.check(); }}>{t('pwa.check_update')}</Button>}
    {state.manifest && <Button variant="danger" busy={removing || state.loading} disabled={progress.mode !== 'durable' || snapshot.control.writer_id !== progress.tabId} onClick={() => { void remove(); }}>{t('pwa.remove')}</Button>}
    {removeFailed && <Status tone="error" announce>{t('pwa.remove_failed')}</Status>}
  </section>;
}
