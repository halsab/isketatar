import resources from './generated/startup-resources.json';
import { loadArabicFont } from './ui/arabic-font';

function preload(path: string) {
  const link = document.createElement('link');
  link.rel = 'preload'; link.as = 'fetch'; link.crossOrigin = 'anonymous'; link.href = path;
  document.head.append(link);
}
if (import.meta.env.PROD) preload(`${import.meta.env.BASE_URL}release-manifest.json`);
let resource: string | undefined;
let path = '';
try {
  path = decodeURIComponent(location.hash.slice(1).split('?')[0] ?? '');
  const lesson = /^\/lessons\/([^/]+)(?:\/|$)/u.exec(path)?.[1];
  if (lesson && Object.hasOwn(resources, lesson)) resource = resources[lesson as keyof typeof resources];
  else if (/^\/reading(?:\/|$)/u.test(path)) resource = 'readings.json';
  else if (/^\/dictionary(?:\/|$)/u.test(path)) resource = 'dictionary.json';
} catch { /* Некорректный URL обработает обычный router. */ }
void import('./main');
if (resource) {
  // Только предварительная загрузка: схема, hash и разрешение показа проверяются обычным путём.
  preload(`${import.meta.env.BASE_URL}runtime/${resource}`);
  void loadArabicFont();
  void import('./generated/content-validators.js').catch(() => {});
  void import('./data/progress/engine').catch(() => {});
}

if (/^\/lessons\/[^/]+$/u.test(path)) void import('./features/lessons/LessonPage').catch(() => {});
else if (/^\/reading\/[^/]+$/u.test(path)) void import('./features/reader/ReaderPage').catch(() => {});
else if (path === '/dictionary') void import('./features/dictionary/DictionaryPage').catch(() => {});
