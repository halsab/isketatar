export function loadSources(): Promise<unknown>;
export function projectCorpus(source: unknown): {
  core: unknown; modules: unknown[]; readings: unknown; dictionary: unknown; references: unknown; assessments: unknown;
};
export function digest(value: string): string;
