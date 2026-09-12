import './app/installation';
import { activeTransport, transportSupported } from './data/pwa/transport';
import { preloadManifest } from './data/pwa/manifest-preload-client';
import resources from './generated/startup-resources.json';
import { loadArabicFont } from './ui/arabic-font';

// Регистрация транспорта не принимает курс; manifest/роль проверяются штатным bootstrap перед progress IDB.
if (transportSupported()) void activeTransport().then(registration => {
  const own = /^\/isketatar\/releases\/(\d+\.\d+\.\d+-[a-f0-9]{16})\/$/u.exec(import.meta.env.BASE_URL)?.[1];
  if (own && registration.active) preloadManifest(registration.active, own, `${import.meta.env.BASE_URL}release-manifest.json`);
}).catch(() => {});

function preload(path: string, priority: 'auto' | 'high' | 'low' = 'auto') {
  const link = document.createElement('link');
  link.rel = 'preload'; link.as = 'fetch'; link.crossOrigin = 'anonymous'; link.href = path;
  link.fetchPriority = priority;
  document.head.append(link);
}
if (import.meta.env.PROD && !transportSupported()) preload(`${import.meta.env.BASE_URL}release-manifest.json`);
let resource: string | undefined;
let path = '';
try {
  path = decodeURIComponent(location.hash.slice(1).split('?')[0] ?? '');
  const lesson = /^\/lessons\/([^/]+)(?:\/|$)/u.exec(path)?.[1];
  if (lesson && Object.hasOwn(resources, lesson)) resource = resources[lesson as keyof typeof resources];
  else if (/^\/reading(?:\/|$)/u.test(path)) resource = 'readings.json';
  else if (/^\/dictionary(?:\/|$)/u.test(path)) resource = 'dictionary-entries.json';
} catch { /* Некорректный URL обработает обычный router. */ }
void import('./app/application').then(({ startApplication }) => startApplication());
const renderer = import('./main');
if (resource) {
  // Только предварительная загрузка: схема, hash и разрешение показа проверяются обычным путём.
  preload(`${import.meta.env.BASE_URL}runtime/${resource}`, 'high');
  void renderer.then(() => loadArabicFont());
  if (resource.startsWith('module-')) void import('./generated/module-validator.js').catch(() => {});
  else if (resource === 'readings.json') void import('./generated/readings-validator.js').catch(() => {});
  else if (resource === 'dictionary-entries.json') void import('./generated/dictionary-validator.js').catch(() => {});
  void import('./data/progress/engine').catch(() => {});
}

if (['', '/', '/lessons'].includes(path)) void import('./features/course/CoursePage').catch(() => {});
else if (path === '/start') void import('./features/onboarding/StartPage').catch(() => {});
else if (/^\/lessons\/[^/]+$/u.test(path)) void import('./features/lessons/LessonPage').catch(() => {});
else if (/^\/reading\/[^/]+$/u.test(path)) void import('./features/reader/ReaderPage').catch(() => {});
else if (path === '/dictionary') void import('./features/dictionary/DictionaryPage').catch(() => {});
