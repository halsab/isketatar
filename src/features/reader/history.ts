const panels = new Map<string, { url: string; index: number }>();
export function rememberReaderPanel(key: string, url: string, index: number) { panels.set(key, { url, index }); }
export function ownsReaderReturn(key: unknown, url: unknown, index: number): boolean {
  const saved = typeof key === 'string' ? panels.get(key) : undefined;
  return saved !== undefined && saved.url === url && index === saved.index + 1;
}
export function readerAddress(value: unknown, ids: string[]): value is string {
  if (typeof value !== 'string') return false;
  const [path, query] = value.split('?');
  const id = path?.match(/^\/reading\/([^/]+)$/u)?.[1];
  if (!id || !ids.includes(id)) return false;
  const params = new URLSearchParams(query);
  return params.getAll('panel').length === 1 && params.get('panel') === 'word' && params.getAll('word').length === 1 && new RegExp(`^${id}-L[0-9]{2}:[0-9]+$`, 'u').test(params.get('word') ?? '');
}
