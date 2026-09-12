import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { Settings } from '../../data/progress/model';
import { ArabicText } from '../../ui/ArabicText';
import { OfflineSettings } from './OfflineSettings';
import { t } from '../../ui/copy';

export function SettingsPage() {
  const { snapshot, progress, command } = useApp(); const [busy, setBusy] = useState(false);
  const settings = snapshot.settings;
  async function save(patch: Parameters<typeof command>[0] & { type: 'settings' }) {
    setBusy(true); try { await command(patch); } catch { /* Применяется только подтверждённая настройка. */ } finally { setBusy(false); }
  }
  return <div className="document settings-document"><h1>{t('nav.settings')}</h1>
    <fieldset disabled={busy || snapshot.control.writer_id !== progress.tabId}><legend>{t('settings.appearance')}</legend>
      <label>{t('settings.theme')}<select value={settings.theme} onChange={event => { void save({ type: 'settings', patch: { theme: event.target.value as Settings['theme'] } }); }}>{(['system', 'light', 'dark'] as const).map(value => <option key={value} value={value}>{t(`settings.theme_${value}`)}</option>)}</select></label>
      <label>{t('settings.text_size')}<select value={settings.text_size_px} onChange={event => { void save({ type: 'settings', patch: { text_size_px: Number(event.target.value) as Settings['text_size_px'] } }); }}>{[18, 20, 22, 24].map(size => <option key={size}>{size}</option>)}</select></label>
      <label>{t('settings.arabic_size')}<select value={settings.arabic_size_px} onChange={event => { void save({ type: 'settings', patch: { arabic_size_px: Number(event.target.value) as Settings['arabic_size_px'] } }); }}>{[28, 32, 40, 48].map(size => <option key={size}>{size}</option>)}</select></label>
      <label>{t('settings.motion')}<select value={settings.reduced_motion} onChange={event => { void save({ type: 'settings', patch: { reduced_motion: event.target.value as Settings['reduced_motion'] } }); }}><option value="system">{t('settings.theme_system')}</option><option value="reduce">{t('settings.motion_reduce')}</option></select></label>
    </fieldset>
    <section aria-label={t('settings.preview')}><p className="study-text">{t('settings.preview_text')}</p><ArabicText block>ا ب ت</ArabicText></section>
    <fieldset disabled={busy || snapshot.control.writer_id !== progress.tabId}><legend>{t('settings.learning_path')}</legend><p>{t('settings.route_note')}</p>
      <label>{t('settings.learning_path')}<select value={settings.selected_route ?? ''} onChange={event => { void save({ type: 'settings', patch: { selected_route: event.target.value as 'arabic_reader' | 'new_to_script', onboarding_completed: true } }); }}><option value="" disabled>{t('onboarding.choose_route')}</option><option value="arabic_reader">{t('onboarding.arabic_known')}</option><option value="new_to_script">{t('onboarding.arabic_new')}</option></select></label>
      <label>{t('settings.review_batch')}<select value={settings.review_batch_size} onChange={event => { void save({ type: 'settings', patch: { review_batch_size: Number(event.target.value) } }); }}>{Array.from({ length: 10 }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
    </fieldset>
    <OfflineSettings />
    <section><h2>{t('settings.progress')}</h2><p>{t('about.local_data')}</p><Link className="button primary" to="/settings/backup">{t('settings.backup')}</Link></section>
    <p><Link to="/about">{t('about.title')}</Link></p>
  </div>;
}
