import { expect, it, vi } from 'vitest';
import { InstallController } from './install';
function fixture(standalone = false) {
  const events = new EventTarget(); const media = Object.assign(new EventTarget(), { matches: standalone });
  const browser = Object.assign(events, { navigator: {}, matchMedia: () => media }) as unknown as Window;
  const controller = new InstallController(browser);
  const offer = (prompt = vi.fn(async () => ({ outcome: 'dismissed' }))) => { const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt }); events.dispatchEvent(event); return { event, prompt }; };
  return { controller, events, media, offer };
}
it('offers a browser prompt only after its event and consumes that event once', async () => {
  const f = fixture(); expect(f.controller.getState().canPrompt).toBe(false);
  f.events.dispatchEvent(new Event('beforeinstallprompt')); expect(f.controller.getState().canPrompt).toBe(false);
  const first = f.offer(); expect(first.event.defaultPrevented).toBe(true);
  await Promise.all([f.controller.install(), f.controller.install()]); expect(first.prompt).toHaveBeenCalledOnce();
  expect(f.controller.getState()).toMatchObject({ canPrompt: false, outcome: 'dismissed' });
  f.events.dispatchEvent(first.event); await f.controller.install(); expect(first.prompt).toHaveBeenCalledOnce();
  const second = f.offer(vi.fn(async () => ({ outcome: 'accepted' }))); await f.controller.install(); expect(second.prompt).toHaveBeenCalledOnce();
  expect(f.controller.getState()).toMatchObject({ installed: false, outcome: 'accepted' }); f.controller.dispose();
});
it('does not replace a confirmed installation with a late dismissed prompt result', async () => {
  const f = fixture(); let resolve!: (value: { outcome: string }) => void;
  f.offer(vi.fn(() => new Promise(done => { resolve = done; }))); const pending = f.controller.install();
  f.events.dispatchEvent(new Event('appinstalled')); resolve({ outcome: 'dismissed' }); await pending;
  expect(f.controller.getState()).toMatchObject({ installed: true, canPrompt: false, working: false, outcome: null }); f.controller.dispose();
});
it('reports only the current standalone surface and hides its install offer', async () => {
  const f = fixture(true); f.offer(); expect(f.controller.getState()).toMatchObject({ standalone: true, canPrompt: false });
  f.media.matches = false; f.media.dispatchEvent(new Event('change')); expect(f.controller.getState().standalone).toBe(false);
  f.offer(); expect(f.controller.getState().canPrompt).toBe(true); f.controller.dispose();
});
it('keeps failed installation retry dependent on a fresh browser event', async () => {
  const f = fixture(); const offer = f.offer(vi.fn(async () => { throw new Error('denied'); })); await f.controller.install();
  expect(f.controller.getState()).toMatchObject({ outcome: 'failed', canPrompt: false, working: false }); await f.controller.install(); expect(offer.prompt).toHaveBeenCalledOnce(); f.controller.dispose();
});
