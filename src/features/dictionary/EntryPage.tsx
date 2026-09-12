import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { DictionaryEntry, Vocabulary } from '../../domain/content/types';
import { releasedVocabulary } from '../../domain/learning/exposure';
import { ArabicFontGate, ArabicText } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { ownsReaderReturn, readerAddress } from '../reader/history';

function Entry({ entry }: { entry: DictionaryEntry | Vocabulary }) {
  const { snapshot, progress, command, content } = useApp(); const location = useLocation(); const navigate = useNavigate();
  if ('release' in entry && !releasedVocabulary(entry, snapshot)) return <div className="document"><h1>{t('nav.dictionary')}</h1><p>{t('dictionary.course_locked')}</p><Link to={`/lessons/${entry.lesson_id}`}>{t('lesson.theory')}</Link></div>;
  const saved = snapshot.bookmarks.some(item => item.kind === 'dictionary' && item.target_id === entry.id);
  const reader: unknown = location.state?.reader;
  const fromReader = readerAddress(reader, content.catalog.core.reading_ids);
  const sourceLine = 'source' in entry ? entry.source.line : entry.source_lines[0];
  const section = content.catalog.core.source_sections.find(item => item.line_start <= sourceLine && item.line_end >= sourceLine);
  return <div className="document"><h1>{t('nav.dictionary')}</h1><ArabicFontGate><Disclosure identity={`dictionary:${entry.id}`} targets={[{ kind: 'dictionary_entry', id: entry.id, level: 'reading' }, { kind: 'dictionary_entry', id: entry.id, level: 'meaning' }]}>
    <ArabicText block>{entry.display_form}</ArabicText><p>{t(`profile.${entry.profile}`)}</p>
    {entry.reading_tt === null ? <Status>{t('dictionary.no_reading')}</Status> : <h2>{entry.reading_tt}</h2>}
    <p className="study-text"><MixedText text={entry.meaning_tt} /></p>
    {'eligibility' in entry && <>{entry.eligibility.tier === 'reference' && <Status>{t('dictionary.reference_only')}</Status>}{entry.forms.map((form, index) => <p key={index}><ArabicText>{form.form}</ArabicText>{form.reading_tt === null ? null : ` — ${form.reading_tt}`}</p>)}{entry.editorial_notes_tt.map((note, index) => <p key={index}><MixedText text={note} /></p>)}</>}
    <Button disabled={snapshot.control.writer_id !== progress.tabId} onClick={() => { void command({ type: 'bookmark', kind: 'dictionary', target_id: entry.id, position: null, remove: saved }).catch(() => {}); }}>{t(saved ? 'dictionary.unsave' : 'dictionary.bookmark')}</Button>
    {section && <section className="source-card"><h2>{t('dictionary.source_note')}</h2><p>{section.title}</p><Link to={`/sources/${section.id}?context=${entry.id}`}>{t('lesson.source')}</Link></section>}
  </Disclosure></ArabicFontGate>
    <p>{fromReader ? <Button onClick={() => { if (ownsReaderReturn(location.state?.readerKey, reader, history.state?.idx ?? -2)) navigate(-1); else navigate(reader, { replace: true }); }}>{t('dictionary.return_to_text')}</Button> : <Link to="/dictionary">{t('action.back')}</Link>}</p>
  </div>;
}
export function EntryPage() {
  const { entry_id = '' } = useParams(); const { content } = useApp();
  return <ContentState identity={entry_id} load={async () => { await content.load('dictionary.json'); return content.catalog.lexicon.get(entry_id) ?? content.catalog.vocabulary.get(entry_id) ?? null; }}>{entry => entry ? <Entry key={entry.id} entry={entry} /> : <Missing parent="/dictionary" />}</ContentState>;
}
