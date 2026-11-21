const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 } });
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});
const MODEL = 'orders.DomainModel.order';
const TARGET = 'orders.DomainEvent.order-placed';
const BRANCH = 'feature/links';

// A multi-branch API fixture: the feature cluster has a reference absent from main.
async function branches(page) {
  await page.route('**/api/branches', route => route.fulfill({ json: {
    default: 'main', branches: [{ ref: 'main', isDefault: true }, { ref: BRANCH }], results: [],
  } }));
  await page.route('**/api/cluster?*', async route => {
    const url = new URL(route.request().url());
    const fixtureUrl = new URL(url);
    fixtureUrl.searchParams.delete('overlayRefs');
    const response = await route.fetch({ url: fixtureUrl.href });
    const cluster = await response.json();
    if (url.searchParams.has('overlayRefs')) {
      cluster.overlay = { fields: [], overlayRefs: url.searchParams.getAll('overlayRefs') };
    }
    if (url.searchParams.get('ref') === BRANCH && cluster.root?.id === MODEL) {
      const field = cluster.descendants.find(node => node.template === 'Field');
      cluster.edges.push({ id: 'branch-reference', from: field.id, to: TARGET, type: 'maps-to', state: 'proposed', stability: 'unstable' });
      // Keep this destination external so property clicks exercise navigation, not in-page scrolling.
      cluster.includedNodes = cluster.includedNodes.filter(node => node.id !== TARGET);
      cluster.root.properties.localReference = { display: 'Local schema', nodeId: cluster.descendants.find(node => node.template === 'Schema').id };
      cluster.root.properties.branchReference = { display: 'Feature event', nodeId: TARGET };
    }
    await route.fulfill({ response, json: cluster });
  });
}

for (const overlay of [false, true]) {
  for (const explorer of [false, true]) {
    test(`schema references on host node pages stay in the Explorer and keep the branch${explorer ? ' (explicit view)' : ''}${overlay ? ' with overlays' : ''}`, async ({ page }) => {
      await branches(page);
      await page.goto(`/#/feature%2Flinks/node?id=${MODEL}${explorer ? '&view=explorer' : ''}`);
      if (overlay) {
        const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cluster' && new URL(response.url()).searchParams.get('overlayRefs') === 'main');
        await page.locator('.branch-seg-item', { hasText: 'Consolidated' }).click();
        await loaded;
      }
      const link = page.locator('.schema-card a.node-ref-link').filter({ hasText: 'order-placed' }).first();
      const destination = `#/feature%2Flinks/node?id=${TARGET}&view=explorer`;
      await expect(link).toHaveAttribute('href', destination);
      await link.click();
      await expect.poll(() => new URL(page.url()).hash).toBe(destination);
      await expect(page.locator('.detail-pane h1')).toHaveText('order-placed');
      await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
    });
  }
}

test('plugin SchemaCard references use normal branch-aware resolution', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/p/ok/home?id=${MODEL}`);
  const link = page.getByTestId('ok-schema').locator('a.node-ref-link').filter({ hasText: 'order-placed' }).first();
  await expect(link).toHaveAttribute('href', `#/feature%2Flinks/p/claim-solo/home?id=${TARGET}`);
  await link.click();
  await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
  await expect(page).toHaveURL(/#\/feature%2Flinks\/p\/claim-solo\/home/);
});

test('property references preserve Explorer routing and the viewed branch', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/node?id=${MODEL}&view=explorer`);
  const link = page.getByRole('link', { name: 'Feature event', exact: true });
  await expect(link).toHaveAttribute('href', `#/feature%2Flinks/node?id=${TARGET}&view=explorer`);
  await link.click();
  await expect(page).toHaveURL(/#\/feature%2Flinks\/node\?id=orders.DomainEvent.order-placed&view=explorer/);
});

test('property references on plain host node pages stay in the Explorer', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/node?id=${MODEL}`);
  const link = page.getByRole('link', { name: 'Feature event', exact: true });
  await expect(link).toHaveAttribute('href', `#/feature%2Flinks/node?id=${TARGET}&view=explorer`);
  await link.click();
  await expect(page).toHaveURL(/#\/feature%2Flinks\/node\?id=orders.DomainEvent.order-placed&view=explorer/);
  await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
});

test('property references use normal resolution in plugin pages', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/p/ok/home?id=${MODEL}`);
  const link = page.getByRole('link', { name: 'Feature event', exact: true });
  await expect(link).toHaveAttribute('href', `#/feature%2Flinks/p/claim-solo/home?id=${TARGET}`);
  await link.click();
  await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
  await expect(page).toHaveURL(/#\/feature%2Flinks\/p\/claim-solo\/home/);
});

test('connection rows on plain host node pages stay in the Explorer', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/node?id=${MODEL}`);
  const rows = page.getByTestId('edge-row');
  if (await rows.count() === 0) await page.locator('.connections-card .card-head').click();
  await expect(rows.first()).toBeVisible();
  await rows.first().click();
  await expect(page).toHaveURL(/#\/feature%2Flinks\/node\?id=.*&view=explorer/);
  await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
});

test('host property callbacks still scroll to an already displayed schema', async ({ page }) => {
  await branches(page);
  await page.goto(`/#/feature%2Flinks/node?id=${MODEL}&view=explorer`);
  const link = page.getByRole('link', { name: 'Local schema', exact: true });
  await expect(link).toBeVisible();
  const before = page.url();
  await page.evaluate(() => {
    window.scrolledNodes = [];
    Element.prototype.scrollIntoView = function () { window.scrolledNodes.push(this.id); };
  });
  await link.click();
  expect(page.url()).toBe(before);
  expect(await page.evaluate(() => window.scrolledNodes.some(id => id.includes('schemas')))).toBe(true);
});
