import { useEffect } from 'react';
import { useBlocker } from 'react-router-dom';
import { useApp } from './AppProvider';

export function NavigationGuard() {
  const { runtime } = useApp();
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (!!runtime.editor || !!runtime.getState().quiescing) && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (runtime.getState().quiescing) { blocker.reset(); return; }
    void (async () => {
      try { await runtime.editor?.leave(); blocker.proceed(); }
      catch { blocker.reset(); }
    })();
  }, [blocker, runtime]);
  useEffect(() => {
    const flush = () => { void runtime.editor?.flush().catch(() => {}); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    const beforeUnload = (event: BeforeUnloadEvent) => { if (runtime.editor?.dirty) { flush(); event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('pagehide', flush); document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('pagehide', flush); document.removeEventListener('visibilitychange', hidden); };
  }, [runtime]);
  return null;
}
