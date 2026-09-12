import { build } from 'vite';
await build({ configFile: false, publicDir: false, build: { target: 'es2022', emptyOutDir: false, sourcemap: false, lib: { entry: 'src/data/pwa/worker.ts', formats: ['iife'], name: 'IsketatarTransport', fileName: () => 'sw.js' } } });
