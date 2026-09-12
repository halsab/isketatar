import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, Status } from '../ui/controls';
import { Dialog } from '../ui/Dialog';
import { t } from '../ui/copy';
import { AppRuntime, type AppState } from './runtime';
import { replacementToken } from '../data/progress/transfer';
import { expectedFrom } from '../data/progress/repository';
import type { Command } from '../data/progress/commands';

interface Confirmation { title: string; body: string; action: string; danger?: boolean }
interface AppContextValue { runtime: AppRuntime; state: AppState; confirm: (request: Confirmation) => Promise<boolean>; confirming: boolean }
const Context = createContext<AppContextValue | null>(null);
const application = new AppRuntime();

export function AppProvider({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(application.subscribe, application.getState);
  const [question, setQuestion] = useState<Confirmation | null>(null);
  const resolver = useRef<((confirmed: boolean) => void) | null>(null);
  const location = useLocation();
  const resolve = useCallback((confirmed: boolean) => { const pending = resolver.current; resolver.current = null; setQuestion(null); pending?.(confirmed); }, []);
  const confirm = useCallback((request: Confirmation) => new Promise<boolean>(done => { resolver.current?.(false); resolver.current = done; setQuestion(request); }), []);
  useEffect(() => { void application.start(); }, []);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible' && application.getState().phase === 'ready') void application.refresh().catch(() => {}); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, []);
  useLayoutEffect(() => { resolve(false); }, [location.key, state.snapshot?.control.data_generation, state.phase, resolve]);
  if (state.phase !== 'ready') return <main id="main"><h1>{t('app.name')}</h1><Status tone={state.phase === 'loading' ? 'neutral' : 'error'} announce>{t(state.phase === 'loading' ? 'boot.loading' : 'boot.failed')}</Status>
    {state.phase !== 'loading' && <div className="actions"><Button onClick={() => { if (state.error === 'unsupported_release') window.location.reload(); else void application.start(); }}>{t('offline.retry')}</Button>{state.phase === 'storage_error' && <Button onClick={() => { void application.useMemory().catch(() => {}); }}>{t('storage.use_memory')}</Button>}</div>}
  </main>;
  return <Context.Provider value={{ runtime: application, state, confirm, confirming: !!question }}>
    {children}
    <Dialog open={!!question} title={question?.title ?? ''} initialCancel onClose={() => resolve(false)}>
      <p>{question?.body}</p><div className="actions"><Button data-cancel onClick={() => resolve(false)}>{t('action.cancel')}</Button><Button variant={question?.danger ? 'danger' : 'primary'} onClick={() => resolve(true)}>{question?.action}</Button></div>
    </Dialog>
  </Context.Provider>;
}
export function useApp() {
  const context = useContext(Context);
  if (!context || !context.state.snapshot || !context.runtime.content || !context.runtime.progress) throw new Error('application_not_ready');
  const scope = { repository: context.runtime.progress, expected: expectedFrom(context.state.snapshot) };
  return { ...context, snapshot: context.state.snapshot, content: context.runtime.content, progress: context.runtime.progress, scope, command: (command: Command) => context.runtime.command(command, scope) };
}
export function RuntimeStatus() {
  const { runtime, state, snapshot, progress, confirm } = useApp();
  const [busy, setBusy] = useState(false);
  async function takeControl() {
    const expected = replacementToken(snapshot);
    if (!await confirm({ title: t('writer.takeover_action'), body: t('writer.takeover_confirm'), action: t('writer.takeover_action') })) return;
    setBusy(true); try { await runtime.takeover(progress, expected); } catch { /* Ошибка остаётся видимым состоянием репозитория. */ } finally { setBusy(false); }
  }
  return <>
    {state.mode === 'memory' && <Status tone="warning">{t('storage.memory_mode')}</Status>}
    {snapshot.control.writer_id !== progress.tabId && <Status tone="warning"><p>{t('writer.read_only')}</p><Button busy={busy} onClick={() => { void takeControl(); }}>{t('writer.takeover_action')}</Button></Status>}
    {state.error && <Status tone="error" announce><p>{t(state.error === 'write_conflict' ? 'writer.conflict' : state.error === 'history_full' ? 'storage.history_full_detail' : 'storage.unsaved')}</p><div className="actions">
      <Button onClick={() => { void runtime.retry().catch(() => {}); }}>{t('offline.retry')}</Button>
      {state.mode === 'durable' && <Button onClick={() => { void runtime.useMemory().catch(() => {}); }}>{t('storage.use_memory')}</Button>}
    </div></Status>}
  </>;
}
