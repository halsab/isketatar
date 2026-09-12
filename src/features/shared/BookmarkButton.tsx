import { useState } from 'react';
import { useApp } from '../../app/AppProvider';
import { Button } from '../../ui/controls';
import { t } from '../../ui/copy';

export function BookmarkButton({ kind, id }: { kind: 'lesson' | 'rule'; id: string }) {
  const { snapshot, progress, command } = useApp(); const [busy, setBusy] = useState(false);
  const saved = snapshot.bookmarks.some(item => item.kind === kind && item.target_id === id);
  return <Button aria-pressed={saved} busy={busy} disabled={snapshot.control.writer_id !== progress.tabId} onClick={() => {
    setBusy(true); void command({ type: 'bookmark', kind, target_id: id, position: null, remove: saved }).catch(() => {}).finally(() => setBusy(false));
  }}>{t(saved ? 'bookmark.remove' : 'bookmark.add')}</Button>;
}
