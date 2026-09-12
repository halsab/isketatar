import { SessionContent } from '../shared/SessionContent';
import { Link, useParams } from 'react-router-dom';
import { useState } from 'react';
import { useApp } from '../../app/AppProvider';
import type { Example, Lesson } from '../../domain/content/types';
import { ArabicFontGate, ArabicText } from '../../ui/ArabicText';
import { MixedText } from '../../ui/MixedText';
import { Button } from '../../ui/controls';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { SemanticPosition } from '../shared/SemanticPosition';
import { BookmarkButton } from '../shared/BookmarkButton';
import { SourceLinks } from '../shared/SourceLinks';
import { SessionHistory } from '../shared/SessionHistory';

function Examples({ examples }: { examples: Example[] }) {
  const { content } = useApp();
  return examples.map(example => <article className="lesson-example" id={example.id} key={example.id}>
    <ArabicText block>{example.display_form}</ArabicText>
    <dl className="example-details">{example.reading_tt && <><dt>{t('example.reading')}</dt><dd>{example.reading_tt}</dd></>}<dt>{t('example.meaning')}</dt><dd>{example.meaning_tt}</dd></dl>
    <p><MixedText text={example.explanation_tt} /></p>{example.reading_note_tt && <p>{example.reading_note_tt}</p>}
    {example.status === 'authored' && <p className="meta">{t('example.authored')}</p>}
    <p className="meta">{t(`profile.${example.profile}`)}</p><SourceLinks ids={content.catalog.core.source_sections.filter(section => section.line_start <= example.source_lines[0] && section.line_end >= example.source_lines[1]).map(section => section.id)} context={example.id} />
  </article>);
}
function LessonDocument({ lesson }: { lesson: Lesson }) {
  const { content, snapshot } = useApp(); const [extra, setExtra] = useState(false);
  const examples = lesson.examples.filter(example => example.usage === 'demonstration');
  const references = lesson.examples.filter(example => example.usage === 'reference');
  return <div className="document lesson-document"><h1><MixedText text={lesson.title_tt} /></h1><p><Link to="/lessons">{t('course.all_lessons')}</Link></p>
    <BookmarkButton kind="lesson" id={lesson.id} />
    <Disclosure identity={`lesson:${lesson.id}`} targets={[{ kind: 'lesson', id: lesson.id }]}>
      <SemanticPosition kind="lesson" id={lesson.id} revision={lesson.content_revision} anchors={[`${lesson.id}:goals`, `${lesson.id}:theory`, ...lesson.rules.map(rule => rule.id), ...examples.map(example => example.id), `${lesson.id}:pitfalls`, `${lesson.id}:outcomes`]} />
      <section id={`${lesson.id}:goals`}><h2>{t('lesson.goal')}</h2><ul>{lesson.goals_tt.map(text => <li key={text}><MixedText text={text} /></li>)}</ul></section>
      {!!lesson.prerequisites.length && <p>{t('lesson.prerequisites')}: {lesson.prerequisites.map(id => <Link key={id} to={`/lessons/${id}`}><MixedText text={content.catalog.core.lessons.find(item => item.id === id)!.title_tt} /> </Link>)}</p>}
      <nav className="chapter-contents" aria-label={t('lesson.contents')}>{[[`${lesson.id}:theory`, 'lesson.theory'], ...(examples[0] ? [[examples[0].id, 'lesson.examples']] : []), [`${lesson.id}:pitfalls`, 'lesson.pitfalls'], [`${lesson.id}:outcomes`, 'lesson.outcome']].map(([id, label]) => <Link key={id} to={`?at=${encodeURIComponent(id!)}`}>{t(label as Parameters<typeof t>[0])}</Link>)}</nav>
      <p><Link className="button primary" to={`/lessons/${lesson.id}/practice`}>{t('lesson.practice')}</Link></p>
      <SessionHistory sessions={snapshot.sessions.filter(session => session.kind === 'lesson_cycle' && session.lesson_id === lesson.id)} resultPath={`/lessons/${lesson.id}/result`} />
      <section id={`${lesson.id}:theory`} className="study-text"><h2>{t('lesson.theory')}</h2>{lesson.theory_tt.map(text => <p key={text}><MixedText text={text} /></p>)}</section>
      {lesson.rules.map(rule => <section className="rule-block study-text" id={rule.id} key={rule.id}><h2><Link to={`/reference/rules/${rule.id}`}>{t('lesson.rule')}</Link></h2><p><MixedText text={rule.statement_tt} /></p><p className="muted"><MixedText text={rule.scope_tt} /></p></section>)}
      <section id={`${lesson.id}:examples`}><h2>{t('lesson.examples')}</h2><ArabicFontGate><Disclosure identity={`examples:${lesson.id}`} targets={examples.flatMap(example => [{ kind: 'example' as const, id: example.id, level: 'reading' as const }, { kind: 'example' as const, id: example.id, level: 'meaning' as const }])}><Examples examples={examples} /></Disclosure></ArabicFontGate></section>
      {!!references.length && <><Button aria-expanded={extra} onClick={() => setExtra(value => !value)}>{t('lesson.extra_examples')}</Button>{extra && <ArabicFontGate><Disclosure identity={`references:${lesson.id}`} targets={references.flatMap(example => [{ kind: 'example' as const, id: example.id, level: 'reading' as const }, { kind: 'example' as const, id: example.id, level: 'meaning' as const }])}><Examples examples={references} /></Disclosure></ArabicFontGate>}</>}
      <section id={`${lesson.id}:pitfalls`}><h2>{t('lesson.pitfalls')}</h2><ul>{lesson.pitfalls_tt.map(text => <li key={text}><MixedText text={text} /></li>)}</ul></section>
      <section id={`${lesson.id}:outcomes`}><h2>{t('lesson.outcome')}</h2><ul>{lesson.outcomes_tt.map(text => <li key={text}><MixedText text={text} /></li>)}</ul></section>
      {lesson.letter_groups && <div className="rule-block"><ArabicText block>{lesson.letter_groups.sun.join(' · ')}</ArabicText><ArabicText block>{lesson.letter_groups.moon.join(' · ')}</ArabicText></div>}
      {!!lesson.component_inventory.length && <dl>{lesson.component_inventory.map(component => <div key={component.form}><dt><ArabicText>{component.form}</ArabicText></dt><dd>{component.function_tt}</dd></div>)}</dl>}
      <section className="source-card"><h2>{t('lesson.source')}</h2>{lesson.source_sections.map(id => <p key={id}><Link to={`/sources/${id}`}><MixedText text={content.catalog.core.source_sections.find(section => section.id === id)!.title} /></Link></p>)}{lesson.external_sources.map(source => <p key={source.url}><a href={source.url} rel="noreferrer">{source.supports_tt}</a> {t('about.external_link')}</p>)}</section>
      <p><Link className="button primary" to={`/lessons/${lesson.id}/practice`}>{t('lesson.practice')}</Link></p>
    </Disclosure>
  </div>;
}
function LessonPageContent() {
  const { lesson_id = '' } = useParams(); const { content } = useApp();
  if (!content.catalog.core.lessons.some(lesson => lesson.id === lesson_id)) return <Missing />;
  return <ContentState pageTitle={t('nav.lessons')} identity={lesson_id} load={() => content.lesson(lesson_id)}>{lesson => <LessonDocument key={lesson.id} lesson={lesson} />}</ContentState>;
}

export function LessonPage() { return <SessionContent kind="lesson_cycle"><LessonPageContent  /></SessionContent>; }
