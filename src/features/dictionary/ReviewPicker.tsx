import { useState } from 'react';
import { useApp } from '../../app/AppProvider';
import { preparedReviewQuestions } from '../../domain/learning/exposure';
import { Button, ChoiceGroup } from '../../ui/controls';
import { t } from '../../ui/copy';
import { ContentState } from '../shared/ContentState';

function Picker({ ids, entryId }: { ids: string[]; entryId: string }) {
  const { snapshot, progress, content, command } = useApp(); const [selected, setSelected] = useState(ids[0]!); const [busy, setBusy] = useState(false);
  const added = snapshot.review_cards.some(card => card.question_id === selected && card.status === 'active');
  return <section><h2>{t('review.add')}</h2>{ids.length > 1 && <ChoiceGroup label={t('review.choose_question')} options={ids.map((id, index) => ({ id, content: `${index + 1}. ${t(`review.skill_${content.catalog.question(id).skill}`)}` }))} selected={[selected]} onChange={ids => setSelected(ids[0]!)} />}<Button disabled={added || snapshot.control.writer_id !== progress.tabId} busy={busy} onClick={() => {
    setBusy(true); void command({ type: 'review_add', question_id: selected, origin: { kind: 'dictionary', id: entryId } }).catch(() => {}).finally(() => setBusy(false));
  }}>{t(added ? 'review.added' : 'review.add')}</Button></section>;
}
export function ReviewPicker({ entryId }: { entryId: string }) {
  const { content, snapshot } = useApp(); const ids = preparedReviewQuestions(entryId, content.catalog, snapshot);
  if (!ids.length) return null;
  return <ContentState identity={`review-options:${ids.join(',')}`} load={() => content.questions(ids)}>{() => <Picker key={ids.join(',')} ids={ids} entryId={entryId} />}</ContentState>;
}
