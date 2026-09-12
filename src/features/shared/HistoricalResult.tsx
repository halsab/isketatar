import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { AnswerValue, Session } from '../../domain/learning/types';
import { Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { Disclosure } from './Disclosure';

export function HistoricalResult({ session, backTo }: { session: Session; backTo: string }) {
  const { snapshot } = useApp();
  const attempts = snapshot.attempts.filter(item => item.session_id === session.session_id);
  const first = session.question_plan.flatMap(item => attempts.filter(attempt => attempt.presentation_id === item.first_presentation_id));
  const practice = first.filter(attempt => session.question_plan.some(item => item.first_presentation_id === attempt.presentation_id && item.assessment_role === 'practice'));
  const transfer = first.filter(attempt => session.question_plan.some(item => item.first_presentation_id === attempt.presentation_id && item.assessment_role === 'transfer'));
  // В сохранённой схеме 1 диагностика содержит восемь script перед десятью imla.
  const scriptIds = new Set(session.question_plan.slice(0, 8).map(item => item.question_id));
  const script = first.filter(attempt => scriptIds.has(attempt.question_id));
  const imla = first.filter(attempt => !scriptIds.has(attempt.question_id) && attempt.answer_raw.kind !== 'unknown');
  const visible = session.kind === 'diagnostic' && session.diagnostic_imla_deferred ? script : first;
  const answer = (value: AnswerValue) => value.kind === 'text' || value.kind === 'segments' ? <MixedText text={value.text} /> : t(value.kind === 'unknown' ? 'exercise.unsure' : 'history.original_options');
  const grade = (value: string) => t(value === 'correct' ? 'exercise.correct' : value === 'unknown' ? 'exercise.unsure' : 'exercise.incorrect');
  return <div className="document"><h1>{t('assessment.result')}</h1><Status tone="warning"><p>{t('history.previous_version', { version: session.content_version })}</p><p>{t('update.needs_refresh')}</p></Status>
    {session.assessment_help_opened_at !== null && <Status tone="warning">{t('assessment.assisted_note')}</Status>}
    {session.kind === 'diagnostic' ? <><p>{t('diagnostic.script')}: {t('assessment.score', { correct: script.filter(attempt => attempt.grade === 'correct').length, total: scriptIds.size })}</p>{script.some(attempt => attempt.answer_raw.kind === 'unknown') && <Status tone="warning">{t('diagnostic.incomplete')}</Status>}{session.diagnostic_imla_deferred ? <Status>{t('diagnostic.imla_deferred')}</Status> : imla.length ? <p>{t('diagnostic.imla')}: {t('assessment.score', { correct: imla.filter(attempt => attempt.grade === 'correct').length, total: imla.length })}</p> : <p>{t('diagnostic.imla_unanswered')}</p>}</> : <p>{t('assessment.score', { correct: first.filter(attempt => attempt.grade === 'correct').length, total: session.question_plan.length })}</p>}
    {session.kind === 'lesson_cycle' && <><p>{t('lesson.practice')}: {t('assessment.score', { correct: practice.filter(attempt => attempt.independent_correct).length, total: session.question_plan.filter(item => item.assessment_role === 'practice').length })}</p><p>{t('lesson.transfer')}: {t('assessment.score', { correct: transfer.filter(attempt => attempt.independent_correct).length, total: session.question_plan.filter(item => item.assessment_role === 'transfer').length })}</p></>}
    <p><Link className="button primary" to={backTo}>{t('assessment.new_attempt')}</Link></p>
    <Disclosure identity={`historical:${session.session_id}`} targets={[{ kind: 'reference', id: 'rules' }]}>{visible.map((attempt, index) => {
      const last = attempts.filter(item => item.question_id === attempt.question_id).sort((a, b) => b.ordinal - a.ordinal)[0]!;
      return <details className="result-question" key={attempt.presentation_id}><summary>{t('exercise.question_count', { current: index + 1, total: visible.length })} · {grade(attempt.grade)}</summary><p>{t('attempt.first')}: {answer(attempt.answer_raw)}</p>{last.ordinal > 1 && <p>{t('attempt.last')}: {answer(last.answer_raw)} · {grade(last.grade)}</p>}</details>;
    })}</Disclosure>
  </div>;
}
