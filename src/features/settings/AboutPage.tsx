import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { assetUrl } from '../../app/paths';
import packageInfo from '../../../package.json';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';

export function AboutPage() {
  const { runtime, content, state } = useApp(); const [copied, setCopied] = useState(false); const [failed, setFailed] = useState(false);
  const technical = `${t('about.app_version')}: ${packageInfo.version}\n${t('about.content_version')}: ${content.catalog.core.content_version}\n${t('about.release')}: ${runtime.releaseId}\n${t('about.browser')}: ${navigator.userAgent}\n${t('about.error_code')}: ${state.error ?? '—'}`;
  return <div className="document settings-document"><h1>{t('about.title')}</h1>
    <p>{t('onboarding.intro')}</p><p>{t('onboarding.language_note')}</p><p>{t('about.limits')}</p>
    <section><h2>{t('about.help')}</h2><ol><li>{t('about.help_path')} <Link to="/start">{t('onboarding.choose_route')}</Link></li><li>{t('about.help_lessons')} <Link to="/lessons">{t('nav.lessons')}</Link></li><li>{t('about.help_reader')} <Link to="/reading">{t('nav.reading')}</Link></li><li>{t('about.help_backup')} <Link to="/settings/backup">{t('settings.backup')}</Link></li></ol><p>{t('about.help_keys')}</p><p>{t('about.help_independence')}</p></section>
    <section><h2>{t('lesson.source')}</h2><p>{t('source.book')}</p><p>{t('source.edition')}</p><p>{t('about.editorial')}</p><p>{t('source.excerpt_note')}</p><Link to="/reference">{t('nav.reference')}</Link></section>
    <section><h2>{t('about.privacy')}</h2><p>{t('about.local_data')}</p><p>{t('about.analytics')}</p><p>{t('about.hosting')}</p><p>{t('about.storage_limits')}</p><p>{t('about.install_storage')}</p></section>
    <section><h2>{t('about.licenses')}</h2><ul><li><a href={assetUrl('licenses/Inter.txt')}>Inter · SIL Open Font License</a></li><li><a href={assetUrl('licenses/NotoNaskhArabic.txt')}>Noto Naskh Arabic · SIL Open Font License</a></li><li><a href={assetUrl('licenses/ThirdParty.txt')}>{t('about.library_licenses')}</a></li></ul></section>
    <section><h2>{t('about.technical')}</h2><p>{t('about.technical_note')}</p><label>{t('about.technical')}<textarea readOnly rows={6} value={technical} /></label>{navigator.clipboard && <Button onClick={() => { void navigator.clipboard.writeText(technical).then(() => { setCopied(true); setFailed(false); }).catch(() => { setFailed(true); setCopied(false); }); }}>{t('about.copy')}</Button>}{copied && <Status announce>{t('about.copied')}</Status>}{failed && <Status tone="warning">{t('about.copy_failed')}</Status>}</section>
    <p><Link to="/settings">{t('nav.settings')}</Link></p>
  </div>;
}
