import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApp } from '../../app/AppProvider';
import type { ObservationTarget } from '../../data/progress/commands';
import { pendingAssessments } from '../../domain/learning/attempt';
import { Button, Status } from '../../ui/controls';
import { t } from '../../ui/copy';

export function Disclosure({ identity, targets, children }: { identity: string; targets: ObservationTarget[]; children: ReactNode }) {
  const { runtime, snapshot, scope, confirm } = useApp();
  const pending = pendingAssessments(snapshot.sessions).filter(session => session.assessment_help_opened_at === null);
  const key = `${identity}:${snapshot.control.data_generation}:${pending.map(item => item.session_id).sort().join(',')}`;
  const [allowed, setAllowed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const activeKey = useRef(key); activeKey.current = key;
  async function disclose(confirmed = false) {
    const capturedKey = key;
    setBusy(true); setError(null);
    try {
      let expected = scope.expected;
      for (const target of targets) {
        const receipt = await runtime.command({ type: 'observe', target, confirm_assessment_help: confirmed }, { ...scope, expected });
        expected = receipt.expected!;
      }
      // Подтверждение само снимает pending-флаги; generation и владелец материала сохраняются.
      if (activeKey.current === capturedKey || activeKey.current === `${identity}:${scope.expected.data_generation}:`) setAllowed(activeKey.current);
    } catch (reason) { if (activeKey.current === capturedKey) setError(reason instanceof Error ? reason.message : 'storage_unavailable'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    activeKey.current = key;
    if (!pending.length) void disclose();
    return () => { activeKey.current = ''; };
  }, [key]);
  if (allowed === key) return children;
  return <Status tone={error ? 'error' : pending.length ? 'warning' : 'neutral'}>
    <p>{t(pending.length || error === 'assessment_help_confirmation_required' ? 'assessment.pending_help_title' : error ? 'storage.unsaved' : 'boot.loading')}</p>
    {(pending.length > 0 || error) && <Button busy={busy} onClick={() => {
      void (async () => {
        const needsConfirmation = pending.length > 0 || error === 'assessment_help_confirmation_required';
        const confirmed = needsConfirmation ? await confirm({ title: t('assessment.pending_help_title'), body: t('assessment.pending_help_body', { count: pending.length || 1 }), action: t('assessment.open_learning_material') }) : false;
        if ((!needsConfirmation || confirmed) && activeKey.current === key) await disclose(confirmed);
      })();
    }}>{t(pending.length || error === 'assessment_help_confirmation_required' ? 'assessment.open_learning_material' : 'draft.retry')}</Button>}
  </Status>;
}
