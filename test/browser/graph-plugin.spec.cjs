const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 } });

test('Graph is a plugin page with a React Flow canvas and an active nav entry', async ({ page }) => {
  await page.goto('/#/p/graph/view');
  await expect(page.locator('.react-flow')).toBeVisible();
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  const graphItem = page.locator('.nav-rail-item', { hasText: 'Graph' });
  await expect(graphItem).toHaveClass(/active/);
  const labels = await page.locator('.nav-rail-item span').allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Dashboard', 'Explorer']);
  expect(labels).toContain('Graph');
});

test('Graph nav item opens the plugin route', async ({ page }) => {
  await page.goto('/');
  await page.locator('.nav-rail-item', { hasText: 'Graph' }).click();
  await expect(page).toHaveURL(/#\/(.+\/)?p\/graph\/view$/);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('drilling into a component changes params without remounting the page', async ({ page }) => {
  await page.goto('/#/p/graph/view');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await page.locator('.plugin-host').evaluate(el => { el.dataset.marker = 'same-element'; });
  await page.getByRole('button', { name: 'Minimap' }).click();
  await expect(page.locator('.react-flow__minimap')).toBeVisible();

  await page.locator('.graph-component-card', { hasText: 'orders' }).first().click();
  await expect(page).toHaveURL(/#\/(.+\/)?p\/graph\/view\?component=orders/);
  await expect(page.locator('.graph-breadcrumb-current')).toHaveText('orders');
  // Same DOM element and component state: nothing was remounted.
  await expect(page.locator('.plugin-host')).toHaveAttribute('data-marker', 'same-element');
  await expect(page.locator('.react-flow__minimap')).toBeVisible();

  await page.locator('.graph-node-card').first().click();
  await expect(page).toHaveURL(/focus=/);
  await expect(page.locator('.plugin-host')).toHaveAttribute('data-marker', 'same-element');
  await expect(page.locator('.react-flow__minimap')).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/component=orders/);
  await expect(page.locator('.graph-breadcrumb-current')).toHaveText('orders');
});

test('a node page "view in graph" link lands on the plugin route with focus', async ({ page }) => {
  await page.goto('/#/node?id=orders.DomainModel.order');
  await page.locator('a[title="View in graph"]').first().click();
  await expect(page).toHaveURL(/#\/(.+\/)?p\/graph\/view\?focus=orders\.DomainModel\.order$/);
  await expect(page.locator('.graph-breadcrumb-current')).toHaveText('order');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
});

test('View in graph buttons are absent when the graph plugin is disabled', async ({ page }) => {
  await page.route('**/api/plugins', async route => {
    const response = await route.fetch();
    const list = await response.json();
    await route.fulfill({
      response,
      json: list.map(plugin => (plugin.id === 'graph' ? { ...plugin, status: 'disabled' } : plugin)),
    });
  });
  await page.goto('/#/node?id=orders.DomainModel.order');
  await expect(page.locator('.detail-pane').getByText('orders.DomainModel.order', { exact: true })).toBeVisible();
  await expect(page.locator('button[title="View in graph"]')).toHaveCount(0);
  await expect(page.locator('.graph-nav-link')).toHaveCount(0);
});

test('View in graph button is present on the node page when the graph plugin is enabled', async ({ page }) => {
  await page.goto('/#/node?id=orders.DomainModel.order');
  await expect(page.locator('.detail-pane').getByText('orders.DomainModel.order', { exact: true })).toBeVisible();
  await expect(page.locator('a[title="View in graph"]').first()).toBeVisible();
});
