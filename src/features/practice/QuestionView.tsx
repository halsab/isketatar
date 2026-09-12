import type { AnswerValue } from '../../domain/learning/types';
import type { Question } from '../../domain/content/types';
import { ChoiceGroup } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { TextAnswer } from '../../ui/TextAnswer';
import { ArabicText } from '../../ui/ArabicText';
import { t } from '../../ui/copy';

export function AnswerSummary({ answer, question }: { answer: AnswerValue; question: Question }) {
  const text = answer.kind === 'unknown' ? t('exercise.unsure') : answer.kind === 'option' ? question.options.find(option => option.id === answer.option_id)?.text_tt ?? '' : answer.kind === 'set' ? answer.option_ids.map(id => question.options.find(option => option.id === id)?.text_tt ?? '').join(' · ') : answer.text;
  return <MixedText text={text} />;
}
export function AcceptedAnswer({ question }: { question: Question }) {
  return <MixedText text={question.accepted_answers.map(answer => question.options.find(option => option.id === answer)?.text_tt ?? answer).join(' · ')} />;
}
export function QuestionView({ question, identity, optionOrder, answer, disabled, onChange, onEnter, composition, error }: {
  question: Question; identity: string; optionOrder: string[]; answer: AnswerValue | null; disabled: boolean;
  onChange: (answer: AnswerValue, immediate?: boolean) => void; onEnter: () => void; composition: (active: boolean) => void; error?: string;
}) {
  return <>
    <h2 className="question-prompt" tabIndex={-1}><MixedText text={question.prompt_tt} /></h2>
    <div className="question-stimulus"><MixedText text={question.stimulus} /></div>
    {question.visible_context.map(context => <p key={context.id}><ArabicText block>{context.display_form}</ArabicText></p>)}
    {question.type === 'choice' || question.type === 'select_many' ? <ChoiceGroup label={t(`exercise.${question.type}`)} multiple={question.type === 'select_many'} disabled={disabled}
      options={optionOrder.map(id => ({ id, content: <MixedText text={question.options.find(option => option.id === id)!.text_tt} /> }))}
      selected={answer?.kind === 'option' ? [answer.option_id] : answer?.kind === 'set' ? answer.option_ids : []}
      onChange={ids => onChange(question.type === 'choice' ? { kind: 'option', option_id: ids[0]! } : { kind: 'set', option_ids: ids }, true)} /> :
      <TextAnswer identity={identity} value={answer?.kind === 'text' || answer?.kind === 'segments' ? answer.text : ''} segment={question.type === 'segment'} disabled={disabled} error={error}
        onChange={text => onChange({ kind: question.type === 'segment' ? 'segments' : 'text', text })} onEnter={onEnter} onCompositionChange={composition} />}
    {error && (question.type === 'choice' || question.type === 'select_many') && <p role="alert">{error}</p>}
  </>;
}
