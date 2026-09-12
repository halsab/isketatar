import { describe, expect, it } from 'vitest';
import { catalog, correctAnswer, fixtureSession, now } from '../../../tests/learning-fixture';
import { makeAttempt, markAssessmentHelp } from './attempt';
import { exposeQuestion, releasedVocabulary } from './exposure';

describe('assistance and exposure invariants', () => {
  it('LC-04 marks every paused or active assessment before revealing teaching material', () => {
    const final = fixtureSession(catalog.core.final_ids, 'final');
    final.session.status = 'paused';
    const diagnostic = fixtureSession(catalog.core.diagnostic_ids, 'diagnostic');
    const marked = markAssessmentHelp([final.session, diagnostic.session], now + 1);
    expect(marked.every(session => session.assessment_help_opened_at === now + 1)).toBe(true);
    expect(final.session.assessment_help_opened_at).toBeNull();
    const q = catalog.question('F-01');
    expect(makeAttempt(q, final.presentations[0]!, marked[0]!, correctAnswer(q.id), now + 2).independent_correct).toBe(false);
  });
  it('LC-26 tracks prior material separately from help and releases only linked entries', () => {
    const b = catalog.question('Q-B07-07');
    const v = catalog.question('Q-V01-07');
    const shown = exposeQuestion([], b, now);
    const before = { exposures: shown.exposures, attempts: [] };
    expect(releasedVocabulary(catalog.vocabulary.get('COURSE-EX-B07-05')!, before)).toBe(false);
    const fixture = fixtureSession([b.id]);
    const attempt = makeAttempt(b, fixture.presentations[0]!, fixture.session, correctAnswer(b.id), now + 1);
    expect(attempt.independent_correct).toBe(true);
    expect(releasedVocabulary(catalog.vocabulary.get('COURSE-EX-B07-05')!, { ...before, attempts: [attempt] })).toBe(true);
    expect(releasedVocabulary(catalog.vocabulary.get('COURSE-EX-V01-05')!, { ...before, attempts: [attempt] })).toBe(false);
    expect(exposeQuestion(shown.exposures, v, now + 2).familiarity).toEqual({ question_seen_before: false, material_seen_before: true, reading_exposed_before: true });
    const next = fixtureSession([v.id]);
    const nextAttempt = makeAttempt(v, next.presentations[0]!, next.session, correctAnswer(v.id), now + 3);
    expect(nextAttempt.independent_correct).toBe(true);
    expect(releasedVocabulary(catalog.vocabulary.get('COURSE-EX-V01-05')!, { ...before, attempts: [attempt, nextAttempt] })).toBe(true);
  });
  it('LC-29 snapshots pre-submit help and never rewrites attempts after feedback', () => {
    const q = catalog.question('Q-V04-07');
    const fixture = fixtureSession([q.id]);
    const presentation = fixture.presentations[0]!;
    presentation.assistance.hint_indices = [0];
    presentation.assistance.first_hint_at = now + 1;
    const reloaded = structuredClone(presentation);
    const attempt = makeAttempt(q, reloaded, fixture.session, correctAnswer(q.id), now + 3);
    expect(attempt).toMatchObject({ grade: 'correct', independent_correct: false, assistance_before_submit: { hint_indices: [0], first_hint_at: now + 1 } });
    const clean = fixtureSession([q.id]);
    const independent = makeAttempt(q, clean.presentations[0]!, clean.session, correctAnswer(q.id), now + 1);
    clean.presentations[0]!.assistance.answer_revealed_at = now + 2;
    expect(independent.independent_correct).toBe(true);
    expect(independent.assistance_before_submit.answer_revealed_at).toBeNull();
  });
  it('LC-30 retains line help that predates the reading question', () => {
    const q = catalog.question('RQ-01-01');
    const fixture = fixtureSession([q.id], 'reading_practice', now + 1);
    fixture.session.reading_help = [{ line_id: 'READ-01-L01', word_id: null, kind: 'reading', opened_at: now }];
    expect(makeAttempt(q, fixture.presentations[0]!, fixture.session, correctAnswer(q.id), now + 2)).toMatchObject({ grade: 'correct', independent_correct: false });
  });
  it('LC-28 never submits an old presentation against a changed question', () => {
    const q = catalog.question('RQ-F01-01');
    const fixture = fixtureSession([q.id], 'final');
    const original = structuredClone(fixture);
    expect(() => makeAttempt({ ...q, grading_revision: 'f'.repeat(64) }, fixture.presentations[0]!, fixture.session, correctAnswer(q.id), now + 1)).toThrow('incompatible_session');
    expect(fixture).toEqual(original);
  });
  it('supports explicit incomplete assessment submission without pretending an unseen question was shown', () => {
    const q = catalog.question('F-01');
    const fixture = fixtureSession([q.id], 'final');
    fixture.presentations[0]!.shown_at = null;
    expect(makeAttempt(q, fixture.presentations[0]!, fixture.session, { kind: 'unknown' }, now + 1)).toMatchObject({ grade: 'unknown', independent_correct: false, elapsed_ms: null });
    expect(() => makeAttempt(q, fixture.presentations[0]!, fixture.session, correctAnswer(q.id), now + 1)).toThrow('invalid_presentation');
  });
  it('never removes recorded reading or assessment help when the device clock moves backwards', () => {
    const q = catalog.question('RQ-01-01');
    const reading = fixtureSession([q.id], 'reading_practice', now - 1000);
    reading.session.reading_help = [{ line_id: 'READ-01-L01', word_id: null, kind: 'reading', opened_at: now }];
    expect(makeAttempt(q, reading.presentations[0]!, reading.session, correctAnswer(q.id), now - 500).independent_correct).toBe(false);
    const final = fixtureSession(['F-01'], 'final', now - 1000);
    final.session.assessment_help_opened_at = now;
    expect(makeAttempt(catalog.question('F-01'), final.presentations[0]!, final.session, correctAnswer('F-01'), now - 500).independent_correct).toBe(false);
  });
});
