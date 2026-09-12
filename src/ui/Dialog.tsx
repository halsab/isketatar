import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton } from './controls';
import { t } from './copy';

function restoreFocus(target: HTMLElement | null) {
  const visible = target?.isConnected && target.getClientRects().length > 0 && getComputedStyle(target).visibility !== 'hidden';
  (visible ? target : document.querySelector<HTMLElement>('#main h1') ?? document.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
}

function subscribeWidth(listener: () => void) {
  const query = matchMedia('(min-width: 1120px)'); query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
export function Dialog({ open, title, children, onClose, context = false, busy = false, initialCancel = false }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; context?: boolean; busy?: boolean; initialCancel?: boolean;
}) {
  const wide = useSyncExternalStore(subscribeWidth, () => matchMedia('(min-width: 1120px)').matches, () => false);
  const modal = !context || !wide;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const modalScroll = useRef(0);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const focused = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
    const scroll = node.scrollTop;
    if (open && !wasOpen.current) {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modalScroll.current = 0;
    }
    if (node.open) node.close();
    if (open) {
      if (modal) node.showModal(); else node.show();
      if (focused) focused.focus({ preventScroll: true });
      else if (initialCancel) (node.querySelector<HTMLElement>('[data-cancel]') ?? heading.current)?.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
      node.scrollTop = modal ? modalScroll.current : scroll;
    } else if (wasOpen.current) {
      restoreFocus(returnTo.current);
    }
    wasOpen.current = open;
    document.documentElement.classList.toggle('modal-open', !!document.querySelector('dialog[open][data-modal=true]'));
  }, [open, modal, initialCancel]);
  useLayoutEffect(() => {
    const node = dialog.current;
    return () => {
    node?.close();
    document.documentElement.classList.toggle('modal-open', !!document.querySelector('dialog[open][data-modal=true]'));
    if (wasOpen.current) restoreFocus(returnTo.current);
    };
  }, []);
  return <dialog ref={dialog} inert={!open} className={`dialog ${context ? 'context-panel' : ''}`} data-modal={modal} role={modal ? 'dialog' : 'region'} aria-modal={modal ? true : undefined} aria-labelledby={id}
    onScroll={event => { if (modal && open) modalScroll.current = event.currentTarget.scrollTop; }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !modal) { event.stopPropagation(); if (!busy) onClose(); } }}>
    <div className="dialog-heading"><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2><IconButton icon="close" label={t('action.close')} disabled={busy} onClick={onClose} /></div>
    {children}
  </dialog>;
}
