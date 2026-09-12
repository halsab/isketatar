import { readdir, readFile } from 'node:fs/promises';

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await visit(path);
    else if (/\.[jt]sx?$/.test(path) && !path.endsWith('.test.ts')) {
      const code = await readFile(path, 'utf8');
      if (path.includes('/domain/') && /from ['"](?:react|idb|.*\/(?:data|app|features|ui)\/)|\b(?:Date\.now|fetch|indexedDB|document|window)\b/.test(code)) {
        throw new Error(`Domain boundary violated: ${path}`);
      }
      if (path.includes('/features/') && /from ['"]idb['"]|\bindexedDB\b/.test(code)) throw new Error(`Storage boundary violated: ${path}`);
      if (/dangerouslySetInnerHTML|\beval\(|new Function\(/.test(code)) throw new Error(`Unsafe execution: ${path}`);
    }
  }
}
await visit('src');
console.log('Module boundaries: pass');
