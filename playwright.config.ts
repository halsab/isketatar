import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4173/isketatar/', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run preview', url: 'http://127.0.0.1:4173/isketatar/', reuseExistingServer: !process.env.CI },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5176 --strictPort', url: 'http://127.0.0.1:5176/isketatar/', reuseExistingServer: !process.env.CI },
  ],
});
