import { expect, it } from 'vitest';
import { dictionaryAddress, parseSearch, searchAddress, searchPosition } from './search-state';
it('canonicalizes known search controls without interpreting unknown or repeated keys', () => {
  expect(searchAddress(parseSearch('?q=%D3%99&scope=all&expanded=0&answer=x'))).toBe('?q=%D3%99');
  expect(parseSearch('?q=a&q=b&scope=saved&expanded=1')).toEqual({ q: '', saved: true, expanded: true });
  expect(dictionaryAddress('/dictionary?q=abc&scope=saved')).toBe(true);
  expect(dictionaryAddress('//evil/dictionary?q=abc')).toBe(false);
  expect(dictionaryAddress('/dictionary?redirect=evil')).toBe(false);
});
it('restores only the matching query and bounded presentation preferences', () => {
  expect(searchPosition({ search: '?q=x', limit: 60, scroll: 321, focus: 'lex-55-001', open: ['lex-55-001'] }, '?q=x')).toMatchObject({ limit: 60, scroll: 321 });
  expect(searchPosition({ search: '?q=x', limit: 60 }, '?q=y').limit).toBe(30);
  expect(searchPosition({ search: '', limit: Infinity, scroll: NaN, open: [false] }, '')).toMatchObject({ limit: 30, scroll: 0, open: [] });
});
