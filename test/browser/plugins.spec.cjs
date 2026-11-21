const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 } });

const MODEL = 'orders.DomainModel.order';
const EVENT = 'orders.DomainEvent.order-placed';
// Quick-link hrefs, with or without a branch prefix (the viewed ref depends on the checkout).
const hrefTo = (page, param, id) => new RegExp('^#/(.+/)?p/' + page + '\\?' + param + '=' + id.replace(/\./g, '\\.') + '$');
const SCHEMA_NODE = 'shared.Schema.problem-detail';

test('ok plugin mounts at its route and has a nav entry', async ({ page }) => {
  await page.goto('/#/p/ok/home?id=abc');
  await expect(page.getByTestId('plugin-ok')).toHaveText('OK plugin page');
  await expect(page.getByTestId('plugin-ok-id')).toHaveText('abc');
  await expect(page.locator('.nav-rail-item', { hasText: 'OK Plugin' })).toBeVisible();
  await page.locator('.nav-rail-item', { hasText: 'Dashboard' }).click();
  await expect(page.getByTestId('plugin-ok')).toHaveCount(0);
});

test('nav rail lists host items (Dashboard, Models) before plugin pages sorted by order', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav-rail-item', { hasText: 'OK Plugin' })).toBeVisible();
  const labels = await page.locator('.nav-rail-item span').allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Dashboard', 'Models']);
  // Orders: OK Plugin 10, Broken Import 20 and Graph 20 (title tie-break), Throws On Mount 30.
  expect(labels.slice(2, 6)).toEqual(['OK Plugin', 'Broken Import', 'Graph', 'Throws On Mount']);
  expect(labels[labels.length - 1]).toBe('Debug');
});

test('broken plugins show an error while Dashboard and other plugins still work', async ({ page }) => {
  await page.goto('/#/p/broken-import/home');
  await expect(page.locator('[data-testid="plugin-error"]')).toBeVisible();
  await page.goto('/#/p/throws-on-mount/home');
  await expect(page.locator('[data-testid="plugin-error"]')).toContainText('mount exploded');
  await page.locator('.nav-rail-item', { hasText: 'Dashboard' }).click();
  await expect(page.locator('.nav-rail')).toBeVisible();
  await page.locator('.nav-rail-item', { hasText: 'OK Plugin' }).click();
  await expect(page.getByTestId('plugin-ok')).toBeVisible();
});

test('plugin with missing template has no nav entry and shows Plugin unavailable', async ({ page }) => {
  await page.goto('/#/p/needs-missing-template/home');
  await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
  await expect(page.locator('body')).toContainText('NoSuchTemplate');
  await expect(page.locator('.nav-rail-item', { hasText: 'Needs Missing' })).toHaveCount(0);
});

test('unknown plugin shows Plugin unavailable with a link to the node page', async ({ page }) => {
  await page.goto(`/#/p/nope/home?id=${MODEL}`);
  await expect(page.getByRole('heading', { name: 'Plugin unavailable' })).toBeVisible();
  await page.getByRole('link', { name: /open.*generic|node page/i }).click();
  await expect(page).toHaveURL(/#\/(.+\/)?node\?id=orders\.DomainModel\.order$/);
});

test('node claimed by two plugins shows an Open in menu and node actions', async ({ page }) => {
  await page.goto(`/#/node?id=${MODEL}`);
  const bar = page.locator('[data-testid="open-in"]');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /open in/i }).click();
  await expect(bar.getByRole('menuitem', { name: 'Claim A' })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: 'Claim B' })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: /default view/i })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: 'View in OK' })).toBeVisible();
  await bar.getByRole('menuitem', { name: 'Claim B' }).click();
  await expect(page.getByTestId('plugin-claim-b')).toBeVisible();
});

test('node title row shows quick-link icons and the Open in menu icon last, listing every action', async ({ page }) => {
  await page.goto(`/#/node?id=${MODEL}`);
  const row = page.getByTestId('node-title-row');
  const graphLink = row.locator('a.quick-link[title="View in graph"]');
  await expect(graphLink).toBeVisible();
  await expect(graphLink).toHaveAttribute('href', hrefTo('graph/view', 'focus', MODEL));
  // A fixture plugin's quick action uses its own icon and query param.
  const okLink = row.locator('a.quick-link[title="Quick OK"]');
  await expect(okLink).toHaveAttribute('href', hrefTo('ok/home', 'target', MODEL));
  await expect(okLink.locator('i.fa-star')).toHaveCount(1);
  // The menu trigger is an icon button and the last item of the row.
  const trigger = row.getByRole('button', { name: /open in/i });
  await expect(trigger).toHaveAttribute('title', 'Open in');
  await expect(trigger.locator('span')).toHaveCount(0);
  const order = await row.evaluate(el => [...el.querySelectorAll('a.quick-link, .open-in-trigger')]
    .map(node => (node.classList.contains('open-in-trigger') ? 'trigger' : 'quick')));
  expect(order[order.length - 1]).toBe('trigger');
  expect(order.filter(item => item === 'quick').length).toBeGreaterThanOrEqual(2);
  const lastRight = await row.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.right - el.querySelector('.open-in-trigger').getBoundingClientRect().right;
  });
  expect(lastRight).toBeLessThan(2);
  // The menu lists everything, quick actions included, with the existing separator.
  await trigger.click();
  const menu = page.getByRole('menu');
  for (const name of ['Default view', 'Claim A', 'Claim B', 'View in OK', 'Quick OK', 'View in graph']) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'View in graph' })).toHaveAttribute('href', hrefTo('graph/view', 'focus', MODEL));
  await expect(menu.getByRole('separator')).toHaveCount(1);
});

