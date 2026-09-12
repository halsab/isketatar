import { createHashRouter, Link, Outlet, RouterProvider } from 'react-router-dom';
import { RecoveryBoundary } from './RecoveryBoundary';
import { AppShell } from './AppShell';
import { AppProvider, RuntimeStatus } from './AppProvider';
import { StartPage } from '../features/onboarding/StartPage';
import { NavigationGuard } from './NavigationGuard';
import { t } from '../ui/copy';
import { Button } from '../ui/controls';

function Layout() { return <AppProvider><NavigationGuard /><AppShell status={<RuntimeStatus />}><Outlet /></AppShell></AppProvider>; }
function RouteFailure() { return <main><h1>{t('error.load')}</h1><Button onClick={() => location.reload()}>{t('offline.retry')}</Button><p><Link to="/settings">{t('nav.settings')}</Link></p></main>; }
const router = createHashRouter([{ element: <Layout />, errorElement: <RouteFailure />, children: [
  { path: '/', lazy: async () => ({ Component: (await import('../features/course/CoursePage')).HomePage }) },
  { path: '/start', element: <div className="document"><StartPage /></div> },
  { path: '/lessons', lazy: async () => ({ Component: (await import('../features/course/CoursePage')).CoursePage }) },
  { path: '/lessons/:lesson_id', lazy: async () => ({ Component: (await import('../features/lessons/LessonPage')).LessonPage }) },
  { path: '/lessons/:lesson_id/practice', lazy: async () => ({ Component: (await import('../features/practice/PracticePage')).PracticePage }) },
  { path: '/lessons/:lesson_id/result/:session_id', lazy: async () => ({ Component: (await import('../features/practice/PracticePage')).ResultPage }) },
  { path: '/reading/:reading_id', lazy: async () => ({ Component: (await import('../features/reader/ReaderPage')).ReaderPage }) },
  { path: '/dictionary/:entry_id', lazy: async () => ({ Component: (await import('../features/dictionary/EntryPage')).EntryPage }) },
  { path: '/about', element: <div className="document"><h1>Курс турында</h1><p>Аңлатмалар хәзерге татар телендә бирелә.</p><Link to="/">Баш бит</Link></div> },
  { path: '*', element: <div className="document"><h1>Бу бүлек табылмады</h1><Link to="/">Баш бит</Link></div> },
] }]);
export function App() { return <RecoveryBoundary><RouterProvider router={router} /></RecoveryBoundary>; }
