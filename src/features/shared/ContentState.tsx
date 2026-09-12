import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';

export function Missing({ parent = '/lessons' }: { parent?: string }) { return <div className="document"><h1>{t('error.not_found')}</h1><Link to={parent}>{t('action.back')}</Link></div>; }
export function Loading() { return <Status announce>{t('boot.loading')}</Status>; }
export function ContentState<T>({ identity, load, children, onSettled }: { identity: string; load: () => Promise<T>; children: (value: T) => ReactNode; onSettled?: () => void }) {
  const [result, setResult] = useState<{ identity: string; value: T } | null>(null);
  const [failed, setFailed] = useState(false); const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setFailed(false);
    void load().then(value => { if (active) { setResult({ identity, value }); onSettled?.(); } }).catch(() => { if (active) { setFailed(true); onSettled?.(); } });
    return () => { active = false; };
    // identity определяет ресурс; изменение callback при render не повторяет загрузку.
  }, [identity, retry]);
  if (failed) return <Status tone="error"><p>{t('error.load')}</p><Button onClick={() => setRetry(value => value + 1)}>{t('offline.retry')}</Button></Status>;
  return result?.identity === identity ? children(result.value) : <Loading />;
}
