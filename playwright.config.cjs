const { defineConfig } = require('@playwright/test');

// Override with CORUM_E2E_PORT if the default port is unavailable (for example
// lingering TIME_WAIT sockets on Windows after many local runs).
const port = process.env.CORUM_E2E_PORT || '3002';

module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  use: { baseURL: `http://127.0.0.1:${port}`, viewport: { width: 375, height: 812 } },
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
