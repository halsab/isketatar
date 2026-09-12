import { createHashRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { RecoveryBoundary } from './RecoveryBoundary';
import { AppShell } from './AppShell';
import { AppProvider, RuntimeStatus } from './AppProvider';
import { StartPage } from '../features/onboarding/StartPage';
import { NavigationGuard } from './NavigationGuard';
import { t } from '../ui/copy';
import { Button, Status } from '../ui/controls';
import { useState } from 'react';
import { useApp } from './AppProvider';

function RouteBody() {
  const { state } = useApp(); const [composing, setComposing] = useState(false);
  return <div inert={!!state.quiescing && !composing} onCompositionStartCapture={() => setComposing(true)} onCompositionEndCapture={() => setComposing(false)}><Outlet /></div>;
}
function Layout() { return <AppProvider><NavigationGuard /><AppShell status={<RuntimeStatus />}><RouteBody /></AppShell></AppProvider>; }
function RouteFailure() { return <main><h1>{t('error.load')}</h1><Button onClick={() => location.reload()}>{t('offline.retry')}</Button><p><Link to="/settings">{t('nav.settings')}</Link></p></main>; }
async function assessmentRoute(kind: 'diagnostic' | 'final', result = false) {
  const { AssessmentPage, AssessmentResultPage } = await import('../features/assessments/AssessmentPage');
  return { Component: () => result ? <AssessmentResultPage kind={kind} /> : <AssessmentPage kind={kind} /> };
}
function RouteLoading() { return <main className="boot-main"><h1>{t('app.name')}</h1><Status announce>{t('boot.loading')}</Status></main>; }
const router = createHashRouter([{ element: <Layout />, HydrateFallback: RouteLoading, errorElement: <RouteFailure />, children: [
  { path: '/', lazy: async () => ({ Component: (await import('../features/course/CoursePage')).HomePage }) },
  { path: '/start', element: <div className="document"><StartPage /></div> },
  { path: '/lessons', lazy: async () => ({ Component: (await import('../features/course/CoursePage')).CoursePage }) },
  { path: '/lessons/:lesson_id', lazy: async () => ({ Component: (await import('../features/lessons/LessonPage')).LessonPage }) },
  { path: '/lessons/:lesson_id/practice', lazy: async () => ({ Component: (await import('../features/practice/PracticePage')).PracticePage }) },
  { path: '/lessons/:lesson_id/result/:session_id', lazy: async () => ({ Component: (await import('../features/practice/PracticePage')).ResultPage }) },
  { path: '/reading', lazy: async () => ({ Component: (await import('../features/reader/ReadingCatalog')).ReadingCatalog }) },
  { path: '/reading/:reading_id', lazy: async () => ({ Component: (await import('../features/reader/ReaderPage')).ReaderPage }) },
  { path: '/reading/:reading_id/questions', lazy: async () => ({ Component: (await import('../features/reader/ReadingQuestionsPage')).ReadingQuestionsPage }) },
  { path: '/reading/:reading_id/result/:session_id', lazy: async () => { const { ReadingQuestionsPage } = await import('../features/reader/ReadingQuestionsPage'); return { Component: () => <ReadingQuestionsPage result /> }; } },
  { path: '/dictionary', lazy: async () => ({ Component: (await import('../features/dictionary/DictionaryPage')).DictionaryPage }) },
  { path: '/dictionary/:entry_id', lazy: async () => ({ Component: (await import('../features/dictionary/EntryPage')).EntryPage }) },
  ...['/review', '/review/session/:session_id'].map(path => ({ path, lazy: async () => ({ Component: (await import('../features/review/ReviewPage')).ReviewPage }) })),
  { path: '/diagnostic', lazy: () => assessmentRoute('diagnostic') },
  { path: '/diagnostic/result/:session_id', lazy: () => assessmentRoute('diagnostic', true) },
  { path: '/final', lazy: () => assessmentRoute('final') },
  { path: '/final/result/:session_id', lazy: () => assessmentRoute('final', true) },
  { path: '/reference', lazy: async () => ({ Component: (await import('../features/reference/ReferencePage')).ReferencePage }) },
  ...(['letters', 'rules', 'profiles', 'terms'] as const).flatMap(section => {
    const parameter = { letters: 'letter_id', rules: 'rule_id', profiles: 'profile_id', terms: 'term_id' }[section];
    const lazy = async () => { const { ReferencePage } = await import('../features/reference/ReferencePage'); return { Component: () => <ReferencePage section={section} /> }; };
    return [...(section === 'letters' ? [{ path: '/reference/letters', lazy }] : []), { path: `/reference/${section}/:${parameter}`, lazy }];
  }),
  { path: '/sources/:source_id', lazy: async () => ({ Component: (await import('../features/sources/SourcePage')).SourcePage }) },
  { path: '/settings', lazy: async () => ({ Component: (await import('../features/settings/SettingsPage')).SettingsPage }) },
  { path: '/settings/backup', lazy: async () => ({ Component: (await import('../features/settings/BackupPage')).BackupPage }) },
  { path: '/about', lazy: async () => ({ Component: (await import('../features/settings/AboutPage')).AboutPage }) },
  { path: '*', element: <div className="document"><h1>{t('error.not_found')}</h1><Link to="/lessons">{t('nav.lessons')}</Link></div> },
] }]);
export function App() { return <RecoveryBoundary><RouterProvider router={router} /></RecoveryBoundary>; }
