import { SessionContent } from '../shared/SessionContent';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { Reading, ReadingLine, ReadingWord } from '../../domain/content/types';
import { readingAvailable } from '../../domain/learning/exposure';
import { ArabicFontGate, ArabicText } from '../../ui/ArabicText';
import { Button } from '../../ui/controls';
import { Dialog } from '../../ui/Dialog';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { SourceLinks } from '../shared/SourceLinks';
import { SessionHistory } from '../shared/SessionHistory';
import { SemanticPosition } from '../shared/SemanticPosition';
import { findPanelWord, wordSegments } from './words';
import { rememberReaderPanel } from './history';

type Help = Reading['help_order'][number];
interface PanelState { word: string; levels: Help[]; scroll: number; control: string | null; trigger?: string }
const ownedBases = new Map<string, { url: string; index: number }>();
function panelState(word: string): PanelState {
  const state: unknown = history.state?.iskeWord;
  if (state && typeof state === 'object' && Reflect.get(state, 'word') === word) {
    const levels: unknown = Reflect.get(state, 'levels');
    const scroll: unknown = Reflect.get(state, 'scroll'); const control: unknown = Reflect.get(state, 'control'); const trigger: unknown = Reflect.get(state, 'trigger');
    return { word, levels: Array.isArray(levels) ? levels.filter((level): level is Help => ['letters', 'rule', 'reading', 'meaning'].includes(level)) : [], scroll: typeof scroll === 'number' && Number.isFinite(scroll) ? Math.max(0, scroll) : 0, control: typeof control === 'string' ? control : null, trigger: typeof trigger === 'string' ? trigger : undefined };
  }
  return { word, levels: [], scroll: 0, control: null };
}
function savePanel(key: string, word: string, patch: Partial<PanelState>) {
  if ((history.state?.key ?? 'default') !== key) return;
  history.replaceState({ ...history.state, iskeWord: { ...panelState(word), ...patch, word } }, '');
}

function WordPanel({ reading, line, word, onClose, independent }: { reading: Reading; line: ReadingLine; word: ReadingWord; onClose: () => void; independent: boolean }) {
  const { snapshot, command, progress, confirming, content } = useApp(); const location = useLocation();
  const [saved] = useState(() => panelState(word.word_id));
  const [levels, setLevels] = useState<Help[]>(saved.levels);
  const [ready, setReady] = useState<string[]>([]);
  const disclosed = (id: string) => setReady(previous => previous.includes(id) ? previous : [...previous, id]);
  const [busy, setBusy] = useState(false);
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const bookmark = snapshot.bookmarks.find(item => item.kind === 'reading' && item.target_id === reading.id && item.position?.line_id === line.id && item.position.word_ordinal === word.ordinal);
  const labels = { letters: t('reading.show_letters'), rule: t('lesson.rule'), reading: t('reading.show_reading'), meaning: t('reading.show_meaning') };
  function toggle(level: Help) { const next = levels.includes(level) ? levels.filter(item => item !== level) : [...levels, level]; setLevels(next); savePanel(location.key, word.word_id, { levels: next }); }
  function help(level: Help): ReactNode {
    if (level === 'reading') return <p className="study-text">{word.reading_tt}</p>;
    if (level === 'meaning') return <p className="study-text">{word.meaning_tt}</p>;
    if (level === 'rule') return <p className="study-text"><MixedText text={word.explanation_tt} /></p>;
    return <ContentState identity="reader-letters" onSettled={() => disclosed('letters-content')} load={async () => { await content.load('references.json'); return content.catalog.references!; }}>{references => <ul className="letter-help">{[...new Set([...word.surface])].map((letter, index) => {
      const item = references.letters.find(item => item.base === letter); const mark = references.marks.find(item => item.text === letter);
      return <li key={index}><ArabicText letter>{letter}</ArabicText>{item ? ` — ${item.name_tt}. ${item.function_tt}` : mark ? ` — ${mark.name_tt}. ${mark.function_tt}` : null}</li>;
    })}</ul>}</ContentState>;
  }
  return <Dialog open context suspended={confirming} title={t('reading.word_details')} onClose={onClose} restoreTargetId={saved.trigger ?? location.state?.wordTrigger ?? `word:${word.word_id}`} position={saved} contentReady={ready.includes('surface') && saved.levels.every(level => independent && ['reading', 'meaning'].includes(level) || ready.includes(level) && (level !== 'letters' || ready.includes('letters-content')))} onPosition={position => savePanel(location.key, word.word_id, position)}>
    <ArabicFontGate><Disclosure identity={`word:${word.word_id}`} targets={[{ kind: 'reading_word', id: word.word_id, reading_id: reading.id, line_id: line.id }]} onDisclosed={() => disclosed('surface')}><ArabicText block>{word.surface}</ArabicText>
      {reading.help_order.map(level => <section key={level} className="word-help">
        <Button data-panel-control={level} disabled={independent && ['reading', 'meaning'].includes(level)} aria-expanded={levels.includes(level) && !(independent && ['reading', 'meaning'].includes(level))} onClick={() => toggle(level)}>{labels[level]}</Button>
        {levels.includes(level) && !(independent && ['reading', 'meaning'].includes(level)) && <Disclosure identity={`${word.word_id}:${level}`} targets={[{ kind: 'reading_word', id: word.word_id, reading_id: reading.id, line_id: line.id, level }]} onDisclosed={() => disclosed(level)}>{help(level)}</Disclosure>}
      </section>)}
      <SourceLinks ids={content.catalog.core.source_sections.filter(section => section.line_start <= line.source_lines[0] && section.line_end >= line.source_lines[1]).map(section => section.id)} context={line.id} />
      <div className="actions"><Button data-panel-control="bookmark" disabled={readonly} busy={busy} onClick={() => { setBusy(true); void command({ type: 'bookmark', kind: 'reading', target_id: reading.id, position: { line_id: line.id, line_revision: line.content_revision, word_ordinal: word.ordinal }, remove: !!bookmark }).catch(() => {}).finally(() => setBusy(false)); }}>{t(bookmark ? 'dictionary.unsave' : 'dictionary.bookmark')}</Button>
      {word.lexicon_id && <Link data-panel-control="dictionary" to={`/dictionary/${word.lexicon_id}`} state={{ reader: `${location.pathname}${location.search}`, readerKey: location.key }}>{t('nav.dictionary')}</Link>}</div>
    </Disclosure></ArabicFontGate>
  </Dialog>;
}

