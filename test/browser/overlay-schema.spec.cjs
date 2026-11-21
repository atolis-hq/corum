const { test, expect } = require('@playwright/test');
const fixture = require('../fixtures/overlay-ghost-fields.json');

test.use({ viewport: { width: 1280, height: 800 } });
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'wait' });
});

const MODEL = 'orders.DomainModel.order';

// The sample graph has no overlay data, so serve a multi-branch API whose overlay
// carries real ghost fields (from the fixture) for the schema under the model.
async function overlayApi(page) {
  await page.route('**/api/branches', route => route.fulfill({ json: {
    default: 'main', branches: [{ ref: 'main', isDefault: true }, { ref: 'feature/ghost' }], results: [],
  } }));
  await page.route('**/api/cluster?*', async route => {
    const url = new URL(route.request().url());
    const upstream = new URL(url);
    upstream.searchParams.delete('overlayRefs');
    const response = await route.fetch({ url: upstream.href });
    const cluster = await response.json();
    if (url.searchParams.has('overlayRefs') && cluster.root?.id === MODEL) {
      const schema = cluster.descendants.find(node => node.template === 'Schema');
      cluster.overlay = {
        viewingRef: url.searchParams.get('ref'),
        overlayRefs: fixture.overlayRefs,
        fields: fixture.fields.map(field => ({
          id: `${schema.id}.fields.${field.localName}`,
          ghostState: field.ghostState,
          sourceRef: field.sourceRef,
          node: { id: `${schema.id}.fields.${field.localName}`, ...field.node },
        })),
      };
    }
    await route.fulfill({ response, json: cluster });
  });
}

test('schema cards render overlay ghost rows, stripes, conflicts and the legend', async ({ page }) => {
  await overlayApi(page);
  await page.goto(`/#/feature%2Fghost/node?id=${MODEL}&view=explorer`);
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cluster' && new URL(response.url()).searchParams.has('overlayRefs'));
  await page.locator('.branch-seg-item', { hasText: 'Consolidated' }).click();
  await loaded;

  const card = page.locator('.schema-card').first();
  const ghosts = card.locator('.field-row.overlay-ghost');
  await expect(ghosts).toHaveCount(3);

  const added = ghosts.filter({ hasText: 'ghost-added' });
  await expect(added).toHaveClass(/overlay-stripe-0/);
  await expect(added).toHaveAttribute('title', 'From feature/ghost');
  await expect(added.locator('.type')).toHaveText('string');

  // A second incoming branch gets the second stripe colour.
  await expect(ghosts.filter({ hasText: 'ghost-other-branch' })).toHaveClass(/overlay-stripe-1/);

  // A conflicting ghost is flagged rather than striped.
  const clash = ghosts.filter({ hasText: 'ghost-clash' });
  await expect(clash).toHaveClass(/overlay-conflict/);
  await expect(clash.locator('.tag')).toHaveText('conflict');

  const legend = card.locator('.overlay-legend');
  await expect(legend).toBeVisible();
  await expect(legend.locator('.overlay-legend-item')).toHaveCount(3);
  await expect(legend).toContainText('feature/ghost');
  await expect(legend).toContainText('conflict');
});

test('schema cards show no ghost rows or legend without overlay data', async ({ page }) => {
  await overlayApi(page);
  await page.goto(`/#/feature%2Fghost/node?id=${MODEL}&view=explorer`);
  await expect(page.locator('.schema-card').first()).toBeVisible();
  await expect(page.locator('.field-row.overlay-ghost')).toHaveCount(0);
  await expect(page.locator('.overlay-legend')).toHaveCount(0);
});
