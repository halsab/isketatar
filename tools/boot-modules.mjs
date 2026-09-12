export const initialModules = ['src/main.tsx', 'src/app/bootstrap.ts', 'src/data/pwa/client.ts', 'src/features/settings/UpdateStatus.tsx'];
// Главная, программа и выбор пути сохраняются в shell; их preload выбирается по начальному hash.
export const bootModules = [...initialModules, 'src/features/course/CoursePage.tsx', 'src/features/onboarding/StartPage.tsx'];
