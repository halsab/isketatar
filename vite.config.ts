import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/isketatar/releases/__ISKE_RELEASE__/' : '/isketatar/',
  plugins: [
    react(),
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
