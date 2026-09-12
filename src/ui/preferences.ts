import type { Settings } from '../data/progress/model';

export function applyPreferences(settings: Pick<Settings, 'theme' | 'text_size_px' | 'arabic_size_px' | 'reduced_motion'>) {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.textSize = String(settings.text_size_px);
  root.dataset.arabicSize = String(settings.arabic_size_px);
  root.dataset.motion = settings.reduced_motion;
}
