import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/isketatar/releases/__ISKE_RELEASE__/' : '/isketatar/',
  plugins: [
    react(),
    {
      name: 'build-quality-graph', apply: 'build',
      async writeBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter(item => item.type === 'chunk').map(chunk => ({
          css: [...((Reflect.get(chunk, 'viteMetadata') as { importedCss?: Set<string> } | undefined)?.importedCss ?? [])],
          file: chunk.fileName, entry: chunk.isEntry, imports: chunk.imports, dynamicImports: chunk.dynamicImports,
          module_sizes: Object.fromEntries(Object.entries(chunk.modules).map(([id, info]) => [relative(process.cwd(), id), info.renderedLength])),
          modules: Object.keys(chunk.modules).map(id => relative(process.cwd(), id)),
          sha256: createHash('sha256').update(chunk.code).digest('hex'),
        }));
        await mkdir('quality-results', { recursive: true });
        await writeFile('quality-results/bundle-graph.json', JSON.stringify(chunks, null, 2) + '\n');
      },
    },
    {
      name: 'development-csp',
      apply: 'serve',
      // Vite обновляет CSS через style-элементы; production сохраняет строгую CSP.
      transformIndexHtml: html => html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*\/>/u, ''),
    },
  ],
  build: { target: 'es2022', sourcemap: false },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
}));
