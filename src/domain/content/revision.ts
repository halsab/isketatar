import { canonical, normalizeReading } from './canonical.ts';
import { POLICIES } from './types.ts';
import type { Question } from './types.ts';

export function gradingPayload(question: Question): string {
  const answers = question.grading === 'segments'
    ? question.accepted_answers.map(answer => answer.split('+').map(normalizeReading))
    : question.grading === 'tt_reading' ? question.accepted_answers.map(normalizeReading) : question.accepted_answers;
  const keys = [...new Set(answers.map(canonical))].sort().map(key => JSON.parse(key) as unknown);
  return canonical({
    type: question.type, grading: question.grading, prompt_tt: question.prompt_tt,
    stimulus: question.stimulus, profile: question.profile,
    options: [...question.options].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    accepted_answers: keys, grading_policy: POLICIES.grading, normalization_policy: POLICIES.normalization,
    allow_terminal_punctuation: question.allow_terminal_punctuation,
    source_reading_id: question.source_reading_id, line_ids: question.line_ids,
    visible_context: question.visible_context,
  });
}
