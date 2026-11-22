const { defineConfig, devices } = require('@playwright/test');

// Override with CORUM_E2E_PORT if the default port is unavailable (for example
// lingering TIME_WAIT sockets on Windows after many local runs).
const port = process.env.CORUM_E2E_PORT || '3002';

module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  // Baselines are per platform, not per project (see test/browser/styleguide.spec.cjs).
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}-{platform}{ext}',
  forbidOnly: !!process.env.CI,
  // Fail fast in CI: one broken spec should not spend the whole job budget timing out.
  maxFailures: process.env.CI ? 3 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    browserName: 'chromium',
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 375, height: 812 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /settings-overlay\.spec/ },
    {
      name: 'chromium-pixel5',
      testMatch: /settings-overlay\.spec/,
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 812 } },
    },
    {
      name: 'webkit-iphone',
      testMatch: /settings-overlay\.spec/,
      use: { ...devices['iPhone 13'], viewport: { width: 375, height: 812 } },
    },
  ],
  webServer: {
    command: 'npm run web',
    env: {
      CORUM_GRAPH_PATH: 'fixtures/sample-graph',
      CORUM_WEB_PORT: port,
      CORUM_BUILTIN_PLUGIN_DIRS: 'test/fixtures/plugins',
    },
    url: `http://127.0.0.1:${port}`,
  },
});
