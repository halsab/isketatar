import { useId, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { IconButton } from './controls';
import { t } from './copy';

function restoreFocus(target: HTMLElement | null) {
  const modal = document.querySelector<HTMLDialogElement>('dialog[open][data-modal=true]');
  if (modal && !modal.contains(target)) return;
  const visible = target?.isConnected && target.getClientRects().length > 0 && getComputedStyle(target).visibility !== 'hidden';
  (visible ? target : document.querySelector<HTMLElement>('#main h1') ?? document.querySelector<HTMLElement>('#main'))?.focus({ preventScroll: true });
}

function subscribeWidth(listener: () => void) {
  const query = matchMedia('(min-width: 1120px)'); query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
export function Dialog({ open, title, children, onClose, context = false, busy = false, initialCancel = false, suspended = false, restoreTargetId, position, onPosition, contentReady = true }: {
  open: boolean; title: string; children: ReactNode; onClose: () => void; context?: boolean; busy?: boolean; initialCancel?: boolean;
  suspended?: boolean; restoreTargetId?: string; position?: { scroll: number; control: string | null };
  onPosition?: (position: { scroll: number; control: string | null }) => void;
  contentReady?: boolean;
}) {
  const wide = useSyncExternalStore(subscribeWidth, () => matchMedia('(min-width: 1120px)').matches, () => false);
  const modal = !context || !wide;
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const modalScroll = useRef(0);
  const savedFocus = useRef<HTMLElement | null>(null);
  const initialPosition = useRef(position);
  const pendingRestore = useRef(false);
  const restoreId = useRef(restoreTargetId); restoreId.current = restoreTargetId;
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const focused = document.activeElement instanceof HTMLElement && node.contains(document.activeElement) ? document.activeElement : null;
    const scroll = node.scrollTop;
    if (open && !wasOpen.current) {
      returnTo.current = restoreId.current ? document.getElementById(restoreId.current) : document.activeElement instanceof HTMLElement ? document.activeElement : null;
      modalScroll.current = position?.scroll ?? 0;
      initialPosition.current = position; pendingRestore.current = !!position;
      savedFocus.current = position?.control ? [...node.querySelectorAll<HTMLElement>('[data-panel-control]')].find(item => item.dataset.panelControl === position.control) ?? null : null;
    }
    if (focused) savedFocus.current = focused;
    const rememberedFocus = savedFocus.current;
    if (node.open) node.close();
    if (open && !suspended) {
      if (modal) node.showModal(); else node.show();
      if (focused) focused.focus({ preventScroll: true });
      else if (rememberedFocus?.isConnected) rememberedFocus.focus({ preventScroll: true });
      else if (initialCancel) (node.querySelector<HTMLElement>('[data-cancel]') ?? heading.current)?.focus({ preventScroll: true });
      else heading.current?.focus({ preventScroll: true });
      node.scrollTop = modal ? modalScroll.current : scroll;
      if (pendingRestore.current && contentReady) {
        const restored = initialPosition.current;
        const control = [...node.querySelectorAll<HTMLElement>('[data-panel-control]')].find(item => item.dataset.panelControl === restored?.control);
        if (control && !control.hasAttribute('disabled')) control.focus({ preventScroll: true });
        node.scrollTop = restored?.scroll ?? 0; modalScroll.current = node.scrollTop;
        pendingRestore.current = false;
      }
    } else if (!open && wasOpen.current) {
      restoreFocus(restoreId.current ? document.getElementById(restoreId.current) ?? returnTo.current : returnTo.current);
    }
    wasOpen.current = open;
    document.documentElement.classList.toggle('modal-open', !!document.querySelector('dialog[open][data-modal=true]'));
  }, [open, modal, initialCancel, suspended, contentReady]);
  useLayoutEffect(() => {
    const node = dialog.current;
    return () => {
    node?.close();
    document.documentElement.classList.toggle('modal-open', !!document.querySelector('dialog[open][data-modal=true]'));
    if (wasOpen.current) restoreFocus(restoreId.current ? document.getElementById(restoreId.current) ?? returnTo.current : returnTo.current);
    };
  }, []);
  return <dialog ref={dialog} inert={!open || suspended} aria-hidden={!open || suspended} className={`dialog ${context ? 'context-panel' : ''}`} data-modal={modal} role={modal ? 'dialog' : 'region'} aria-modal={modal && open && !suspended ? true : undefined} aria-labelledby={id}
    onScroll={event => { if (modal && open) modalScroll.current = event.currentTarget.scrollTop; if (!pendingRestore.current) onPosition?.({ scroll: modalScroll.current, control: savedFocus.current?.dataset.panelControl ?? null }); }}
    onFocusCapture={event => { if (event.target instanceof HTMLElement) savedFocus.current = event.target; if (!pendingRestore.current) onPosition?.({ scroll: modalScroll.current, control: savedFocus.current?.dataset.panelControl ?? null }); }}
    onClickCapture={event => {
      // Safari не фокусирует ссылку при клике; сохраняем сам активированный элемент до перехода.
      const control = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-panel-control]') : null;
      if (control && event.currentTarget.contains(control)) { savedFocus.current = control; if (!pendingRestore.current) onPosition?.({ scroll: modalScroll.current, control: control.dataset.panelControl ?? null }); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => { if (event.key === 'Escape' && !modal) { event.stopPropagation(); if (!busy) onClose(); } }}>
    <div className="dialog-heading"><h2 id={id} ref={heading} tabIndex={-1}>{title}</h2><IconButton icon="close" label={t('action.close')} disabled={busy} onClick={onClose} /></div>
    {children}
  </dialog>;
}
