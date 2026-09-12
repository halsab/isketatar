import { validateAttempt, validateBookmark, validateExposure, validateLegacy, validateMeta, validatePresentation, validateReviewCard, validateSession } from '../../generated/progress-validators';
import type { StoreName, StoreRecords } from './model';
import { assertStructure } from './structure';

const validators = { meta: validateMeta, sessions: validateSession, presentations: validatePresentation, attempts: validateAttempt, exposures: validateExposure, review_cards: validateReviewCard, bookmarks: validateBookmark, legacy: validateLegacy };
export function checkedRecord<K extends StoreName>(store: K, value: unknown): StoreRecords[K] {
  if (store === 'meta' && value && typeof value === 'object' && Reflect.get(value, 'key') === 'control' && (Reflect.get(value, 'progress_schema') !== 1 || Reflect.get(value, 'db_version') !== 1)) throw new Error('unsupported_storage');
  assertStructure(value, 'storage_corrupt');
  if (!validators[store](value)) throw new Error('storage_corrupt');
  return value as StoreRecords[K];
}
