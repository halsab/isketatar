let pending: { url: string; started: boolean; promise: Promise<unknown>; cancel: () => void } | null = null;

export function preloadManifest(worker: ServiceWorker, id: string, url: string) {
  if (pending) return;
  const channel = new MessageChannel();
  let cancel!: () => void;
  const entry = { url, started: false, promise: new Promise<unknown>((resolve, reject) => {
    const finish = () => { clearTimeout(timeout); channel.port1.close(); };
    cancel = () => { finish(); reject(new Error('content_unavailable')); };
    const timeout = setTimeout(cancel, 45_000);
    channel.port1.onmessage = event => {
      if (event.data?.started === true) { entry.started = true; return; }
      finish();
      if (event.data?.error || !event.data?.manifest) reject(new Error('content_unavailable'));
      else resolve(event.data.manifest);
    };
  }), cancel: () => cancel() };
  pending = entry;
  void entry.promise.catch(() => {});
  try { worker.postMessage({ type: 'preload-manifest', release_id: id }, [channel.port2]); }
  catch { cancel(); }
}
export function takePreloadedManifest(url: string) {
  const entry = pending; pending = null;
  if (!entry) return null;
  // Старый/неготовый worker не задерживает обычный сетевой bootstrap ожиданием нового протокола.
  if (entry.url !== url || !entry.started) { entry.cancel(); return null; }
  return entry.promise;
}
