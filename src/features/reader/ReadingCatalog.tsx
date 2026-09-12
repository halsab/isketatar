import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { Reading } from '../../domain/content/types';
import { readingAvailable } from '../../domain/learning/exposure';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState } from '../shared/ContentState';

function Catalog({ readings }: { readings: Reading[] }) {
  const { snapshot, content } = useApp();
  const bookmarks = snapshot.bookmarks.filter(item => item.kind === 'reading');
  return <div className="reading-catalog"><h1>{t('reading.title')}</h1>
    {!!bookmarks.length && <section><h2>{t('reading.saved')}</h2><ul>{bookmarks.map(bookmark => {
      const reading = readings.find(reading => reading.id === bookmark.target_id);
      if (!reading || !readingAvailable(reading, snapshot.sessions)) return null;
      const line = reading.lines.find(line => line.id === bookmark.position?.line_id);
      const word = line?.content_revision === bookmark.position?.line_revision && bookmark.position?.word_ordinal !== null ? line?.words.find(word => word.ordinal === bookmark.position?.word_ordinal) : null;
      const search = new URLSearchParams(); if (line) search.set('at', line.id); if (word) { search.set('panel', 'word'); search.set('word', word.word_id); }
      return <li key={bookmark.bookmark_key}><Link to={`/reading/${reading.id}${search.size ? `?${search}` : ''}`}><MixedText text={reading.title_tt} />{line && ` · ${t('reading.line', { number: Number(line.id.split('-L')[1]) })}`}</Link></li>;
    })}</ul></section>}
    {['guided', 'practice', 'final'].map(role => <section key={role}><h2>{t(role === 'final' ? 'reading.final_review' : role === 'guided' ? 'reading.guided' : 'reading.ordinary')}</h2>{[...new Set(readings.filter(reading => reading.role === role).map(reading => reading.level))].sort((a, b) => a - b).map(level => <section key={level}><h3>{t('reading.level', { number: level })}</h3><div className="reading-grid">{readings.filter(reading => reading.role === role && reading.level === level).map(reading => {
      const available = readingAvailable(reading, snapshot.sessions);
      const complete = snapshot.exposures.some(item => item.kind === 'reading' && item.resource_id === reading.id && item.first_completed_at !== null);
      const position = snapshot.resume_positions.find(item => item.kind === 'reading' && item.target_id === reading.id);
      return <article key={reading.id} className="reading-card"><h4><Link to={available ? `/reading/${reading.id}` : '/final'}><MixedText text={reading.title_tt} /></Link></h4>
        {available ? <><p>{t(reading.provenance.kind === 'authored' ? 'reading.authored' : 'reading.book_excerpt')}</p><p>{t(`profile.${reading.profile}`)}</p>{complete && <p className="status-label">{t('reading.complete')}</p>}{position && <p><Link to={`/reading/${reading.id}${position.anchor_id ? `?at=${encodeURIComponent(position.anchor_id)}` : ''}`}>{t('reading.resume')}</Link></p>}<details><summary>{t('lesson.prerequisites')}</summary><ul>{reading.lesson_ids.map(id => <li key={id}><Link to={`/lessons/${id}`}><MixedText text={content.catalog.core.lessons.find(lesson => lesson.id === id)!.title_tt} /></Link></li>)}</ul></details></> : <p>{t('reading.final_locked')}</p>}
      </article>;
    })}</div></section>)}</section>)}
  </div>;
}
export function ReadingCatalog() {
  const { content } = useApp();
  return <ContentState identity="reading-catalog" load={async () => { await content.load('readings.json'); return content.catalog.core.reading_ids.map(id => content.catalog.readings.get(id)!); }}>{readings => <Catalog readings={readings} />}</ContentState>;
}