function Line({ line, openWord, chooseInitially }: { line: ReadingLine; openWord: (word: ReadingWord, trigger: string) => void; chooseInitially: boolean }) {
  const [choose, setChoose] = useState(chooseInitially);
  return <section className="reading-line" id={line.id} tabIndex={-1}>
    <h2 className="eyebrow">{t('reading.line', { number: Number(line.id.split('-L')[1]) })}</h2>
    <ArabicText block>{wordSegments(line).map((part, index) => part.word ? <span key={index} id={`word:${part.word.word_id}`} className="reading-word" tabIndex={-1} onClick={event => {
      if (event.detail > 1 || !window.getSelection()?.isCollapsed) return;
      event.currentTarget.focus({ preventScroll: true }); openWord(part.word!, event.currentTarget.id);
    }}>{part.text}</span> : part.text)}</ArabicText>
    <Button aria-expanded={choose} onClick={() => setChoose(value => !value)}>{t('reading.choose_word')}</Button>
    {choose && <div className="word-choices">{line.words.map(word => <Button key={word.word_id} id={`choose:${word.word_id}`} onClick={event => openWord(word, event.currentTarget.id)}><ArabicText>{word.surface}</ArabicText></Button>)}</div>}
  </section>;
}

function Reader({ reading }: { reading: Reading }) {
  const { snapshot, progress, command } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const mode = () => (history.state?.iskeReaderMode ?? location.state?.readerMode) === 'independent';
  const [independent, setIndependent] = useState(mode); const [busy, setBusy] = useState(false);
  useEffect(() => setIndependent(mode()), [location.key]);
  const selected = findPanelWord(reading, location.search);
  const query = new URLSearchParams(location.search); const baseQuery = new URLSearchParams(location.search); baseQuery.delete('panel'); baseQuery.delete('word');
  const base = `${location.pathname}${baseQuery.size ? `?${baseQuery}` : ''}`;
  useEffect(() => { if ((query.has('panel') || query.has('word')) && !selected) navigate(base, { replace: true }); }, [location.key]);
  function openWord(word: ReadingWord, trigger: string) {
    const search = new URLSearchParams(location.search); search.set('panel', 'word'); search.set('word', word.word_id);
    if (selected?.word.word_id === word.word_id) return;
    if (!selected) { ownedBases.set(location.key, { url: base, index: history.state?.idx ?? -2 }); history.replaceState({ ...history.state, iskeReaderTrigger: trigger }, ''); }
    navigate(`${location.pathname}?${search}`, { replace: !!selected, state: { wordBase: selected ? location.state?.wordBase : location.key, wordTrigger: trigger, readerMode: independent ? 'independent' : 'guided' } });
  }
  useEffect(() => { if (selected && location.state?.wordTrigger) savePanel(location.key, selected.word.word_id, { trigger: location.state.wordTrigger }); }, [location.key]);
  function close() {
    const origin = typeof location.state?.wordBase === 'string' ? ownedBases.get(location.state.wordBase) : undefined;
    if (origin?.url === base && history.state?.idx === origin.index + 1) navigate(-1); else navigate(base, { replace: true, state: { readerMode: independent ? 'independent' : 'guided', wordReturnTrigger: selected ? panelState(selected.word.word_id).trigger ?? location.state?.wordTrigger ?? `word:${selected.word.word_id}` : undefined } });
  }
  const available = readingAvailable(reading, snapshot.sessions);
  useEffect(() => { if (selected && available) rememberReaderPanel(location.key, `${location.pathname}${location.search}`, history.state?.idx ?? -2); }, [location.key, available]);
  if (!available) return <div className="document"><h1>{t('reading.title')}</h1><p>{t('reading.final_locked')}</p><Link to="/final">{t('assessment.final')}</Link></div>;
  const readonly = snapshot.control.writer_id !== progress.tabId;
  const complete = snapshot.exposures.some(item => item.kind === 'reading' && item.resource_id === reading.id && item.first_completed_at !== null);
  return <div className={selected ? 'page-grid' : 'document'}><div>
    <h1><MixedText text={reading.title_tt} /></h1><p>{t(`profile.${reading.profile}`)}</p><p>{reading.provenance.note_tt}</p><p className="study-text">{reading.instructions_tt}</p>
    <div className="reader-controls"><label>{t('reading.mode')}<select value={independent ? 'independent' : 'guided'} onChange={event => { setIndependent(event.target.value === 'independent'); history.replaceState({ ...history.state, iskeReaderMode: event.target.value }, ''); }}><option value="guided">{t('reading.guided')}</option><option value="independent">{t('reading.independent')}</option></select></label>
      <label>{t('settings.arabic_size')}<select disabled={readonly} value={snapshot.settings.arabic_size_px} onChange={event => { void command({ type: 'settings', patch: { arabic_size_px: Number(event.target.value) as 28 | 32 | 40 | 48 } }).catch(() => {}); }}>{[28, 32, 40, 48].map(size => <option key={size} value={size}>{size}</option>)}</select></label></div>
    <ArabicFontGate><Disclosure identity={`reading:${reading.id}`} targets={[{ kind: 'reading', id: reading.id }, ...reading.lines.map(line => ({ kind: 'reading_line' as const, id: line.id, line_id: line.id, reading_id: reading.id }))]}>{reading.lines.map(line => <Line key={line.id} line={line} openWord={openWord} chooseInitially={!!selected && selected.line.id === line.id && (panelState(selected.word.word_id).trigger ?? location.state?.wordTrigger)?.startsWith('choose:') === true} />)}</Disclosure></ArabicFontGate>
    <div className="actions"><Button disabled={readonly || complete} busy={busy} onClick={() => { setBusy(true); void command({ type: 'read_complete', reading_id: reading.id }).catch(() => {}).finally(() => setBusy(false)); }}>{t(complete ? 'reading.complete' : 'reading.mark_complete')}</Button><Link to={`/reading/${reading.id}/questions`}>{t('reading.questions')}</Link></div>
    {reading.role !== 'final' && <SessionHistory sessions={snapshot.sessions.filter(session => session.kind === 'reading_practice' && session.reading_ids.length === 1 && session.reading_ids[0] === reading.id)} resultPath={`/reading/${reading.id}/result`} />}
    <SourceLinks ids={reading.provenance.source_sections} />
    <p><Link to="/reading">{t('reading.title')}</Link></p>
    <SemanticPosition kind="reading" id={reading.id} revision={reading.content_revision} anchors={reading.lines.map(line => line.id)} focusAnchor={!selected} focusTargetId={history.state?.iskeReaderTrigger ?? location.state?.wordReturnTrigger} />
  </div>{selected && <WordPanel key={`${location.key}:${selected.word.word_id}:${snapshot.control.data_generation}`} reading={reading} {...selected} independent={independent} onClose={close} />}</div>;
}
function ReaderPageContent() {
  const { reading_id = '' } = useParams(); const { content } = useApp();
  if (!content.catalog.core.reading_ids.includes(reading_id)) return <Missing parent="/reading" />;
  return <ContentState identity={reading_id} load={async () => { await content.load('readings.json'); return content.catalog.readings.get(reading_id)!; }}>{reading => <Reader key={reading.id} reading={reading} />}</ContentState>;
}

export function ReaderPage() { return <SessionContent kind="reading_practice"><ReaderPageContent  /></SessionContent>; }
