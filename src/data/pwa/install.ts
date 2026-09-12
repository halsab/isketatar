interface InstallOffer extends Event { prompt(): Promise<{ outcome: string }> }
interface InstallState { canPrompt: boolean; working: boolean; standalone: boolean; installed: boolean; outcome: 'accepted' | 'dismissed' | 'failed' | null }
export class InstallController {
  private value: InstallState;
  private offer: InstallOffer | null = null;
  private used = new WeakSet<Event>();
  private listeners = new Set<() => void>();
  private version = 0;
  private media: MediaQueryList;
  constructor(private readonly browser: Window) {
    this.media = browser.matchMedia('(display-mode: standalone)');
    this.value = { canPrompt: false, working: false, standalone: this.isStandalone(), installed: false, outcome: null };
    browser.addEventListener('beforeinstallprompt', this.capture); browser.addEventListener('appinstalled', this.installed);
    this.media.addEventListener('change', this.surface);
  }
  getState = () => this.value;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<InstallState>) { this.value = { ...this.value, ...patch }; for (const listener of this.listeners) listener(); }
  private isStandalone() { return this.media.matches || Reflect.get(this.browser.navigator, 'standalone') === true; }
  private capture = (event: Event) => {
    if (this.value.standalone || this.value.installed || this.used.has(event) || typeof Reflect.get(event, 'prompt') !== 'function') return;
    event.preventDefault(); this.offer = event as InstallOffer; this.publish({ canPrompt: true, outcome: null });
  };
  private installed = () => { this.version++; this.offer = null; this.publish({ installed: true, working: false, canPrompt: false, outcome: null }); };
  private surface = () => {
    const standalone = this.isStandalone();
    if (standalone) { this.version++; this.offer = null; }
    this.publish({ standalone, ...(standalone ? { canPrompt: false, working: false, outcome: null } : {}) });
  };
  async install() {
    const offer = this.offer;
    if (!offer || this.value.working || this.value.standalone || this.value.installed) return;
    this.offer = null; this.used.add(offer); const version = this.version;
    this.publish({ canPrompt: false, working: true, outcome: null });
    try {
      // prompt вызывается в том же пользовательском событии; перед ним нет await.
      const result = await offer.prompt();
      if (version === this.version) this.publish({ outcome: result.outcome === 'accepted' || result.outcome === 'dismissed' ? result.outcome : 'failed' });
    } catch { if (version === this.version) this.publish({ outcome: 'failed' }); }
    finally { if (version === this.version) this.publish({ working: false, canPrompt: this.offer !== null }); }
  }
  dispose() { this.version++; this.browser.removeEventListener('beforeinstallprompt', this.capture); this.browser.removeEventListener('appinstalled', this.installed); this.media.removeEventListener('change', this.surface); this.listeners.clear(); this.offer = null; }
}
