import { validateExport } from '../../generated/progress-validators';
import type { ProgressExport, ProgressSnapshot } from './model';
import { assertStructure } from './structure';
import { exportData } from './model';
export { replacementToken } from './model';

export const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
export async function decodeImport(file: Blob): Promise<ProgressExport> {
  if (!Number.isSafeInteger(file.size) || file.size > MAX_EXPORT_BYTES) throw new Error('import_too_large');
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size || bytes.byteLength > MAX_EXPORT_BYTES) throw new Error('import_too_large');
  let value: unknown;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { throw new Error('invalid_import'); }
  assertStructure(value, 'invalid_import');
  if (value && typeof value === 'object' && Reflect.get(value, 'format') === 'iske-imla-progress' && Reflect.get(value, 'schema_version') !== 1) throw new Error('unsupported_import');
  if (!validateExport(value)) throw new Error('invalid_import');
  return value;
}
export function encodeExport(snapshot: ProgressSnapshot, appVersion: string, contentVersion: string, at: number): Blob {
  const envelope: ProgressExport = { format: 'iske-imla-progress', schema_version: 1, app_version: appVersion, content_version: contentVersion, exported_at: at, data: exportData(snapshot) };
  assertStructure(envelope, 'export_incompatible');
  if (!validateExport(envelope)) throw new Error('export_incompatible');
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  if (blob.size > MAX_EXPORT_BYTES) throw new Error('export_too_large');
  return blob;
}
