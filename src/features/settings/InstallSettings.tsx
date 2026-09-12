import { useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { installation } from '../../app/installation';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';
const platforms = ['ios26', 'ios_previous', 'android', 'mac_safari', 'desktop_chromium', 'firefox'] as const;
type Platform = typeof platforms[number];
const guideKey = 'iske-imla-install-guide';
let lastPlatform: Platform | '' = '';
let guideLoaded = false;
function readPlatform() {
  if (guideLoaded) return lastPlatform;
  guideLoaded = true;
  try { const saved = localStorage.getItem(guideKey); lastPlatform = platforms.find(value => value === saved) ?? ''; }
  catch { /* При запрете storage выбор сохраняется только до закрытия документа. */ }
  return lastPlatform;
}
function rememberPlatform(value: Platform) {
  lastPlatform = value;
  try { localStorage.setItem(guideKey, value); } catch { /* Инструкция доступна и без постоянного хранилища. */ }
}
export function InstallSettings() {
  const state = useSyncExternalStore(installation.subscribe, installation.getState); const [platform, setPlatform] = useState<Platform | ''>(readPlatform);
  return <section id="install"><h2>{t('install.title')}</h2><p>{t('install.optional')}</p>
    {state.standalone ? <Status announce>{t('install.standalone')}</Status> : state.installed ? <Status announce>{t('install.installed')}</Status> : state.canPrompt || state.working ? <Button busy={state.working} onClick={() => { void installation.install(); }}>{t('install.action')}</Button> : <p>{t('install.manual')}</p>}
    {state.outcome && <Status tone={state.outcome === 'failed' ? 'warning' : 'neutral'} announce>{t(`install.${state.outcome}`)}</Status>}
    <label>{t('install.platform')}<select value={platform} onChange={event => { const value = event.target.value as Platform; rememberPlatform(value); setPlatform(value); }}><option value="" disabled>{t('install.choose')}</option>{platforms.map(value => <option key={value} value={value}>{t(`install.${value}`)}</option>)}</select></label>
    {platform && <div className="install-instructions"><h3>{t(`install.${platform}`)}</h3><ol>{([1, 2, 3] as const).map(step => <li key={step}>{t(`install.${platform}_${step}`)}</li>)}</ol></div>}
    <p>{t('install.storage')}</p><Link to="/settings/backup">{t('settings.backup')}</Link><p>{t('install.offline')}</p><a href="#offline-heading" onClick={event => { event.preventDefault(); document.getElementById('offline-heading')?.focus(); }}>{t('pwa.save')}</a>
  </section>;
}
