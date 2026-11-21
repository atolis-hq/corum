const { test, expect } = require('@playwright/test');
const { mkdtemp, mkdir, readFile, writeFile, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { parse, stringify } = require('yaml');

const fixtureDir = path.resolve(__dirname, '../fixtures/packs/plugin-pack');
const NODE = 'demo.PackDemo.example';

test.use({ viewport: { width: 1280, height: 800 } });

test('an installed pack provides a page and node action that graph configuration can disable', async ({ page: initialPage, context }) => {
  let page = initialPage;
  const { installPackFiles } = await import('../../dist/src/pack/installer.js');
  const { loadGraph } = await import('../../dist/src/loader/index.js');
  const { startWebServer } = await import('../../dist/src/web/server.js');
  const graphDir = await mkdtemp(path.join(os.tmpdir(), 'corum-pack-plugin-'));
  let server;
  try {
    const packDir = path.join(graphDir, 'packs/plugin-pack');
    const meta = parse(await readFile(path.join(fixtureDir, 'pack.yaml'), 'utf8'));
    const files = ['pack.yaml', ...meta.templates.map(name => `templates/${name}.yaml`), ...meta.files];
    const fetched = [];
    const baseUrl = 'https://fixture.invalid/plugin-pack';
    // No network fallback: only explicitly declared local fixture files can be fetched.
    await installPackFiles(baseUrl, packDir, async url => {
      const relative = String(url).slice(baseUrl.length + 1);
      expect(String(url)).toBe(`${baseUrl}/${relative}`);
      expect(files).toContain(relative);
      fetched.push(relative);
      return new Response(await readFile(path.join(fixtureDir, relative), 'utf8'));
    });
    expect(fetched).toEqual(files);
    for (const file of files) {
      expect(await readFile(path.join(packDir, file), 'utf8')).toBe(await readFile(path.join(fixtureDir, file), 'utf8'));
    }
    const config = { schemaVersion: '1', templatePacks: [{ name: meta.name, path: 'packs/plugin-pack' }] };
    const configPath = path.join(graphDir, 'graph.yaml');
    await writeFile(configPath, stringify(config));
    await mkdir(path.join(graphDir, 'nodes/demo'), { recursive: true });
    await writeFile(path.join(graphDir, 'nodes/demo/example.yaml'), stringify({
      id: NODE, template: 'PackDemo', schemaVersion: '1',
      metadata: { component: 'demo', state: 'proposed', stability: 'unstable', lastModifiedAt: '2026-11-21' },
      properties: {},
    }));
    const graph = await loadGraph({ graphPath: graphDir, strict: true });
    expect(graph.nodesById.has(NODE)).toBe(true);
    server = await startWebServer(graph, { graphPath: graphDir, port: 0, host: '127.0.0.1', logger: () => {} });
    const origin = `http://127.0.0.1:${server.port}`;
    const plugins = await (await page.request.get(`${origin}/api/plugins`)).json();
    expect(plugins.find(plugin => plugin.id === 'pack-demo')).toMatchObject({ origin: 'pack', status: 'enabled' });
    await page.goto(`${origin}/#/p/pack-demo/home`);
    await expect(page.getByRole('heading', { name: 'Installed pack page' })).toBeVisible();
    await expect(page.getByTestId('pack-demo-selected')).toHaveText('No node selected');
    await expect(page.locator('.nav-rail-item', { hasText: 'Pack Demo' })).toBeVisible();
    await page.goto(`${origin}/#/node?id=${NODE}`);
    await page.getByTestId('node-title-row').getByRole('button', { name: 'Open in', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Inspect in Pack Demo', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/p/pack-demo/home\\?id=${NODE.replace(/\./g, '\\.')}$`));
    await expect(page.getByRole('heading', { name: 'Installed pack page' })).toBeVisible();
    await expect(page.getByTestId('pack-demo-selected')).toHaveText(NODE);

    await writeFile(configPath, stringify({ ...config, plugins: [{ id: 'pack-demo', enabled: false }] }));
    expect((await page.request.post(`${origin}/api/reload`)).ok()).toBe(true);
    const disabled = await (await page.request.get(`${origin}/api/plugins`)).json();
    expect(disabled.find(plugin => plugin.id === 'pack-demo')).toMatchObject({ origin: 'pack', status: 'disabled' });
    // Use a fresh page: the open one may auto-reload itself after the server reload.
    await page.close();
    page = await context.newPage();
    const moduleRequests = [];
    page.on('request', request => { if (request.url().includes('/plugins/pack-demo/')) moduleRequests.push(request.url()); });
    await page.goto(`${origin}/#/p/pack-demo/home`);
    await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Installed pack page' })).toHaveCount(0);
    await expect(page.locator('.nav-rail-item', { hasText: 'Pack Demo' })).toHaveCount(0);
    await page.goto(`${origin}/#/node?id=${NODE}`);
    await expect(page.getByTestId('node-title-row')).toBeVisible();
    const trigger = page.getByTestId('node-title-row').getByRole('button', { name: 'Open in', exact: true });
    if (await trigger.count()) await trigger.click();
    await expect(page.getByRole('menuitem', { name: 'Inspect in Pack Demo', exact: true })).toHaveCount(0);
    expect(moduleRequests).toEqual([]);
  } finally {
    // Drop browser connections (SSE) so the server can shut down.
    await context.close();
    await server?.close();
    await rm(graphDir, { recursive: true, force: true });
  }
});
