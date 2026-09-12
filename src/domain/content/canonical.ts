import presentationForms from './arabic-presentation-forms.json' with { type: 'json' };
const forms: Readonly<Record<string, string>> = presentationForms;

export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const json = JSON.stringify(value);
    if (json === undefined) throw new Error('invalid_canonical_value');
    return json;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}

export function normalizeReading(text: string): string {
  return text.normalize('NFC').replace(/\u00a0/gu, ' ').replace(/^ +| +$/gu, '').replace(/ +/gu, ' ').replace(/\p{Script=Cyrillic}/gu, character => character.toLowerCase());
}

// Только совместимые арабские presentation forms; смысловые буквы и marks сохраняются.
export function typographicForm(text: string): string {
  return [...text].map(character => forms[character] ?? character).join('')
    .replace(/ـ/gu, '').normalize('NFC');
}
