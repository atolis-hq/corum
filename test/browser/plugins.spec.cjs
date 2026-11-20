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

test('nav rail lists host items (Dashboard, Models, Graph) before plugin pages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav-rail-item', { hasText: 'OK Plugin' })).toBeVisible();
  const labels = await page.locator('.nav-rail-item span').allTextContents();
  expect(labels.slice(0, 4)).toEqual(['Dashboard', 'Models', 'Graph', 'OK Plugin']);
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

test('node claimed by two plugins shows the Open in bar and node actions', async ({ page }) => {
  await page.goto(`/#/node?id=${MODEL}`);
  const bar = page.locator('[data-testid="open-in"]');
  await expect(bar).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Claim A' })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'Claim B' })).toBeVisible();
  await expect(bar.getByRole('link', { name: /generic/i })).toBeVisible();
  await expect(bar.getByRole('link', { name: 'View in OK' })).toBeVisible();
  await bar.getByRole('link', { name: 'Claim B' }).click();
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