test('relation rows show quick icons targeting the linked node', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  await page.goto(`/#/node?id=${MODEL}`);
  const rows = page.locator('[data-testid="edge-row"]');
  await expect(rows.first()).toBeVisible();
  const linkedId = await rows.first().getAttribute('title');
  const quick = rows.first().locator('a.quick-link[title="View in graph"]');
  await expect(quick).toHaveAttribute('href', hrefTo('graph/view', 'focus', linkedId));
  // Only actions that opt into the relations surface appear there.
  await expect(rows.first().locator('a.quick-link[title="Quick OK"]')).toHaveCount(0);
  // Clicking the icon goes to the graph without also navigating the row.
  await quick.click();
  await expect.poll(() => page.url()).toContain(`/p/graph/view?focus=${linkedId}`);
});

test('node page title row wraps on a phone without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/#/node?id=${MODEL}`);
  const row = page.getByTestId('node-title-row');
  await expect(row.locator('a.quick-link').first()).toBeVisible();
  await expect(row.locator('.open-in-trigger')).toBeVisible();
  const metrics = await page.evaluate(() => ({
    docWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
    rowRight: document.querySelector('[data-testid="node-title-row"]').getBoundingClientRect().right,
    triggerRight: document.querySelector('.open-in-trigger').getBoundingClientRect().right,
  }));
  expect(metrics.docWidth).toBe(metrics.viewport);
  expect(metrics.triggerRight).toBeLessThanOrEqual(metrics.viewport);
  expect(metrics.rowRight).toBeLessThanOrEqual(metrics.viewport);
});

test('node claimed by one plugin redirects to its page', async ({ page }) => {
  await page.goto(`/#/node?id=${EVENT}`);
  await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
  await expect(page).toHaveURL(/#\/(.+\/)?p\/claim-solo\/home\?id=/);
});

test('unclaimed node shows the generic page', async ({ page }) => {
  await page.goto(`/#/node?id=${SCHEMA_NODE}`);
  await expect(page.locator('.detail-pane h1')).toBeVisible();
  // No claimant pages: the menu holds only node actions, never a Default view entry.
  await page.locator('[data-testid="open-in"]').getByRole('button', { name: /open in/i }).click();
  await expect(page.getByRole('menuitem', { name: /default view/i })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'View in graph' })).toBeVisible();
  await expect(page).toHaveURL(/#\/(.+\/)?node\?id=/);
});

test('plugin page is not remounted when only query params change', async ({ page }) => {
  await page.goto('/#/p/mount-counter/home?n=1');
  await expect(page.getByTestId('counter-n')).toHaveText('1');
  await expect(page.getByTestId('counter-mounts')).toHaveText('1');
  await page.getByTestId('counter-next').click();
  await expect(page.getByTestId('counter-n')).toHaveText('2');
  await expect(page.getByTestId('counter-mounts')).toHaveText('1');
  // A different page does remount it.
  await page.locator('.nav-rail-item', { hasText: 'Dashboard' }).click();
  await page.locator('.nav-rail-item', { hasText: 'Mount Counter' }).click();
  await expect(page.getByTestId('counter-mounts')).toHaveText('2');
});

test('child nodes resolve to their owning root and redirect with the child id', async ({ page }) => {
  const field = 'orders.DomainEvent.order-placed.schemas.order-placed-payload.fields.orderId';
  await page.goto(`/#/node?id=${field}`);
  await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
  await expect.poll(() => page.url()).toContain(`/p/claim-solo/home?id=${field}`);
});

test('a failing /api/plugins shows a non-blocking notice instead of silently hiding plugins', async ({ page }) => {
  await page.route('**/api/plugins', route => route.fulfill({ status: 500, json: { error: 'boom' } }));
  await page.goto('/');
  await expect(page.getByTestId('plugins-failed')).toContainText('Plugins failed to load');
  await expect(page.locator('.nav-rail-item', { hasText: 'Dashboard' })).toBeVisible();
});

test('a failing host module load shows a readable error instead of a blank page', async ({ page }) => {
  await page.route('**/sdk/index.js', route => route.abort());
  await page.goto('/');
  await expect(page.getByTestId('boot-error')).toContainText('failed to start');
});

test('mobile nav rail scrolls within itself and keeps buttons equal width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/#/dashboard');
  const items = page.locator('.nav-rail-item');
  await expect(items.first()).toBeVisible();
  expect(await items.count()).toBeGreaterThan(6);
  const metrics = await page.evaluate(() => {
    const rail = document.querySelector('.nav-rail');
    return {
      docWidth: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      railScrolls: rail.scrollWidth > rail.clientWidth,
      widths: [...document.querySelectorAll('.nav-rail-item')].map(el => Math.round(el.getBoundingClientRect().width)),
    };
  });
  expect(metrics.docWidth).toBe(metrics.viewport);
  expect(metrics.railScrolls).toBe(true);
  expect(new Set(metrics.widths).size).toBe(1);
});
