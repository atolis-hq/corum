const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 } });

const MODEL = 'orders.DomainModel.order';
const EVENT = 'orders.DomainEvent.order-placed';
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
  await expect(bar.getByRole('menuitem', { name: /generic/i })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: 'View in OK' })).toBeVisible();
  await bar.getByRole('menuitem', { name: 'Claim B' }).click();
  await expect(page.getByTestId('plugin-claim-b')).toBeVisible();
});

test('node claimed by one plugin redirects to its page', async ({ page }) => {
  await page.goto(`/#/node?id=${EVENT}`);
  await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
  await expect(page).toHaveURL(/#\/(.+\/)?p\/claim-solo\/home\?id=/);
});

test('unclaimed node shows the generic page', async ({ page }) => {
  await page.goto(`/#/node?id=${SCHEMA_NODE}`);
  await expect(page.locator('.detail-pane h1')).toBeVisible();
  await expect(page.locator('[data-testid="open-in"]')).toHaveCount(0);
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
