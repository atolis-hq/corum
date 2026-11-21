const { test, expect } = require('@playwright/test');

test('legacy #/namespaces redirects to the Explorer plugin list', async ({ page }) => {
  await page.goto('/#/namespaces');
  await expect(page).toHaveURL(/#\/p\/explorer\/namespaces$/);
  await expect(page.locator('.nav-rail-item.active')).toHaveText('Explorer');
  await expect(page.locator('.nav-tree')).toBeVisible();
});

test('legacy #/namespace?name=… redirects to the plugin namespace page, keeping the name', async ({ page }) => {
  await page.goto('/#/namespace?name=orders');
  await expect(page).toHaveURL(/#\/p\/explorer\/namespace\?name=orders$/);
  await expect(page.locator('.detail-pane h1')).toHaveText('orders');
  await expect(page.getByTestId('namespace-inbound')).toBeVisible();
  await expect(page.locator('.nav-rail-item.active')).toHaveText('Explorer');
});

test('legacy namespace URLs keep the branch segment', async ({ page }) => {
  await page.goto('/#/feature%2Flegacy/namespace?name=orders');
  await expect(page).toHaveURL(/#\/feature%2Flegacy\/p\/explorer\/namespace\?name=orders$/);
});

test('the Explorer namespace page opens nodes in the Explorer view', async ({ page }) => {
  await page.goto('/#/p/explorer/namespace?name=orders');
  await page.locator('[role="link"]').first().click();
  await expect.poll(() => page.url()).toContain('view=explorer');
  await expect(page.locator('.nav-tree')).toBeVisible();
});

test.describe('Explorer disabled', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/plugins', async route => {
      const response = await route.fetch();
      const statuses = await response.json();
      await route.fulfill({
        response,
        json: statuses.map(status => (status.id === 'explorer' ? { ...status, status: 'disabled', reason: 'Disabled in graph.yaml' } : status)),
      });
    });
  });

  test('legacy URLs show the plugin-unavailable page and the rail has no Explorer', async ({ page }) => {
    await page.goto('/#/namespaces');
    await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
    await expect(page).toHaveURL(/#\/namespaces$/);
    await expect(page.locator('.nav-rail-item', { hasText: 'Explorer' })).toHaveCount(0);
  });

  test('the dashboard and node pages still work, without a tree', async ({ page }) => {
    await page.goto('/#/dashboard');
    await expect(page.locator('.nav-rail-item', { hasText: 'Dashboard' })).toBeVisible();
    await page.goto('/#/node?id=orders.DomainModel.order');
    await expect(page.locator('.detail-pane h1')).toBeVisible();
    await expect(page.locator('.nav-tree')).toHaveCount(0);
  });
});
