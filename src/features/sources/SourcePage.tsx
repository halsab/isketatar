import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { ContentRepository } from '../../data/content/repository';
import { sourceContext } from '../../domain/content/source-context';
import { ArabicFontGate } from '../../ui/ArabicText';
import { Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';

async function loadContext(content: ContentRepository, id: string | null) {
  if (!id) return;
  if (id.startsWith('lex-') || id.startsWith('COURSE-') || id.startsWith('EX-')) {
    await content.load('dictionary.json');
    const lessonId = content.catalog.vocabulary.get(id)?.lesson_id ?? content.catalog.core.lessons.find(lesson => id.startsWith(`EX-${lesson.id}-`))?.id;
    if (lessonId) await content.lesson(lessonId);
  } else if (id.startsWith('READ-') || id.startsWith('RQ-')) await content.load('readings.json');
}
function Source({ id, contextId, invalid }: { id: string; contextId: string | null; invalid: boolean }) {
  const { content, snapshot } = useApp();
  const section = content.catalog.core.source_sections.find(section => section.id === id)!;
  const context = contextId && !invalid ? sourceContext(content.catalog, id, contextId, snapshot) : null;
  const target = context?.target;
  const targets = target ? target.kind === 'reading' ? target.line_ids.map(line_id => ({ kind: 'reading_line' as const, id: line_id, reading_id: target.id, line_id, level: 'rule' as const })) : [{ ...target, level: 'reading' as const }] : [];
  return <div className="document source-document"><h1>{t('lesson.source')}</h1><p className="study-text">{t('source.book')}</p><p>{t('source.edition')}</p><h2><MixedText text={section.title} /></h2>
    {(contextId || invalid) && !context && <Status tone="warning">{t('source.invalid_context')}</Status>}
    {context && <ArabicFontGate><Disclosure identity={`source:${id}:${contextId}`} targets={targets}>{context.rows.map(row => <section className="source-fragment" key={row.id}><p><MixedText text={row.source_form} /></p><p className="meta">{t('source.lines', { start: row.source_lines[0], end: row.source_lines[1] })}</p></section>)}<p>{t('source.line_note')}</p></Disclosure></ArabicFontGate>}
    <p>{t('source.excerpt_note')}</p><p><Link to="/reference">{t('nav.reference')}</Link></p>
  </div>;
}
export function SourcePage() {
  const { source_id = '' } = useParams(); const [query] = useSearchParams(); const { content } = useApp();
  if (!content.catalog.core.source_sections.some(section => section.id === source_id)) return <Missing parent="/reference" />;
  const values = query.getAll('context'); const contextId = values.length === 1 && values[0]!.length <= 128 ? values[0]! : null;
  const invalid = values.length > 1 || values.length === 1 && !contextId;
  return <ContentState identity={`${source_id}:${query}`} load={() => loadContext(content, contextId)}>{() => <Source id={source_id} contextId={contextId} invalid={invalid} />}</ContentState>;
}
