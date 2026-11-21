const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3002', viewport: { width: 375, height: 812 } },
  webServer: {
    command: 'npm run web',
    env: { CORUM_GRAPH_PATH: 'fixtures/sample-graph', CORUM_WEB_PORT: '3002', CORUM_BUILTIN_PLUGIN_DIRS: 'test/fixtures/plugins' },
    url: 'http://127.0.0.1:3002',
  },
});
