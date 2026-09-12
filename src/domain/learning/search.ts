import { typographicForm } from '../content/canonical';
import { graphemeBoundaries } from '../content/validation';
import type { DictionaryEntry, Vocabulary } from '../content/types';

const alphabet = [...'аәбвгдеёжҗзийклмнңоөпрстуүфхһцчшщъыьэюя'];
const rank = new Map(alphabet.map((letter, index) => [letter, index]));
export function tatarCompare(left: string, right: string): number {
  const a = [...left.toLowerCase()]; const b = [...right.toLowerCase()];
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    const x = a[index]!; const y = b[index]!;
    const difference = (rank.get(x) ?? alphabet.length + x.codePointAt(0)!) - (rank.get(y) ?? alphabet.length + y.codePointAt(0)!);
    if (difference) return difference;
  }
  return a.length - b.length;
}
const normalizeSearch = (text: string) => text.normalize('NFC').replace(/\p{White_Space}+/gu, ' ').trim().toLowerCase();
const optionalMarks = (text: string) => text.replace(/[\u064b-\u0652\u0670]/gu, '');
const nearForm = (text: string) => text.replace(/[یى]/gu, 'ي').replace(/ک/gu, 'ك');
const prefix = (text: string, query: string) => text.startsWith(query) && graphemeBoundaries(text).has(query.length);
const tiers = ['exact', 'typographic', 'prefix', 'optional_marks', 'near', 'meaning_word', 'meaning_substring'] as const;
export type SearchTier = typeof tiers[number];
export interface SearchResult { id: string; kind: 'dictionary' | 'vocabulary'; tier: SearchTier }
interface IndexedEntry {
  entry: DictionaryEntry | Vocabulary; kind: SearchResult['kind']; forms: string[]; typography: string[];
  optional: string[]; near: string[]; meaning: string; meaningWords: Set<string>;
}
export class DictionaryIndex {
  private readonly entries: IndexedEntry[];
  constructor(dictionary: readonly DictionaryEntry[], releasedVocabulary: readonly Vocabulary[]) {
    const visible = dictionary.filter(entry => entry.eligibility.dictionary_visible && ['active', 'reference'].includes(entry.eligibility.tier));
    this.entries = [...visible, ...releasedVocabulary].map(entry => {
      const linked = 'forms' in entry ? entry.forms.flatMap(form => [form.form, ...(form.reading_tt === null ? [] : [form.reading_tt])]) : [];
      const forms = [...new Set([entry.display_form, ...(entry.reading_tt === null ? [] : [entry.reading_tt]), ...linked].map(normalizeSearch))].filter(Boolean);
      const typography = forms.map(typographicForm);
      const meaning = normalizeSearch(entry.meaning_tt);
      return { entry, kind: 'eligibility' in entry ? 'dictionary' : 'vocabulary', forms, typography,
        optional: entry.profile === 'loan_original' ? typography.map(optionalMarks) : [], near: typography.map(nearForm), meaning,
        meaningWords: new Set(meaning.split(/[^\p{L}\p{M}\p{N}]+/gu).filter(Boolean)) };
    });
  }
  search(raw: string, options: { expanded?: boolean; limit?: number } = {}): SearchResult[] {
    const query = normalizeSearch(raw);
    if (!query || query.length > 250) return [];
    const typography = typographicForm(query);
    if (!typography) return [];
    const optional = optionalMarks(typography);
    const near = nearForm(typography);
    const matches = this.entries.flatMap(item => {
      let level = -1;
      if (item.forms.includes(query)) level = 0;
      else if (item.typography.includes(typography)) level = 1;
      else if (item.forms.some(form => prefix(form, query)) || item.typography.some(form => prefix(form, typography))) level = 2;
      else if (optional && item.optional.some(form => form === optional || prefix(form, optional))) level = 3;
      else if (options.expanded && item.near.includes(near)) level = 4;
      else if (item.meaningWords.has(query)) level = 5;
      else if (item.meaning.includes(query)) level = 6;
      return level < 0 ? [] : [{ item, level }];
    });
    return matches.sort((a, b) => a.level - b.level || tatarCompare(a.item.entry.reading_tt ?? a.item.entry.display_form, b.item.entry.reading_tt ?? b.item.entry.display_form) || tatarCompare(a.item.entry.display_form, b.item.entry.display_form) || tatarCompare(a.item.entry.id, b.item.entry.id))
      .slice(0, Math.max(1, Math.min(1000, options.limit ?? 50)))
      .map(({ item, level }) => ({ id: item.entry.id, kind: item.kind, tier: tiers[level]! }));
  }
}
