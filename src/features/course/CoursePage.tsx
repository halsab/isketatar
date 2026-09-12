import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import { courseProgress } from '../../domain/learning/progress';
import type { Session } from '../../domain/learning/types';
import { MixedText } from '../../ui/MixedText';
import { Status } from '../../ui/controls';
import { t } from '../../ui/copy';
import { ContentState } from '../shared/ContentState';

function useCourse() {
  const app = useApp();
  const route = app.snapshot.settings.selected_route;
  const course = useMemo(() => courseProgress(app.content.catalog.core, route ?? 'arabic_reader', app.snapshot), [app.content, app.snapshot, route]);
  const unfinished = app.snapshot.sessions.filter(session => ['active', 'paused'].includes(session.status)).sort((a, b) => b.updated_at - a.updated_at || b.session_id.localeCompare(a.session_id));
  return { ...app, course, route, unfinished };
}
function sessionAddress(session: Session) {
  if (session.kind === 'lesson_cycle') return `/lessons/${session.lesson_id}/practice`;
  if (session.kind === 'reading_practice') return `/reading/${session.reading_ids[0]}/questions`;
  if (session.kind === 'review') return `/review/session/${session.session_id}`;
  return `/${session.kind}`;
}
function SessionTitle({ session }: { session: Session }) {
  const { content } = useApp();
  const readingId = session.kind === 'reading_practice' ? session.reading_ids[0] : undefined;
  const [readingTitle, setReadingTitle] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (readingId) void content.load('readings.json').then(() => { if (current) setReadingTitle(content.catalog.readings.get(readingId)?.title_tt ?? null); }).catch(() => {});
    return () => { current = false; };
  }, [content, readingId]);
  if (session.lesson_id) return <MixedText text={content.catalog.core.lessons.find(lesson => lesson.id === session.lesson_id)?.title_tt ?? t('lesson.theory')} />;
  if (session.kind === 'reading_practice') return <MixedText text={readingTitle ?? t('reading.title')} />;
  return t(session.kind === 'diagnostic' ? 'diagnostic.title' : session.kind === 'final' ? 'assessment.final' : 'review.title');
}
function CourseSummary({ course }: { course: ReturnType<typeof courseProgress> }) {
  const route = course.route;
  const refreshCount = route.required_lesson_ids.filter(id => course.lessons.get(id)?.needs_refresh).length;
  return <section className="course-progress" aria-label={t('settings.progress')}>
    <p>{t('lesson.practiced')}: <strong>{t('lesson.progress', { completed: route.practiced_count, total: route.required_lesson_ids.length })}</strong></p>
    <progress aria-label={t('lesson.practiced')} value={route.practiced_count} max={route.required_lesson_ids.length} />
    <p>{t('lesson.mastered')}: {t('lesson.progress', { completed: route.mastered_count, total: route.required_lesson_ids.length })}</p>
    {refreshCount > 0 && <Status tone="warning"><p>{t('course.refresh_count', { count: refreshCount })}</p><p>{t('update.needs_refresh')}</p><Link to="/lessons">{t('course.all_lessons')}</Link></Status>}
    {route.completed && <p>{t('route.completed_detail')}</p>}
    {course.latest_final && <p>{t('assessment.final')}: <Link to={`/final/result/${course.latest_final.session.session_id}`}>{t(course.latest_final.score.passed ? 'assessment.passed' : 'assessment.review_needed')}</Link>{course.latest_final.session.assessment_help_opened_at !== null && <> {t('assessment.assisted_note')}</>}</p>}
  </section>;
}

