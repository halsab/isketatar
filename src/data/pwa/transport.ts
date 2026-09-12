import { BASE_PATH } from '../../app/paths';

let pending: Promise<ServiceWorkerRegistration> | null = null;
export const transportSupported = () => import.meta.env.PROD && 'serviceWorker' in navigator && 'caches' in globalThis && globalThis.isSecureContext;
export function registerTransport() {
  return pending ??= Promise.resolve().then(() => navigator.serviceWorker.register(BASE_PATH + 'sw.js', { scope: BASE_PATH, updateViaCache: 'none' })).catch(error => { pending = null; throw error; });
}
export async function activeTransport() {
  const registering = registerTransport();
  try {
    const registration = await registering;
    if (registration.active?.state === 'activated') return registration;
    const installing = registration.installing ?? registration.waiting;
    if (!installing) throw new Error('pwa_unavailable');
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { installing.removeEventListener('statechange', change); reject(new Error('pwa_unavailable')); }, 30_000);
      const change = () => { if (installing.state === 'activated' || installing.state === 'redundant') { clearTimeout(timeout); installing.removeEventListener('statechange', change); if (installing.state === 'activated') resolve(); else reject(new Error('pwa_unavailable')); } };
      installing.addEventListener('statechange', change); change();
    });
    return registration;
  } catch (error) { if (pending === registering) pending = null; throw error; }
}
