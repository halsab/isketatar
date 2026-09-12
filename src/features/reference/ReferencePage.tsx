import { Link, useParams } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { releasedExample } from '../../domain/learning/exposure';
import type { Letter, References } from '../../domain/content/types';
import { ArabicFontGate, ArabicText } from '../../ui/ArabicText';
import { Table } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState, Missing } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { SemanticPosition } from '../shared/SemanticPosition';
import { SourceLinks } from '../shared/SourceLinks';
import { BookmarkButton } from '../shared/BookmarkButton';

type Section = 'letters' | 'rules' | 'profiles' | 'terms';
const indexAnchorReady = (element: HTMLElement) => element.id !== 'rules' || !!element.querySelector('.rule-list');
function Position({ id, anchors, index = false }: { id: string; anchors: string[]; index?: boolean }) {
  const { content } = useApp();
  return <SemanticPosition kind="reference" id={id} revision={content.assets.find(asset => asset.url.endsWith('/runtime/references.json'))!.sha256} anchors={anchors} isReady={index ? indexAnchorReady : undefined} />;
}
function LessonLink({ id }: { id: string }) {
  const { content } = useApp(); const lesson = content.catalog.core.lessons.find(lesson => lesson.id === id)!;
  return <Link to={`/lessons/${id}`}><MixedText text={lesson.title_tt} /></Link>;
}
function LetterCard({ letter, link = false }: { letter: Letter; link?: boolean }) {
  return <article className="letter-card" id={letter.id}><h2>{link ? <Link to={`/reference/letters/${letter.id}`}>{letter.name_tt}</Link> : letter.name_tt}</h2>
    <ArabicText letter>{letter.base}</ArabicText><dl className="letter-forms">{(['isolated', 'initial', 'medial', 'final'] as const).map(form => <div key={form}><dt>{t(`reference.${form}`)}</dt><dd><ArabicText letter>{letter.forms[form]}</ArabicText></dd></div>)}</dl>
    <p><MixedText text={letter.function_tt} /></p><p>{letter.joins_previous && t('reference.joins_previous')} {t(letter.joins_following ? 'reference.joins_following' : 'reference.no_join_following')}</p>
    {!link && <SourceLinks ids={letter.source_sections} />}
  </article>;
}
function Letters({ references, id }: { references: References; id?: string }) {
  const letters = id ? references.letters.filter(letter => letter.id === id) : references.letters;
  if (!letters.length) return <Missing parent="/reference/letters" />;
  return <div className={id ? 'document' : 'reference-catalog'}><h1 id="letters">{t('reference.letters')}</h1><p><Link to={id ? '/reference/letters' : '/reference'}>{t(id ? 'reference.letters' : 'nav.reference')}</Link></p>
    <ArabicFontGate><Disclosure identity={`letters:${id ?? 'all'}`} targets={[{ kind: 'reference', id: 'letters' }]}>
      <Position id={id ?? 'letters'} anchors={['letters', ...letters.map(letter => letter.id)]} />
      {references.letter_notes_tt.map(note => <p key={note}><MixedText text={note} /></p>)}
      <div className="letter-grid">{letters.map(letter => <LetterCard key={letter.id} letter={letter} link={!id} />)}</div>
      {!id && <><section><h2>{t('reference.ligatures')}</h2>{references.ligatures.map(item => <p key={item.text}><ArabicText>{item.text}</ArabicText> · {item.name_tt} · {item.components.map((part, index) => <ArabicText key={index}>{part}</ArabicText>)}</p>)}</section><section><h2>{t('reference.marks')}</h2>{references.marks.map(item => <p key={item.text}><ArabicText letter>{item.text}</ArabicText> · {item.name_tt} · <MixedText text={item.function_tt} /></p>)}</section></>}
    </Disclosure></ArabicFontGate>
  </div>;
}
function Index({ references }: { references: References }) {
  const { content, snapshot } = useApp();
  return <div className="document reference-index"><h1>{t('nav.reference')}</h1><nav className="chapter-contents">{(['letters', 'rules', 'profiles', 'terms'] as const).map(id => <Link key={id} to={`?at=${id}`}>{t(`reference.${id}`)}</Link>)}</nav>
    <Position id="rules" index anchors={['letters', 'profiles', 'terms', 'rules']} />
    <section id="letters"><h2>{t('reference.letters')}</h2><Link to="/reference/letters">{t('reference.letters')} · {references.letters.length}</Link></section>
    <section id="profiles"><h2>{t('reference.profiles')}</h2><ul>{references.profiles.map(profile => <li key={profile.id}><Link to={`/reference/profiles/${profile.id}`}>{profile.title_tt}</Link></li>)}</ul></section>
    <section id="terms"><h2>{t('reference.terms')}</h2><ul>{references.terms.map(term => <li key={term.id}><Link to={`/reference/terms/${term.id}`}>{term.term_tt}</Link></li>)}</ul></section>
    <section id="rules"><h2>{t('reference.rules')}</h2><ArabicFontGate><Disclosure identity="rules:index" targets={[{ kind: 'reference', id: 'rules' }]}>{content.catalog.core.modules.map(module => <section key={module.id}><h3><MixedText text={module.title_tt} /></h3><ul className="rule-list">{module.lesson_ids.flatMap(id => content.catalog.lessons.get(id)!.rules).map(rule => <li key={rule.id}><Link to={`/reference/rules/${rule.id}`}><MixedText text={rule.statement_tt} /></Link>{snapshot.bookmarks.some(bookmark => bookmark.kind === 'rule' && bookmark.target_id === rule.id) && <span className="meta"> · {t('bookmark.saved')}</span>}</li>)}</ul></section>)}</Disclosure></ArabicFontGate></section>
  </div>;
}
function Detail({ section, id, references }: { section: Exclude<Section, 'letters'>; id: string; references: References }) {
  const { content, snapshot } = useApp();
  const rule = section === 'rules' ? content.catalog.rules.get(id) : undefined;
  const profile = section === 'profiles' ? references.profiles.find(profile => profile.id === id) : undefined;
  const term = section === 'terms' ? references.terms.find(term => term.id === id) : undefined;
  if (!rule && !profile && !term) return <Missing parent="/reference" />;
  const examples = [...new Set(rule?.question_ids.flatMap(id => content.catalog.question(id).source_example_ids) ?? [])].flatMap(id => { const example = content.catalog.examples.get(id); return example && releasedExample(example, content.catalog, snapshot) ? [example] : []; });
  const table = profile?.id === references.vowel_table.profile ? references.vowel_table : null;
  return <div className="document reference-detail"><h1>{profile?.title_tt ?? term?.term_tt ?? t('lesson.rule')}</h1><p><Link to={`/reference?at=${section}`}>{t(`reference.${section}`)}</Link></p>
    <ArabicFontGate><Disclosure identity={`reference:${id}`} targets={[rule ? { kind: 'rule', id } : { kind: 'reference', id: section }]}>
      <Position id={id} anchors={[id]} />
      <section id={id}>
        {rule && <><p className="study-text"><MixedText text={rule.statement_tt} /></p><p><MixedText text={rule.scope_tt} /></p><BookmarkButton kind="rule" id={id} /><p><LessonLink id={rule.lesson_id} /></p><p><Link to={`/lessons/${rule.lesson_id}/practice`}>{t('lesson.practice')} · {rule.question_ids.length}</Link></p><SourceLinks ids={rule.source_sections} />{!!examples.length && <section><h2>{t('lesson.examples')}</h2><Disclosure identity={`rule-examples:${id}`} targets={examples.flatMap(example => [{ kind: 'example' as const, id: example.id, level: 'reading' as const }, { kind: 'example' as const, id: example.id, level: 'meaning' as const }])}>{examples.map(example => <article className="lesson-example" key={example.id}><ArabicText block>{example.display_form}</ArabicText>{example.reading_tt && <p>{t('example.reading')}: {example.reading_tt}</p>}<p>{t('example.meaning')}: <MixedText text={example.meaning_tt} /></p>{example.status === 'authored' && <p>{t('example.authored')}</p>}</article>)}</Disclosure></section>}</>}
        {term && <><p className="study-text"><MixedText text={term.definition_tt} /></p><p><LessonLink id={term.lesson_id} /></p></>}
        {profile && <><p className="study-text"><MixedText text={profile.description_tt} /></p><ArabicText block>{profile.base_vowel_signs.join(' · ')}</ArabicText><p><MixedText text={references.comparison_note_tt} /></p><SourceLinks ids={profile.source_sections} /></>}
        {table && <><h2>{table.title_tt}</h2><p><MixedText text={table.note_tt} /></p><Table caption={table.title_tt}><thead><tr>{(['sound', 'initial', 'medial', 'final', 'note'] as const).map(label => <th scope="col" key={label}>{t(`reference.${label}`)}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}><th scope="row">{row.sound_tt}</th><td><ArabicText>{row.initial}</ArabicText></td><td><ArabicText>{row.medial}</ArabicText></td><td>{row.final === null ? '—' : <ArabicText>{row.final}</ArabicText>}</td><td><MixedText text={row.note_tt} /><ul>{row.lesson_ids.map(id => <li key={id}><LessonLink id={id} /></li>)}</ul></td></tr>)}</tbody></Table></>}
      </section>
    </Disclosure></ArabicFontGate>
  </div>;
}
export function ReferencePage({ section }: { section?: Section }) {
  const params = useParams(); const id = params.letter_id ?? params.rule_id ?? params.profile_id ?? params.term_id;
  const { content } = useApp();
  return <ContentState identity={`reference:${section}:${id}`} load={async () => {
    const resources = !section ? [...new Set(content.catalog.core.lessons.map(lesson => lesson.resource))] : section === 'rules' ? content.catalog.core.lessons.filter(lesson => id?.startsWith(`R-${lesson.id}-`)).map(lesson => lesson.resource) : [];
    await Promise.all(['references.json', ...(section === 'rules' ? ['dictionary.json'] : []), ...resources].map(resource => content.load(resource)));
    return content.catalog.references!;
  }}>{references => section === 'letters' ? <Letters key={id ?? 'all'} references={references} id={id} /> : section && id ? <Detail key={id} section={section} id={id} references={references} /> : <Index references={references} />}</ContentState>;
}
