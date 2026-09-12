import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Session } from '../../domain/learning/types';
import { Button } from '../../ui/controls';
import { formatDate } from '../../ui/date';
import { t } from '../../ui/copy';

export function SessionHistory({ sessions, resultPath }: { sessions: Session[]; resultPath: string }) {
  const [limit, setLimit] = useState(10);
  const completed = sessions.filter(session => session.status === 'submitted').sort((a, b) => (b.submitted_at ?? 0) - (a.submitted_at ?? 0) || b.session_id.localeCompare(a.session_id));
  if (!completed.length) return null;
  return <details><summary>{t('course.history')} · {completed.length}</summary><ol>{completed.slice(0, limit).map(session => <li key={session.session_id}><Link to={`${resultPath}/${session.session_id}`}>{formatDate(session.submitted_at!)} — {t('assessment.result')}</Link></li>)}</ol>{completed.length > limit && <Button onClick={() => setLimit(value => value + 10)}>{t('action.expand')}</Button>}</details>;
}
