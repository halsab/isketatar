import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import type { RouteId } from '../../domain/content/types';
import { useApp } from '../../app/AppProvider';
import { Button, ChoiceGroup } from '../../ui/controls';
import { t } from '../../ui/copy';

export function StartPage() {
  const { command, snapshot, progress, content } = useApp();
  const [route, setRoute] = useState<RouteId | null>(snapshot.settings.selected_route);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const requested: unknown = location.state && typeof location.state === 'object' ? Reflect.get(location.state, 'returnTo') : null;
  const returnTo = typeof requested === 'string' && content.catalog.core.lessons.some(lesson => requested === `/lessons/${lesson.id}/practice`) ? requested : null;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const readonly = snapshot.control.writer_id !== progress.tabId;
  async function start() {
    if (!route || busy || readonly) return;
    setBusy(true);
    try {
      await command({ type: 'settings', patch: { selected_route: route, onboarding_completed: true } });
      if (mounted.current) navigate(returnTo ?? `/lessons/${content.catalog.core.routes[route][0]}`, { replace: true });
    } catch { /* Выбор остаётся на экране, причина сохранения показана рядом. */ } finally { setBusy(false); }
  }
  return <div className="document"><h1>{t('onboarding.title')}</h1><p className="study-text">{t('onboarding.intro')}</p>
    <ChoiceGroup label={t('onboarding.choose_route')} disabled={busy || readonly} selected={route ? [route] : []} onChange={ids => setRoute(ids[0] as RouteId)} options={[
      { id: 'arabic_reader', content: <><strong>{t('onboarding.arabic_known')}</strong><p>{t('onboarding.known_detail')}</p></> },
      { id: 'new_to_script', content: <><strong>{t('onboarding.arabic_new')}</strong><p>{t('onboarding.new_detail')}</p></> },
    ]} />
    {!route && <p>{t('exercise.select_option')}</p>}<Button variant="primary" busy={busy} disabled={!route || readonly} onClick={() => { void start(); }}>{t('action.start')}</Button>
    <p className="actions"><Link to="/diagnostic">{t('onboarding.diagnostic')}</Link></p>
  </div>;
}
