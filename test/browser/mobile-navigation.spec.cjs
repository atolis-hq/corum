const { test, expect } = require('@playwright/test');

async function openList(page) {
  await page.goto('/#/p/explorer/namespaces');
  await page.locator('.explorer-nav-section-head').filter({ hasText: 'orders' }).click();
  const template = page.locator('.explorer-nav-template-head').filter({ hasText: 'Domain' }).first();
  await template.click();
  await expect(page.locator('.explorer-nav-node-item').first()).toBeVisible();
}

async function expectDetail(page) {
  await expect(page.locator('.detail-pane h1')).toBeFocused();
  await expect(page.locator('.list-pane')).toHaveAttribute('inert', '');
  await expect(page.locator('.list-pane')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.detail-pane')).not.toHaveAttribute('inert');
}

async function expectList(page) {
  await expect(page).toHaveURL(/\/p\/explorer\/namespaces$/);
  await expect(page.locator('.explorer-nav-node-item.active')).toBeFocused();
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
  expect((await page.locator('.explorer-nav-tree').boundingBox()).height).toBeGreaterThan(500);
  expect(await page.locator('.detail-pane').evaluate(el => getComputedStyle(el).transitionDuration)).toContain('0.22s');
  const item = page.locator('.explorer-nav-node-item').first();
  const title = await item.getAttribute('title');
  await item.focus();
  await item.press('Enter');
  await expectDetail(page);
  const back = page.getByRole('button', { name: 'Back to models' });
  expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await back.click();
  await expectList(page);
  await expect(page.locator('.explorer-nav-node-item.active')).toHaveAttribute('title', title);
  const scroll = await page.locator('.explorer-nav-tree').evaluate(el => { el.scrollTop = 30; return el.scrollTop; });
  expect(scroll).toBeGreaterThan(0);
  await page.locator('.explorer-nav-node-item.active').press('Enter');
  await expectDetail(page);
  await page.goBack();
  await expectList(page);
  expect(await page.locator('.explorer-nav-tree').evaluate(el => el.scrollTop)).toBe(scroll);
  await page.goForward();
  await expectDetail(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('.list-pane')).not.toHaveAttribute('inert');
  await expect(back).toBeHidden();
  await expect(page.locator('.explorer-nav-node-item.active')).toHaveAttribute('title', title);
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
  await expect(page).toHaveURL(/#\/feature%2Fmobile\/p\/explorer\/namespaces$/);
  await page.goForward();
  await expectDetail(page);
  await page.getByRole('button', { name: 'Back to models' }).click();
  await expectList(page);
});

test('generic namespace page opens as a detail pane and Back returns to the list', async ({ page }) => {
  await page.goto('/#/p/explorer/namespace?name=orders');
  await expectDetail(page);
  await expect(page.locator('.detail-pane h1')).toHaveText('orders');
  await page.getByRole('button', { name: 'Back to models' }).click();
  await expect(page).toHaveURL(/\/p\/explorer\/namespaces$/);
  await expect(page.locator('.detail-pane')).toHaveAttribute('inert', '');
});

test('reduced motion, landscape, dashboard and graph', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 667, height: 375 });
  await openList(page);
  await page.locator('.explorer-nav-node-item').first().click();
  await expectDetail(page);
  expect(await page.locator('.detail-pane').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  await page.getByRole('button', { name: 'Back to models' }).click();
  await expectList(page);
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.hero-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'Graph', exact: true }).click();
  await expect(page.locator('.graph-section')).toBeVisible();
  expect((await page.locator('.graph-section').boundingBox()).height).toBeGreaterThan(100);
});

test('branch discovery and equivalent host updates preserve the detail and user focus', async ({ page }) => {
  let releaseInitial;
  let releaseRefresh;
  const initialGate = new Promise(resolve => { releaseInitial = resolve; });
  const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
  let branchRequests = 0;
  let clusterRequests = 0;
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/cluster') clusterRequests++;
  });
  await page.route('**/api/branches', async route => {
    const request = ++branchRequests;
    const response = await route.fetch();
    if (request === 1) {
      await initialGate;
      await route.fulfill({ response });
    } else if (request === 2) {
      await refreshGate;
      const data = await response.json();
      // A visible marker proves the later branch response reached React.
      await route.fulfill({ response, json: { ...data, results: [
        ...(data.results || []), { ref: 'unavailable-test-branch', status: 'failed', error: 'Unavailable' },
      ] } });
    } else {
      await route.fulfill({ response });
    }
  });
  try {
    await page.goto('/#/node?id=orders.DomainModel.order');
    await expect(page.getByText('Loading graph...', { exact: true })).toBeVisible();
    await expect.poll(() => branchRequests).toBe(1);
    expect(clusterRequests).toBe(0);
    releaseInitial();
    await expectDetail(page);
    await expect.poll(() => branchRequests).toBe(2);
    const heading = await page.locator('.detail-pane h1').elementHandle();
    const back = page.getByRole('button', { name: 'Back to models' });
    await back.focus();
    releaseRefresh();
    await expect(page.locator('.branch-failed-badge')).toHaveText('1 failed');
    // Flush the effects and ensuing renders from this specific host update.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(clusterRequests).toBe(1);
    expect(await heading.evaluate(el => el.isConnected)).toBe(true);
    await expect(back).toBeFocused();
    await back.press('Enter');
    await expectList(page);
  } finally {
    releaseInitial();
    releaseRefresh();
  }
});
