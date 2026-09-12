import fontUrl from '../assets/fonts/NotoNaskhArabic-Regular.woff2';

export type FontStatus = 'idle' | 'loading' | 'ready' | 'error';
let status: FontStatus = 'idle';
let expectedFace: FontFace | null = null;
const listeners = new Set<() => void>();
export const fontStatus = () => status;
export const subscribeFont = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(value: FontStatus) { status = value; for (const listener of listeners) listener(); }

export async function loadArabicFont(): Promise<void> {
  if (status === 'loading' || status === 'ready') return;
  publish('loading');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let face: FontFace | null = null;
  try {
    face = new FontFace('Noto Naskh Arabic', `url("${fontUrl}") format("woff2")`, { weight: '400', style: 'normal', display: 'block' });
    expectedFace = face;
    await Promise.race([face.load(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('font_timeout')), 15000); })]);
    document.fonts.add(face);
    const loaded = await document.fonts.load('400 32px "Noto Naskh Arabic"', 'ڭ ۋ پ چ ژ گ ىٔ ىُ ۈ ۇ وُ');
    // Проверяется конкретный face, иначе check может подтвердить один fallback.
    if (expectedFace !== face || face.status !== 'loaded' || !loaded.includes(face) || !document.fonts.check('400 32px "Noto Naskh Arabic"')) throw new Error('font_missing');
    publish('ready');
  } catch {
    if (face) document.fonts.delete(face);
    expectedFace = null;
    publish('error');
  } finally { clearTimeout(timer); }
}
