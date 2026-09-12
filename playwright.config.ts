import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4173/isketatar/', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run preview', url: 'http://127.0.0.1:4173/isketatar/', reuseExistingServer: !process.env.CI },
});
