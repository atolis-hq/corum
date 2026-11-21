const { test, expect } = require('@playwright/test');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = process.env.CORUM_E2E_SCAFFOLD_PORT || '3012';
const CLI = path.join(process.cwd(), 'dist', 'src', 'bin', 'corum.js');

let tmp;
let server;

test.beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-scaffold-e2e-'));
  const init = spawnSync(process.execPath, [CLI, 'plugin', 'init', 'scaffolded', '--dir', path.join(tmp, 'scaffolded')], { encoding: 'utf8' });
  if (init.status !== 0) throw new Error(init.stderr);
  server = spawn(process.execPath, [CLI, 'web', '--plugin-dir', path.join(tmp, 'scaffolded')], {
    env: { ...process.env, CORUM_GRAPH_PATH: 'fixtures/sample-graph', CORUM_WEB_PORT: PORT },
    stdio: 'ignore',
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return;
    } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('web server did not start');
});

test.afterAll(() => {
  server?.kill();
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

test('a scaffolded plugin loads in development mode and renders its sample page', async ({ page }) => {
  const plugins = await (await fetch(`http://127.0.0.1:${PORT}/api/plugins`)).json();
  const entry = plugins.find(item => item.id === 'scaffolded');
  expect(entry).toMatchObject({ origin: 'dev', status: 'enabled' });

  await page.goto(`http://127.0.0.1:${PORT}/#/p/scaffolded/home`);
  const root = page.getByTestId('plugin-scaffolded');
  await expect(root.locator('h1')).toHaveText('scaffolded');
  await expect(root.locator('li').first()).toBeVisible();
});
