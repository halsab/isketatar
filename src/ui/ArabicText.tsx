import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { fontStatus, loadArabicFont, subscribeFont, type FontStatus } from './arabic-font';
import { t } from './copy';

export function useArabicFont(): FontStatus {
  const status = useSyncExternalStore(subscribeFont, fontStatus, () => 'idle' as const);
  useEffect(() => { void loadArabicFont(); }, []);
  return status;
}

export function ArabicFontGate({ children }: { children: ReactNode }) {
  const status = useArabicFont();
  if (status === 'ready') return children;
  return <span className="font-message" role="status">
    {t(status === 'error' ? 'font.failed' : 'font.loading')}
    {status === 'error' && <button type="button" onClick={() => { void loadArabicFont(); }}>{t('action.retry')}</button>}
  </span>;
}

export function ArabicText({ children, block = false, letter = false }: { children: ReactNode; block?: boolean; letter?: boolean }) {
  const status = useArabicFont();
  // Текст может находиться внутри label/button; повтор загрузки живёт во внешнем gate.
  if (status !== 'ready') return <span className="font-message">{t(status === 'error' ? 'font.failed' : 'font.loading')}</span>;
  return <bdi lang="tt-Arab" dir="rtl" className={`arabic${block ? ' arabic-block' : ''}${letter ? ' arabic-letter' : ''}`}>{children}</bdi>;
}