export function HomePage() {
  const { snapshot, content, course, route, unfinished } = useCourse();
  const current = unfinished[0]; const next = course.route.next_lesson_id;
  const due = snapshot.review_cards.filter(card => card.status === 'active' && card.due_at <= Date.now()).length;
  const activeQuestion = snapshot.presentations.find(presentation => presentation.presentation_id === current?.active_presentation_id)?.question_id;
  const pendingQuestion = current?.question_plan.findIndex(item => item.question_id === activeQuestion) ?? -1;
  return <div className="page-grid"><div><h1>{t('app.name')}</h1><p className="study-text">{t('app.tagline')}</p>
    {current ? <section className="home-continuation"><p>{t('home.continue')}</p><h2><SessionTitle session={current} /></h2><p>{t('session.existing_draft')}</p><p>{t('exercise.question_count', { current: Math.max(1, pendingQuestion + 1), total: current.question_plan.length })}</p><Link className="button primary" to={sessionAddress(current)}>{t('action.continue')}</Link></section> : !route ? <section className="home-continuation"><p>{t('onboarding.intro')}</p><Link className="button primary" to="/start">{t('onboarding.choose_route')}</Link><p><Link to="/diagnostic">{t('onboarding.diagnostic')}</Link></p></section> : <section className="home-continuation"><h2><MixedText text={next ? content.catalog.core.lessons.find(lesson => lesson.id === next)!.title_tt : t(course.route.final_completed ? 'reading.title' : 'assessment.final')} /></h2><Link className="button primary" to={next ? `/lessons/${next}` : course.route.final_completed ? '/reading' : '/final'}>{t('action.continue')}</Link></section>}
    {unfinished.length > 1 && <details><summary>{t('home.started')}</summary><ul>{unfinished.slice(1).map(session => <li key={session.session_id}><Link to={sessionAddress(session)}><SessionTitle session={session} /></Link></li>)}</ul></details>}
    </div><aside>
    {route && <CourseSummary course={course} />}
    <p><Link to="/review">{t('review.due', { count: due })}</Link></p><p><Link to="/reading">{t('reading.title')}</Link></p><p><Link to="/lessons">{t('course.all_lessons')}</Link></p>
  </aside></div>;
}

export function CoursePage() {
  const { content, course, route, unfinished } = useCourse();
  const core = content.catalog.core;
  const currentId = unfinished.find(session => session.lesson_id)?.lesson_id ?? course.route.next_lesson_id;
  const currentModule = core.lessons.find(lesson => lesson.id === currentId)?.module_id ?? core.modules[0]!.id;
  const [open, setOpen] = useState(() => new Set([currentModule]));
  return <div className="document"><h1>{t('course.all_lessons')}</h1>
    {route ? <><p>{t(route === 'arabic_reader' ? 'onboarding.arabic_known' : 'onboarding.arabic_new')}</p><CourseSummary course={course} /></> : <Status><Link to="/start">{t('onboarding.choose_route')}</Link></Status>}
    <p><Link to="/start">{t('onboarding.change_route')}</Link></p>
    {core.modules.map(module => {
      const required = module.lesson_ids.filter(id => course.route.required_lesson_ids.includes(id));
      const optional = route === 'arabic_reader' && !required.length;
      const done = required.filter(id => ['practiced', 'mastered'].includes(course.lessons.get(id)!.state)).length;
      return <details className="course-module" data-module={module.id} key={module.id} open={open.has(module.id)} onToggle={event => {
        const expanded = event.currentTarget.open; setOpen(previous => { if (previous.has(module.id) === expanded) return previous; const next = new Set(previous); if (expanded) next.add(module.id); else next.delete(module.id); return next; });
      }}><summary><span>{module.title_tt}</span><span className="meta">{optional ? t('lesson.optional') : route ? t('lesson.progress', { completed: done, total: required.length }) : null}</span></summary>
        {open.has(module.id) && <ContentState identity={module.id} load={async () => { await content.load(core.lessons.find(lesson => lesson.module_id === module.id)!.resource); return module.lesson_ids.map(id => content.catalog.lessons.get(id)!); }}>{lessons => <ol className="course-lessons">{lessons.map(lesson => {
          const progress = course.lessons.get(lesson.id)!;
          const prior = lesson.prerequisites.find(id => !['practiced', 'mastered'].includes(course.lessons.get(id)?.state ?? 'not_started'));
          return <li className="course-lesson" key={lesson.id}><h3><Link to={`/lessons/${lesson.id}`}><MixedText text={lesson.title_tt} /></Link></h3><p className="study-text"><MixedText text={lesson.goals_tt[0] ?? ''} /></p><p className="meta">{t(`lesson.${progress.state}`)}{optional ? ` · ${t('lesson.optional')}` : ''}</p>{progress.needs_refresh && <p>{t('update.needs_refresh')}</p>}
            {prior && <p className="meta"><MixedText text={t('lesson.recommended_first', { lesson: core.lessons.find(item => item.id === prior)!.title_tt })} /> <Link to={`/lessons/${prior}`}>{t('lesson.theory')}</Link></p>}
            <Link className="button" to={`/lessons/${lesson.id}`}>{t('lesson.open_anyway')}</Link>
            {progress.latest_completed_session_id && <p><Link to={`/lessons/${lesson.id}/result/${progress.latest_completed_session_id}`}>{t('assessment.result')}</Link></p>}
          </li>;
        })}</ol>}</ContentState>}
      </details>;
    })}
    <div className="actions"><Link to="/diagnostic">{t('onboarding.diagnostic')}</Link><Link to="/final">{t('assessment.final')}</Link></div>
  </div>;
}
