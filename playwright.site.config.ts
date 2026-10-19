import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const deployedSite = process.env.SITE_BASE_URL;

export default defineConfig({
  testDir: './tests/site',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results/site',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/site', open: 'never' }],
    ['junit', { outputFile: 'test-results/site-junit.xml' }],
  ],
  use: {
    baseURL: deployedSite ?? 'http://127.0.0.1:4190/pageway/',
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'site-chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: 'site-mobile',
      use: { ...devices['Pixel 7'], channel: 'chromium' },
    },
  ],
  webServer: deployedSite
    ? undefined
    : {
        command:
          'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4190 --strictPort',
        cwd: fileURLToPath(new URL('./apps/site', import.meta.url)),
        url: 'http://127.0.0.1:4190/pageway/',
        timeout: 30_000,
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
