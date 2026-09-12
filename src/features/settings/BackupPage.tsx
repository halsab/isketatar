import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { ImportPreview } from '../../data/progress/model';
import { MAX_EXPORT_BYTES, replacementToken } from '../../data/progress/transfer';
import { Button, Status } from '../../ui/controls';
import { formatDate } from '../../ui/date';
import { t } from '../../ui/copy';

const size = (bytes: number) => `${(bytes / 1024).toLocaleString('tt', { maximumFractionDigits: 1 })} KiB`;
function importError(code: string) {
  return t(code === 'import_too_large' ? 'backup.too_large' : code === 'unsupported_import' ? 'backup.unsupported' : code === 'invalid_import' ? 'settings.import_invalid' : code === 'write_conflict' || code === 'invalid_preview' ? 'backup.changed' : code === 'content_unavailable' || code === 'content_corrupt' ? 'error.load' : 'storage.unsaved');
}
export function BackupPage() {
  const { snapshot, progress, runtime, confirm } = useApp();
  const [operation, setOperation] = useState<'preview' | 'export' | 'replace' | 'clear' | null>(null); const busy = operation !== null; const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null); const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [exported, setExported] = useState<{ url: string; file: File; at: number } | null>(null);
  const sequence = useRef(0); const active = useRef(true); const url = useRef<string | null>(null); const latestPreview = useRef(preview); latestPreview.current = preview;
  const token = replacementToken(snapshot); const stale = preview !== null && JSON.stringify(preview.expected) !== JSON.stringify(token);
  const owned = snapshot.control.writer_id === progress.tabId;
  const live = (call: number) => active.current && call === sequence.current && runtime.progress === progress;
  useEffect(() => { active.current = true; setFile(null); setPreview(null); setExported(null); setOperation(null); setError(null); setNotice(null); return () => { active.current = false; sequence.current++; progress.cancelImport(); if (url.current) URL.revokeObjectURL(url.current); }; }, [progress]);
  function cancel() { sequence.current++; progress.cancelImport(); setFile(null); setPreview(null); latestPreview.current = null; setOperation(null); setError(null); }
  async function prepare(selected: File) {
    const call = ++sequence.current; setFile(selected); setPreview(null); setOperation('preview'); setError(null); setNotice(null);
    try {
      if (selected.size > MAX_EXPORT_BYTES) throw new Error('import_too_large');
      await runtime.loadAllContent();
      if (!active.current || call !== sequence.current || runtime.progress !== progress) return;
      const next = await progress.previewImport(selected);
      if (active.current && call === sequence.current && runtime.progress === progress) setPreview(next);
    } catch (reason) { if (active.current && call === sequence.current) setError(importError(reason instanceof Error ? reason.message : 'storage_unavailable')); }
    finally { if (active.current && call === sequence.current) setOperation(null); }
  }
  useEffect(() => { if (stale && file && !busy) void prepare(file); }, [stale, snapshot.control.state_revision, file, busy]);
  async function exportFile() {
    const call = ++sequence.current; setOperation('export'); setError(null);
    try {
      const blob = await progress.exportProgress();
      if (!live(call)) return;
      const at = Date.now(); const file = new File([blob], `iske-imla-${new Date(at).toISOString().replaceAll(':', '-')}.json`, { type: 'application/json' });
      if (url.current) URL.revokeObjectURL(url.current); url.current = URL.createObjectURL(file);
      setExported({ url: url.current, file, at }); setNotice(t('settings.export_done'));
    } catch (reason) { if (live(call)) setError(importError(reason instanceof Error ? reason.message : 'storage_unavailable')); }
    finally { if (live(call)) setOperation(null); }
  }
  async function replace() {
    const captured = preview;
    if (!captured || stale || !await confirm({ title: t('settings.import'), body: t('settings.import_confirm'), action: t('backup.replace'), danger: true })) return;
    if (!active.current || runtime.progress !== progress || latestPreview.current?.id !== captured.id) return;
    const call = ++sequence.current; setOperation('replace'); setError(null);
    try { await progress.commitImport(captured.id, true); if (!live(call)) return; setFile(null); setPreview(null); await runtime.refreshAfterReplacement(progress); if (live(call)) setNotice(t('settings.import_done')); }
    catch (reason) { if (live(call)) setError(importError(reason instanceof Error ? reason.message : 'storage_unavailable')); }
    finally { if (live(call)) setOperation(null); }
  }
  async function clear() {
    const expected = replacementToken(snapshot);
    if (!await confirm({ title: t(progress.mode === 'memory' ? 'backup.clear_memory' : 'settings.reset'), body: t(progress.mode === 'memory' ? 'backup.clear_memory_note' : 'backup.reset_note'), action: t(progress.mode === 'memory' ? 'backup.clear_memory' : 'settings.reset'), danger: true })) return;
    if (!active.current || runtime.progress !== progress) return;
    const call = ++sequence.current; setOperation('clear'); setError(null);
    try { await (progress.mode === 'memory' ? progress.discardMemory(expected, true) : progress.reset(expected, true)); if (!live(call)) return; setFile(null); setPreview(null); await runtime.refreshAfterReplacement(progress); if (live(call)) setNotice(t(progress.mode === 'memory' ? 'backup.memory_cleared' : 'settings.reset_done')); }
    catch (reason) { if (live(call)) setError(importError(reason instanceof Error ? reason.message : 'storage_unavailable')); }
    finally { if (live(call)) setOperation(null); }
  }
  const lessonCount = new Set(snapshot.sessions.flatMap(session => session.lesson_id ? [session.lesson_id] : [])).size;
  const shareable = exported && typeof navigator.canShare === 'function' && navigator.canShare({ files: [exported.file] });
  return <div className="document settings-document"><h1>{t('settings.backup')}</h1><p>{t('about.local_data')}</p>
    {notice && <Status announce>{notice}</Status>}{error && <Status tone="error" announce>{error}</Status>}
    <section><h2>{t('settings.progress')}</h2><p>{t('backup.current', { lesson_count: lessonCount, attempt_count: snapshot.attempts.length, bookmark_count: snapshot.bookmarks.length })}</p><p>{t('backup.storage', { size: size(snapshot.control.estimated_record_bytes), count: snapshot.control.attempt_count })}</p><p>{t('backup.limit_note')}</p></section>
    <section><h2>{t('settings.export')}</h2><Button busy={busy} onClick={() => { void exportFile(); }}>{t('backup.prepare')}</Button>{exported && <div className="prepared-file"><p>{exported.file.name} · {size(exported.file.size)} · {formatDate(exported.at)}</p><div className="actions"><a className="button primary" href={exported.url} download={exported.file.name}>{t('backup.download')}</a>{shareable && <Button onClick={() => { void navigator.share({ files: [exported.file] }).then(() => { if (active.current) setNotice(t('backup.shared')); }).catch(reason => { if (active.current && !(reason instanceof DOMException && reason.name === 'AbortError')) setError(t('backup.share_failed')); }); }}>{t('backup.share')}</Button>}</div></div>}</section>
    <section><h2>{t('settings.import')}</h2><p>{t('backup.import_note')}</p><label>{t('backup.choose')}<input type="file" accept="application/json,.json" disabled={busy || !owned} onChange={event => { const selected = event.target.files?.[0]; event.target.value = ''; if (selected) void prepare(selected); }} /></label>
      {operation === 'preview' && <p role="status">{t('backup.checking')}</p>}
      {file && <><p>{file.name} · {size(file.size)}</p><Button disabled={busy && operation !== 'preview'} onClick={cancel}>{t('action.cancel')}</Button></>}
      {preview && <section className="import-preview" aria-label={t('backup.preview')}><h3>{t('backup.preview')}</h3><p>{t('settings.import_preview', { lesson_count: preview.recognized_lessons, attempt_count: preview.recognized_attempts, bookmark_count: preview.bookmarks })}</p><p>{t('backup.legacy', { count: preview.legacy_records })}</p>{(Object.keys(preview.legacy_reasons) as (keyof ImportPreview['legacy_reasons'])[]).filter(reason => preview.legacy_reasons[reason] > 0).map(reason => <p key={reason}>{t(`backup.${reason}`, { count: preview.legacy_reasons[reason] })}</p>)}<p>{t('settings.learning_path')}: {t(preview.route === 'arabic_reader' ? 'onboarding.arabic_known' : preview.route === 'new_to_script' ? 'onboarding.arabic_new' : 'backup.no_route')}</p><p>{t('backup.current', { lesson_count: lessonCount, attempt_count: snapshot.attempts.length, bookmark_count: snapshot.bookmarks.length })}</p><Button variant="danger" disabled={!owned || stale} busy={busy} onClick={() => { void replace(); }}>{t('backup.replace')}</Button></section>}
      {file && error && <Button busy={busy} onClick={() => { void prepare(file); }}>{t('action.retry')}</Button>}
    </section>
    <section><h2>{t(progress.mode === 'memory' ? 'backup.clear_memory' : 'settings.reset')}</h2><p>{t(progress.mode === 'memory' ? 'backup.clear_memory_note' : 'backup.reset_note')}</p><Button variant="danger" busy={busy} disabled={!owned} onClick={() => { void clear(); }}>{t(progress.mode === 'memory' ? 'backup.clear_memory' : 'settings.reset')}</Button></section>
    <p><Link to="/settings">{t('nav.settings')}</Link></p>
  </div>;
}
