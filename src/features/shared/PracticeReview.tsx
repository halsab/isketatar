import { useState } from 'react';
import { useApp } from '../../app/AppProvider';
import type { Session } from '../../domain/learning/types';
import { ArabicFontGate } from '../../ui/ArabicText';
import { Button } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { AcceptedAnswer, AnswerSummary } from '../practice/QuestionView';
import { Disclosure } from './Disclosure';

export function PracticeReview({ session }: { session: Session }) {
  const { snapshot, content, progress, command } = useApp(); const [open, setOpen] = useState<string[]>([]);
  const attempts = snapshot.attempts.filter(item => item.session_id === session.session_id);
  if (!attempts.length) return null;
  return <section><h2>{t('assessment.practice_after')}</h2>{session.question_plan.map((plan, index) => {
    const first = attempts.find(item => item.presentation_id === plan.first_presentation_id);
    if (!first) return null;
    const last = attempts.filter(item => item.question_id === plan.question_id).sort((a, b) => b.ordinal - a.ordinal)[0]!;
    const question = content.catalog.question(plan.question_id);
    const saved = snapshot.review_cards.some(card => card.question_id === question.id && card.status === 'active');
    return <details className="result-question" key={plan.question_id} open={open.includes(plan.question_id)}>
      <summary onClick={event => { event.preventDefault(); setOpen(previous => previous.includes(plan.question_id) ? previous.filter(id => id !== plan.question_id) : [...previous, plan.question_id]); }}>{index + 1} · {t(first.grade === 'correct' ? 'exercise.correct' : first.grade === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect')}</summary>
      {open.includes(plan.question_id) && <ArabicFontGate><Disclosure identity={`practice-feedback:${first.presentation_id}:${last.presentation_id}`} targets={[]} feedbackIds={[...new Set([first.presentation_id, last.presentation_id])]}>
        <p><MixedText text={question.prompt_tt} /></p><div className="question-stimulus"><MixedText text={question.stimulus} />{question.visible_context.map(context => <p key={context.id}><MixedText text={context.display_form} /></p>)}</div>
        <p>{t('attempt.first')}: <AnswerSummary answer={first.answer_raw} question={question} /> · {t(first.independent_correct ? 'exercise.independent' : 'exercise.not_independent')}</p>
        {last !== first && <p>{t('attempt.last')}: <AnswerSummary answer={last.answer_raw} question={question} /> · {t(last.grade === 'correct' ? 'exercise.correct' : last.grade === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect')}</p>}
        <p>{t('exercise.answer')}: <AcceptedAnswer question={question} /></p><p><MixedText text={question.explanation_tt} /></p>
        <Button disabled={saved || snapshot.control.writer_id !== progress.tabId} onClick={() => { void command({ type: 'review_add', question_id: question.id, origin: question.source_reading_id ? { kind: 'reading', id: question.source_reading_id } : { kind: 'lesson', id: question.lesson_id! } }).catch(() => {}); }}>{t(saved ? 'review.added' : 'review.add')}</Button>
      </Disclosure></ArabicFontGate>}
    </details>;
  })}</section>;
}
