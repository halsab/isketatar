import { AppRuntime } from './runtime';

export const application = new AppRuntime();
let initialStart: Promise<void> | undefined;
// Bootstrap и поздний React mount разделяют один запуск; явный retry остаётся отдельным действием.
export const startApplication = () => initialStart ??= application.start();
