const { test, expect } = require('@playwright/test');

async function openList(page) {
  await page.goto('/#/namespaces');
  await page.locator('.nav-section-head').filter({ hasText: 'orders' }).click();
  const template = page.locator('.nav-template-head').filter({ hasText: 'Domain' }).first();
  await template.click();
  await expect(page.locator('.nav-node-item').first()).toBeVisible();
}

async function expectDetail(page) {
  await expect(page.locator('.detail-pane h1')).toBeFocused();
  await expect(page.locator('.list-pane')).toHaveAttribute('inert', '');
  await expect(page.locator('.list-pane')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.detail-pane')).not.toHaveAttribute('inert');
}

async function expectList(page) {
  await expect(page).toHaveURL(/\/namespaces$/);
  await expect(page.locator('.nav-node-item.active')).toBeFocused();
  await expect(page.locator('.detail-pane')).toHaveAttribute('inert', '');
  await expect(page.locator('.list-pane')).not.toHaveAttribute('inert');
}

test('keyboard drill-down, Back, browser history, retained list and resizing', async ({ page }) => {
  await page.route('**/api/nodes*', async route => {
    const response = await route.fetch();
    const nodes = await response.json();
    const model = nodes.find(node => node.id === 'orders.DomainModel.order');
    await route.fulfill({ response, json: nodes.concat(Array.from({ length: 80 }, (_, index) => ({
      ...model, id: 'orders.DomainModel.zz' + index,
    }))) });
  });
  await openList(page);
  expect((await page.locator('.nav-tree').boundingBox()).height).toBeGreaterThan(500);
  expect(await page.locator('.detail-pane').evaluate(el => getComputedStyle(el).transitionDuration)).toContain('0.22s');
  const item = page.locator('.nav-node-item').first();
  const title = await item.getAttribute('title');
  await item.focus();
  await item.press('Enter');
  await expectDetail(page);
  const back = page.getByRole('button', { name: 'Back to namespaces' });
  expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expectList(page);
  await expect(page.locator('.nav-node-item.active')).toHaveAttribute('title', title);
  const scroll = await page.locator('.nav-tree').evaluate(el => { el.scrollTop = 30; return el.scrollTop; });
  expect(scroll).toBeGreaterThan(0);
  await page.locator('.nav-node-item.active').press('Enter');
  await expectDetail(page);
  await page.goBack();
  await expectList(page);
  expect(await page.locator('.nav-tree').evaluate(el => el.scrollTop)).toBe(scroll);
  await page.goForward();
  await expectDetail(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('.list-pane')).not.toHaveAttribute('inert');
  await expect(back).toBeHidden();
  await expect(page.locator('.nav-node-item.active')).toHaveAttribute('title', title);
  await page.setViewportSize({ width: 780, height: 375 });
  await expectDetail(page);
  await back.click();
  await expectList(page);
});

test('direct links retain branch context and browser Back reaches the list', async ({ page }) => {
  await page.goto('/#/feature%2Fmobile/node?id=orders.DomainModel.order');
  await expectDetail(page);
  await page.goBack();
  await expectList(page);
  await expect(page).toHaveURL(/#\/feature%2Fmobile\/namespaces$/);
  await page.goForward();
  await expectDetail(page);
  await page.getByRole('button', { name: 'Back to namespaces' }).click();
  await expectList(page);
});

test('reduced motion, landscape, dashboard and graph', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 667, height: 375 });
  await openList(page);
  await page.locator('.nav-node-item').first().click();
  await expectDetail(page);
  expect(await page.locator('.detail-pane').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.getByRole('button', { name: 'Back to namespaces' }).click();
  await expectList(page);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.hero-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-section')).toBeVisible();
  expect((await page.locator('.graph-section').boundingBox()).height).toBeGreaterThan(100);
});
