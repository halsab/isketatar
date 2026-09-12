import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';

export function SemanticPosition({ kind, id, revision, anchors, focusAnchor = true, focusTargetId, isReady }: { kind: 'lesson' | 'reading' | 'reference'; id: string; revision: string; anchors: string[]; focusAnchor?: boolean; focusTargetId?: string; isReady?: (element: HTMLElement) => boolean }) {
  const { snapshot, progress, scope, runtime } = useApp(); const location = useLocation();
  const anchorKey = anchors.join('|');
  useEffect(() => {
    const allowed = anchorKey.split('|');
    const query = new URLSearchParams(location.search); const requested = query.getAll('at').length === 1 ? query.get('at') : null;
    const saved = snapshot.resume_positions.find(position => position.kind === kind && position.target_id === id);
    const historyPosition: unknown = history.state?.iskePosition;
    const returned = historyPosition && typeof historyPosition === 'object' && Reflect.get(historyPosition, 'target_id') === id && typeof Reflect.get(historyPosition, 'anchor_id') === 'string' && typeof Reflect.get(historyPosition, 'within_block_ratio') === 'number' ? { anchor_id: String(Reflect.get(historyPosition, 'anchor_id')), within_block_ratio: Math.max(0, Math.min(1, Number(Reflect.get(historyPosition, 'within_block_ratio')))) } : null;
    const position = requested && allowed.includes(requested) ? { anchor_id: requested, within_block_ratio: 0 } : returned ?? saved;
    let frame = 0; let restored = false;
    const restore = () => {
      const element = position?.anchor_id && allowed.includes(position.anchor_id) ? document.getElementById(position.anchor_id) : null;
      if (element && !restored && (requested === element.id || !isReady || isReady(element))) {
        restored = true; observer.disconnect(); clearTimeout(deadline);
        frame = requestAnimationFrame(() => {
          window.scrollTo({ top: scrollY + element.getBoundingClientRect().top - 100 + position!.within_block_ratio * element.getBoundingClientRect().height, behavior: 'instant' });
        if (requested && focusAnchor) { const target = focusTargetId ? document.getElementById(focusTargetId) ?? element : element; if (target === element) target.tabIndex = -1; target.focus({ preventScroll: true }); }
        });
      }
    };
    const observer = new MutationObserver(restore);
    const deadline = setTimeout(() => observer.disconnect(), 15000);
    if (position?.anchor_id && allowed.includes(position.anchor_id)) observer.observe(document.getElementById('main')!, { childList: true, subtree: true });
    restore();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pending: { anchor_id: string; within_block_ratio: number } | null = null;
    const save = () => {
      if (!pending || snapshot.control.writer_id !== progress.tabId) return;
      const position = { kind, target_id: id, ...pending, content_revision: revision }; pending = null;
      void runtime.command({ type: 'position', position }, scope).catch(() => {});
    };
    const measure = () => {
      const elements = allowed.map(anchor => document.getElementById(anchor)).filter((element): element is HTMLElement => !!element);
      const element = elements.filter(node => node.getBoundingClientRect().top <= 110).at(-1) ?? elements[0];
      if (!element || isReady && !isReady(element)) return;
      const bounds = element.getBoundingClientRect();
      pending = { anchor_id: element.id, within_block_ratio: Math.max(0, Math.min(1, (100 - bounds.top) / Math.max(1, bounds.height))) };
      if ((history.state?.key ?? 'default') === location.key) history.replaceState({ ...history.state, iskePosition: { target_id: id, ...pending } }, '');
    };
    const scroll = () => {
      measure();
      if (timer) clearTimeout(timer); timer = setTimeout(save, 500);
    };
    const unregister = runtime.registerPosition(scope, () => {
      measure(); if (timer) clearTimeout(timer);
      const position = pending ? { kind, target_id: id, ...pending, content_revision: revision } : null; pending = null;
      return position ? { type: 'position', position } : null;
    });
    window.addEventListener('scroll', scroll, { passive: true });
    return () => { unregister(); observer.disconnect(); clearTimeout(deadline); cancelAnimationFrame(frame); window.removeEventListener('scroll', scroll); if (timer) clearTimeout(timer); save(); };
  }, [kind, id, revision, anchorKey, location.key, location.search, progress, snapshot.control.data_generation, snapshot.control.writer_epoch, snapshot.settings.arabic_size_px, snapshot.settings.text_size_px, focusAnchor, focusTargetId, isReady]);
  return null;
}
