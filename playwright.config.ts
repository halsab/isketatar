import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, retries: 0,
  use: { serviceWorkers: 'block', baseURL: 'http://127.0.0.1:4173/isketatar/', trace: 'retain-on-failure' },
  // Одинаковая нагрузка локально и в CI: PWA-сценарии сами открывают несколько окон и worker.
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [
    { command: 'npm run preview', url: 'http://127.0.0.1:4173/isketatar/', reuseExistingServer: !process.env.CI },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort', url: 'http://127.0.0.1:5176/isketatar/', reuseExistingServer: !process.env.CI },
  ],
});
