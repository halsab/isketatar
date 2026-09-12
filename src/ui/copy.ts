import strings from './tt.json';

export function t(key: keyof typeof strings, values: Record<string, string | number> = {}): string {
  return strings[key].replace(/\{([a-z_]+)\}/gu, (whole, name: string) => values[name] === undefined ? whole : String(values[name]));
}
