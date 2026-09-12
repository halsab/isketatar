export interface SearchQuery { q: string; saved: boolean; expanded: boolean }
export function parseSearch(search: string): SearchQuery {
  const query = new URLSearchParams(search);
  return { q: query.getAll('q').length === 1 ? query.get('q')! : '', saved: query.getAll('scope').length === 1 && query.get('scope') === 'saved', expanded: query.getAll('expanded').length === 1 && query.get('expanded') === '1' };
}
export function searchAddress(value: SearchQuery): string {
  const query = new URLSearchParams();
  if (value.q) query.set('q', value.q); if (value.saved) query.set('scope', 'saved'); if (value.expanded) query.set('expanded', '1');
  return query.size ? `?${query}` : '';
}
export interface SearchPosition { search: string; limit: number; open: string[]; scroll: number; focus: string | null }
export function searchPosition(value: unknown, search: string): SearchPosition {
  const empty = { search, limit: 30, open: [], scroll: 0, focus: null };
  if (!value || typeof value !== 'object' || Reflect.get(value, 'search') !== search) return empty;
  const limit: unknown = Reflect.get(value, 'limit'); const open: unknown = Reflect.get(value, 'open'); const scroll: unknown = Reflect.get(value, 'scroll'); const focus: unknown = Reflect.get(value, 'focus');
  return { search, limit: typeof limit === 'number' && Number.isSafeInteger(limit) ? Math.max(30, Math.min(1000, limit)) : 30,
    open: Array.isArray(open) ? open.filter((id): id is string => typeof id === 'string' && id.length <= 128).slice(0, 1000) : [],
    scroll: typeof scroll === 'number' && Number.isFinite(scroll) ? Math.max(0, Math.min(1e7, scroll)) : 0, focus: typeof focus === 'string' && focus.length <= 128 ? focus : null };
}
const pages = new Map<string, { url: string; index: number }>();
export function rememberSearch(key: string, url: string, index: number) { pages.set(key, { url, index }); }
export function ownsSearchReturn(key: unknown, url: string, index: number) { const saved = typeof key === 'string' ? pages.get(key) : undefined; return saved?.url === url && saved.index + 1 === index; }
export function dictionaryAddress(value: unknown): value is string {
  if (typeof value !== 'string' || value.split('?')[0] !== '/dictionary') return false;
  const search = value.slice('/dictionary'.length);
  return searchAddress(parseSearch(search)) === search;
}
