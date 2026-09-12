import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function isProductInput(path) {
  // Новые файлы включаются по умолчанию; исключены только производные и свидетельства самой приёмки.
  return !/^(?:src\/generated\/|public\/(?:runtime|sources)\/|docs\/development\/(?:acceptance-reports\/|(?:external-acceptance\.json|implementation\.md|quality-report\.md|release-conditions\.md)$))/u.test(path);
}
export async function productScope(root = process.cwd()) {
  const names = execFileSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = [];
  for (const path of [...new Set(names)].filter(isProductInput).sort()) {
    let bytes;
    try { bytes = await readFile(resolve(root, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
  }
  if (!files.some(file => file.path === 'src/ui/tt.json') || !files.some(file => file.path === 'package-lock.json')) throw new Error('Incomplete product input scope');
  // Документы приёмки и время коммита исключены: запись свидетельства не изменяет объект самой приёмки.
  return { schema_version: 1, sha256: sha256(JSON.stringify(files)), files };
}
