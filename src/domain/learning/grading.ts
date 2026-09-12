import { canonical, normalizeReading } from '../content/canonical';
import type { Question } from '../content/types';
import type { AnswerValue, Grade, NormalizedAnswer } from './types';

export function isAnswerValue(value: unknown, question: Question): value is AnswerValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const kind: unknown = Reflect.get(value, 'kind');
  const keys = Object.keys(value).sort().join(',');
  if (kind === 'unknown') return keys === 'kind';
  if (kind === 'option' && question.type === 'choice' && keys === 'kind,option_id') return question.options.some(option => option.id === Reflect.get(value, 'option_id'));
  if (kind === 'set' && question.type === 'select_many' && keys === 'kind,option_ids') {
    const ids: unknown = Reflect.get(value, 'option_ids');
    return Array.isArray(ids) && ids.length <= question.options.length && new Set(ids).size === ids.length && ids.every(id => typeof id === 'string' && question.options.some(option => option.id === id));
  }
  if ((kind === 'text' && question.type === 'reading' || kind === 'segments' && question.type === 'segment') && keys === 'kind,text') {
    const text: unknown = Reflect.get(value, 'text');
    return typeof text === 'string' && text.length <= 4096 && !/\p{Cc}/u.test(text);
  }
  return false;
}
export function canSubmit(question: Question, answer: AnswerValue | null): boolean {
  if (!isAnswerValue(answer, question)) return false;
  if (answer.kind === 'text' || answer.kind === 'segments') return normalizeReading(answer.text).length > 0;
  return answer.kind !== 'set' || answer.option_ids.length > 0;
}
function normalizeText(text: string, question: Question) {
  const normalized = normalizeReading(text);
  return question.allow_terminal_punctuation ? normalized.replace(/[.!?]+$/u, '') : normalized;
}
export function gradeAnswer(question: Question, answer: AnswerValue): { grade: Grade; answer_normalized: NormalizedAnswer } {
  if (!isAnswerValue(answer, question)) throw new Error('invalid_answer');
  if (answer.kind === 'unknown') return { grade: 'unknown', answer_normalized: null };
  let normalized: NormalizedAnswer;
  let correct: boolean;
  if (answer.kind === 'option') {
    normalized = answer.option_id;
    correct = question.accepted_answers.includes(normalized);
  } else if (answer.kind === 'set') {
    normalized = [...answer.option_ids].sort();
    correct = canonical(normalized) === canonical([...question.accepted_answers].sort());
  } else if (answer.kind === 'segments') {
    normalized = answer.text.split('+').map(normalizeReading);
    correct = normalized.every(part => part.length > 0) && question.accepted_answers.some(key => canonical(key.split('+').map(normalizeReading)) === canonical(normalized));
  } else {
    normalized = normalizeText(answer.text, question);
    correct = question.accepted_answers.some(key => normalizeText(key, question) === normalized);
  }
  return { grade: correct ? 'correct' : 'incorrect', answer_normalized: normalized };
}
