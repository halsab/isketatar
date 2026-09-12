import { ContentCatalog } from '../../domain/content/catalog';
import type { Asset, CoreData, ReleaseManifest } from '../../domain/content/types';
import { POLICIES } from '../../domain/content/types';
import { validateCore } from '../../generated/core-validator.js';
import contentManifest from '../../generated/content-manifest.json';
import { assetUrl } from '../../app/paths';
import { readBoundedBytes } from '../http';

function compatibleCore(value: unknown): value is CoreData {
  if (value && typeof value === 'object') {
    const schema: unknown = Reflect.get(value, 'content_schema');
    const policies: unknown = Reflect.get(value, 'policy_versions');
    if (typeof schema === 'number' && Number.isSafeInteger(schema) && schema > 0 && schema !== 1) throw new Error('unsupported_release');
    if (policies && typeof policies === 'object') for (const [key, supported] of Object.entries(POLICIES)) {
      const version: unknown = Reflect.get(policies, key);
      if (typeof version === 'string' && version.length > 0 && version !== supported) throw new Error('unsupported_release');
    }
  }
  return validateCore(value);
}

export async function checkedJson<T>(asset: Asset, validate: (value: unknown) => value is T, signal?: AbortSignal): Promise<T> {
  const response = await fetch(asset.url, { signal, redirect: 'error' });
  if (!response.ok) throw new Error('content_unavailable');
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('content_corrupt');
  const bytes = await readBoundedBytes(response, asset.bytes);
  if (bytes.length !== asset.bytes) throw new Error('content_corrupt');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.sha256) throw new Error('content_corrupt');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('content_corrupt'); }
  if (!validate(value)) throw new Error('content_corrupt');
  return value;
}

export class ContentRepository {
  private readonly pending = new Map<string, Promise<void>>();
  readonly catalog: ContentCatalog;
  private constructor(catalog: ContentCatalog, readonly assets: Asset[]) { this.catalog = catalog; }

  static async open(release?: ReleaseManifest, signal?: AbortSignal) {
    const assets: Asset[] = release?.assets ?? contentManifest.assets.map(asset => ({ ...asset, kind: 'content' as const }));
    const coreAsset = assets.find(asset => asset.url.endsWith('/runtime/core.json'));
    if (!coreAsset) throw new Error('content_unavailable');
    const core = await checkedJson(coreAsset, compatibleCore, signal);
    return new ContentRepository(new ContentCatalog(core), assets);
  }

  async load(resource: string): Promise<void> {
    const existing = this.pending.get(resource);
    if (existing) return existing;
    const task = this.loadResource(resource).catch(error => { this.pending.delete(resource); throw error; });
    this.pending.set(resource, task);
    return task;
  }
  private async loadResource(resource: string) {
    const suffix = assetUrl(`runtime/${resource}`).slice('/isketatar'.length);
    const asset = this.assets.find(item => item.url.endsWith(suffix));
    if (!asset) throw new Error('content_unavailable');
    const validators = await import('../../generated/content-validators.js');
    if (resource.startsWith('module-')) this.catalog.addModule(await checkedJson(asset, validators.validateModule));
    else if (resource === 'readings.json') this.catalog.addReadings(await checkedJson(asset, validators.validateReadings));
    else if (resource === 'dictionary.json') this.catalog.addDictionary(await checkedJson(asset, validators.validateDictionary));
    else if (resource === 'references.json') this.catalog.references = await checkedJson(asset, validators.validateReferences);
    else if (resource === 'assessments.json') this.catalog.addQuestions(await checkedJson(asset, validators.validateAssessments));
    else throw new Error('content_unavailable');
  }
  async lesson(id: string) {
    const summary = this.catalog.core.lessons.find(lesson => lesson.id === id);
    if (!summary) throw new Error('content_unavailable');
    await this.load(summary.resource);
    const lesson = this.catalog.lessons.get(id);
    if (!lesson) throw new Error('content_unavailable');
    return lesson;
  }
  async questions(ids: string[]) {
    const resources = ids.map(id => {
      const ref = this.catalog.core.questions.find(question => question.id === id);
      if (!ref) throw new Error('content_unavailable');
      return ref.resource;
    });
    await Promise.all([...new Set(resources)].map(resource => this.load(resource)));
    return ids.map(id => this.catalog.question(id));
  }
}
