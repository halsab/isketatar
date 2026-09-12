import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';

export function SourceLinks({ ids, context }: { ids: string[]; context?: string }) {
  const { content } = useApp();
  if (!ids.length) return null;
  return <section className="source-card"><h2>{t('lesson.source')}</h2>{ids.map(id => {
    const section = content.catalog.core.source_sections.find(section => section.id === id);
    return section ? <p key={id}><Link data-panel-control={`source:${id}`} to={`/sources/${id}${context ? `?context=${encodeURIComponent(context)}` : ''}`}><MixedText text={section.title} /></Link></p> : null;
  })}</section>;
}
