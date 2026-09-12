import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useApp } from '../../app/AppProvider';
import type { DictionaryEntry, Vocabulary } from '../../domain/content/types';
import { DictionaryIndex, groupResults, QUERY_LIMIT, tatarCompare, type SearchResult } from '../../domain/learning/search';
import { ArabicFontGate, ArabicText } from '../../ui/ArabicText';
import { Button, Status } from '../../ui/controls';
import { MixedText } from '../../ui/MixedText';
import { t } from '../../ui/copy';
import { ContentState } from '../shared/ContentState';
import { Disclosure } from '../shared/Disclosure';
import { parseSearch, searchAddress, searchPosition, rememberSearch, type SearchPosition, type SearchQuery } from './search-state';

function Dictionary() {
  const { content, snapshot } = useApp(); const location = useLocation(); const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [query, setQuery] = useState(() => parseSearch(location.search)); const address = searchAddress(query);
  const locationAddress = searchAddress(parseSearch(location.search));
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [settled, setSettled] = useState(address);
  const [view, setView] = useState(() => searchPosition(history.state?.iskeDictionary ?? location.state?.dictionaryState, address));
  const savedView = useRef(view); const restored = useRef<string | null>(null); const resultsElement = useRef<HTMLDivElement>(null);
  const current = view.search === address ? view : searchPosition(null, address);
  if (savedView.current.search !== address) savedView.current = current;
  const cancelDebounce = () => { if (debounce.current) clearTimeout(debounce.current); debounce.current = null; };
  function restoreQuery(search: string, state: unknown) {
    cancelDebounce(); const next = parseSearch(search); const address = searchAddress(next);
    const position = searchPosition(state, address);
    setQuery(next); setSettled(address); setView(position); savedView.current = position; restored.current = null;
  }
  useLayoutEffect(() => {
    if (navigationType !== 'POP') return;
    restoreQuery(location.search, history.state?.iskeDictionary ?? location.state?.dictionaryState);
  }, [location, navigationType]);
  useEffect(() => {
    // Быстрый Back может отменить ещё не отрисованный переход с тем же location.key.
    const pop = () => {
      const target = window.location.hash.slice(1);
      if (target === '/dictionary' || target.startsWith('/dictionary?')) restoreQuery(target.slice('/dictionary'.length), history.state?.iskeDictionary ?? history.state?.usr?.dictionaryState);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => { if (location.search !== locationAddress) navigate(`/dictionary${locationAddress}`, { replace: true, state: location.state }); }, [location.search, locationAddress]);
  useEffect(() => {
    if (address === locationAddress) { setSettled(address); return; }
    debounce.current = setTimeout(() => { setSettled(address); navigate(`/dictionary${address}`, { replace: true }); }, 250);
    return cancelDebounce;
  }, [address, locationAddress]);
  const accessKey = useMemo(() => {
    const lessons = new Set(snapshot.exposures.filter(item => item.kind === 'lesson').map(item => item.resource_id));
    const questions = new Set([...snapshot.attempts.map(item => item.question_id), ...snapshot.exposures.filter(item => item.kind === 'question' && item.first_answer_exposed_at !== null).map(item => item.resource_id)]);
    return [...content.catalog.vocabulary.values()].filter(entry => entry.release === 'with_lesson' ? lessons.has(entry.lesson_id) : entry.question_ids.some(id => questions.has(id))).map(entry => entry.id).join('|');
  }, [content, snapshot.exposures, snapshot.attempts]);
  const entries = useMemo(() => new Map<string, DictionaryEntry | Vocabulary>([...content.catalog.lexicon.entries(), ...accessKey.split('|').filter(Boolean).map(id => [id, content.catalog.vocabulary.get(id)!] as const)]), [content, accessKey]);
  const index = useMemo(() => new DictionaryIndex([...entries.values()].filter((entry): entry is DictionaryEntry => 'eligibility' in entry), [...entries.values()].filter((entry): entry is Vocabulary => 'release' in entry)), [entries]);
  const savedIds = new Set(snapshot.bookmarks.filter(bookmark => bookmark.kind === 'dictionary').map(bookmark => bookmark.target_id));
  const tooLong = [...query.q].length > QUERY_LIMIT;
  const pending = address !== settled;
  const results: SearchResult[] = tooLong || pending ? [] : query.q.trim() ? index.search(query.q, { expanded: query.expanded, limit: 1000 }) : [...entries.values()].sort((a, b) => tatarCompare(a.reading_tt ?? a.display_form, b.reading_tt ?? b.display_form) || tatarCompare(a.display_form, b.display_form) || tatarCompare(a.id, b.id)).map(entry => ({ id: entry.id, kind: 'release' in entry ? 'vocabulary' : 'dictionary', tier: 'prefix' }));
  const groups = groupResults(results.filter(result => !query.saved || savedIds.has(result.id)), entries);
  const visible = groups.slice(0, current.limit);
  const category = (tier: SearchResult['tier']) => tier === 'near' ? 'dictionary.expanded_matches' : tier.startsWith('meaning_') ? 'dictionary.meaning_matches' : 'dictionary.matches';
  function persist(patch: Partial<SearchPosition>) {
    const next = { ...savedView.current, ...patch, search: address }; savedView.current = next;
    if (address === locationAddress && (history.state?.key ?? 'default') === location.key) history.replaceState({ ...history.state, iskeDictionary: next }, '');
    return next;
  }
  function change(patch: Partial<SearchQuery>) {
    const nextQuery = { ...query, ...patch }; const next = searchAddress(nextQuery);
    if (next === address) return;
    persist({ scroll: scrollY }); cancelDebounce();
    setQuery(nextQuery); setView(searchPosition(null, next)); restored.current = null;
    if (patch.saved !== undefined || patch.expanded !== undefined || patch.q === '' && query.q !== '') {
      setSettled(next); navigate(`/dictionary${next}`);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }
  function submit() {
    cancelDebounce(); setSettled(address);
    if (address !== locationAddress) navigate(`/dictionary${address}`);
  }
  useEffect(() => {
    if (address === locationAddress) rememberSearch(location.key, `/dictionary${address}`, history.state?.idx ?? -2);
    const save = () => { if (restored.current === location.key && address === locationAddress) persist({ scroll: scrollY }); };
    window.addEventListener('scroll', save, { passive: true });
    return () => window.removeEventListener('scroll', save);
  }, [address, location.key, locationAddress]);
  function restore() {
    if (address !== locationAddress || restored.current === location.key || resultsElement.current?.querySelectorAll('.dictionary-group').length !== visible.length) return;
    restored.current = location.key;
    const position = current;
    requestAnimationFrame(() => {
      if ((history.state?.key ?? 'default') !== location.key) return;
      window.scrollTo({ top: position.scroll, behavior: 'instant' });
      if (position.focus) Array.from(resultsElement.current?.querySelectorAll<HTMLAnchorElement>('a[data-result-id]') ?? []).find(link => link.dataset.resultId === position.focus)?.focus({ preventScroll: true });
    });
  }
  function sourceLabel(entry: DictionaryEntry | Vocabulary) {
    return 'release' in entry ? content.catalog.core.lessons.find(lesson => lesson.id === entry.lesson_id)!.title_tt : content.catalog.core.source_sections.find(section => section.line_start <= entry.source.line && section.line_end >= entry.source.line)?.title ?? t('dictionary.source_note');
  }
  function openEntry(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); const position = persist({ scroll: scrollY, focus: id });
    navigate(`/dictionary/${id}`, { state: { dictionary: `/dictionary${address}`, dictionaryKey: location.key, dictionaryState: position } });
  }
  return <div className="document dictionary-catalog"><h1>{t('nav.dictionary')}</h1>
    <form role="search" onSubmit={event => { event.preventDefault(); submit(); }}><label htmlFor="dictionary-query">{t('dictionary.placeholder')}</label><input id="dictionary-query" type="search" dir="auto" value={query.q} onChange={event => change({ q: event.target.value })} aria-invalid={tooLong} aria-describedby={tooLong ? 'query-limit' : undefined} autoComplete="off" spellCheck={false} onKeyDown={event => {
      if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.preventDefault(); if (current.open.length) setView(persist({ open: [] })); }
    }} /><div className="search-filters"><label><input type="checkbox" checked={query.saved} onChange={event => change({ saved: event.target.checked })} />{t('dictionary.saved_filter')}</label><label><input type="checkbox" checked={query.expanded} onChange={event => change({ expanded: event.target.checked })} />{t('dictionary.expanded_search')}</label><Button onClick={submit}>{t('dictionary.search')}</Button></div></form>
    {tooLong ? <Status tone="warning"><p id="query-limit">{t('dictionary.query_limit', { count: QUERY_LIMIT })}</p></Status> : pending ? <p role="status">{t('dictionary.searching')}</p> : <>
      <p role="status" aria-live="polite">{t('dictionary.group_count', { count: groups.length })}</p>
      {!groups.length ? <p>{t(query.saved && !savedIds.size ? 'dictionary.no_saved' : 'dictionary.empty')}</p> : <ArabicFontGate><div ref={resultsElement}>{Array.from({ length: Math.ceil(visible.length / 30) }, (_, batch) => {
        const items = visible.slice(batch * 30, (batch + 1) * 30);
        return <Disclosure key={`${address}:${batch}`} identity={`search:${address}:${batch}:${items.map(group => group.results[0]!.id).join(',')}`} targets={[{ kind: 'dictionary_results', ids: items.map(group => group.results[0]!.id) }]} onDisclosed={restore}>
        {items.map((group, localPosition) => {
          const position = batch * 30 + localPosition;
          const result = group.results[0]!; const entry = entries.get(result.id)!;
          return <Fragment key={group.id}>{(!position || category(result.tier) !== category(visible[position - 1]!.results[0]!.tier)) && <h2>{t(category(result.tier))}</h2>}<article className="dictionary-group">
            <h3><Link data-result-id={entry.id} to={`/dictionary/${entry.id}`} onClick={event => openEntry(event, entry.id)} onFocus={() => persist({ focus: entry.id })}><ArabicText>{entry.display_form}</ArabicText></Link></h3>
            {entry.reading_tt === null ? <p className="meta">{t('dictionary.no_reading')}</p> : <p className="entry-reading">{entry.reading_tt}</p>}
            <p><MixedText text={entry.meaning_tt} /></p>{'eligibility' in entry && entry.eligibility.tier === 'reference' && <p className="meta">{t('dictionary.reference_only')}</p>}
            <p className="meta"><MixedText text={sourceLabel(entry)} /></p>
            {group.results.length > 1 && <details open={current.open.includes(group.id)} onToggle={event => {
              const open = event.currentTarget.open ? [...new Set([...savedView.current.open, group.id])] : savedView.current.open.filter(id => id !== group.id);
              if (open.join('|') !== savedView.current.open.join('|')) setView(persist({ open }));
            }}><summary onClick={event => { event.preventDefault(); setView(persist({ open: current.open.includes(group.id) ? current.open.filter(id => id !== group.id) : [...current.open, group.id] })); }}>{t('dictionary.source_entries', { count: group.results.length })}</summary><ul>{group.results.map(result => <li key={result.id}><Link data-result-id={result.id} to={`/dictionary/${result.id}`} onClick={event => openEntry(event, result.id)} onFocus={() => persist({ focus: result.id })}><MixedText text={sourceLabel(entries.get(result.id)!)} /></Link></li>)}</ul></details>}
          </article></Fragment>;
        })}</Disclosure>;
      })}</div>
        {visible.length < groups.length && <Button onClick={() => setView(persist({ limit: current.limit + 30 }))}>{t('dictionary.show_more')}</Button>}
      </ArabicFontGate>}
    </>}
  </div>;
}
export function DictionaryPage() {
  const { content } = useApp();
  return <ContentState identity="dictionary-index" load={() => content.load('dictionary.json')}>{() => <Dictionary />}</ContentState>;
}
