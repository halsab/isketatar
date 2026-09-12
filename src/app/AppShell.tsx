import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import { IconButton } from '../ui/controls';
import { t } from '../ui/copy';
import { Dialog } from '../ui/Dialog';

const items: { path: string; icon: IconName; label: Parameters<typeof t>[0] }[] = [
  { path: '/lessons', icon: 'lessons', label: 'nav.lessons' },
  { path: '/review', icon: 'review', label: 'nav.review' },
  { path: '/reading', icon: 'reading', label: 'nav.reading' },
  { path: '/dictionary', icon: 'dictionary', label: 'nav.dictionary' },
  { path: '/reference', icon: 'reference', label: 'nav.reference' },
];
function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return <nav className="primary-nav" aria-label={t('accessibility.menu')}>{items.map(item => {
    const active = pathname === item.path || pathname.startsWith(`${item.path}/`) || item.path === '/lessons' && /^\/(?:start|diagnostic|final)(?:\/|$)/u.test(pathname) || item.path === '/reference' && pathname.startsWith('/sources/');
    return <Link to={item.path} key={item.path} aria-current={active ? 'page' : undefined} onClick={event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (active) event.preventDefault(); onNavigate?.();
    }}><Icon name={item.icon} /><span>{t(item.label)}</span></Link>;
  })}</nav>;
}
export function AppShell({ children, status }: { children: ReactNode; status?: ReactNode }) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const { pathname, key } = useLocation();
  const menu = menuKey === key;
  useEffect(() => setMenuKey(null), [key]);
  const sessionRoute = /\/practice$|\/questions$|^\/review\/session\/|^\/(?:diagnostic|final)$/u.test(pathname);
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      const editing = document.activeElement?.matches('input, textarea, [contenteditable=true]');
      document.documentElement.classList.toggle('keyboard-open', !!editing && !!viewport && innerHeight - viewport.height > 150);
    };
    viewport?.addEventListener('resize', update); document.addEventListener('focusin', update); document.addEventListener('focusout', update);
    return () => { viewport?.removeEventListener('resize', update); document.removeEventListener('focusin', update); document.removeEventListener('focusout', update); document.documentElement.classList.remove('keyboard-open'); };
  }, []);
  useLayoutEffect(() => {
    const focus = () => {
      const title = document.querySelector<HTMLElement>('#main h1');
      if (!title) return false;
      title.tabIndex = -1; title.focus({ preventScroll: true }); document.title = `${title.textContent} · ${t('app.name')}`; return true;
    };
    const observer = new MutationObserver(() => { if (focus()) observer.disconnect(); });
    if (!focus()) observer.observe(document.getElementById('main')!, { childList: true, subtree: true });
    window.scrollTo({ top: 0, behavior: 'instant' });
    return () => observer.disconnect();
  }, [pathname]);
  return <div className={sessionRoute ? 'session-shell' : undefined}>
    <a className="skip-link" href="#main" onClick={event => { event.preventDefault(); document.getElementById('main')?.focus(); }}>{t('accessibility.skip_main')}</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" to="/">{t('app.name')}</Link>
      <div className="header-navigation"><Navigation /></div>
      <Link className="settings-link" to="/settings" aria-label={t('nav.settings')}><Icon name="settings" /></Link>
      <div className="compact-menu"><IconButton icon="menu" label={t('accessibility.menu')} aria-expanded={menu} onClick={() => setMenuKey(key)} /></div>
    </div></header>
    <main className="app-main" id="main" tabIndex={-1}>{status}{children}</main>
    <div className="bottom-navigation"><Navigation /></div>
    <Dialog open={menu} title={t('accessibility.menu')} onClose={() => setMenuKey(null)}><Navigation onNavigate={() => setMenuKey(null)} /></Dialog>
  </div>;
}
