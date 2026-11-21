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

test('nav rail lists host items (Dashboard, Explorer) before plugin pages sorted by order', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nav-rail-item', { hasText: 'OK Plugin' })).toBeVisible();
  const labels = await page.locator('.nav-rail-item span').allTextContents();
  expect(labels.slice(0, 2)).toEqual(['Dashboard', 'Explorer']);
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
  const bar = page.getByTestId('node-title-row').getByTestId('open-in');
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: /open in/i }).click();
  await expect(bar.getByRole('menuitem', { name: 'Claim A' })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: 'Claim B' })).toBeVisible();
  await expect(bar.getByRole('menuitem', { name: /explorer view/i })).toBeVisible();
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
  const okLink = row.locator('a.quick-link[title="View in OK"]');
  await expect(okLink).toHaveAttribute('href', hrefTo('ok/home', 'id', MODEL));
  await expect(okLink.locator('i.fa-star')).toHaveCount(1);
  // The menu trigger is an icon button and the last item of the row.
  const trigger = row.getByRole('button', { name: /open in/i });
  await expect(trigger).toHaveAttribute('title', 'Open in');
  await expect(trigger.locator('span')).toHaveCount(0);
  const order = await row.evaluate(el => [...el.querySelectorAll('a.quick-link, .open-in-trigger')]
    .map(node => (node.classList.contains('open-in-trigger') ? 'trigger' : 'quick')));
  expect(order[order.length - 1]).toBe('trigger');
  expect(order.filter(item => item === 'quick').length).toBeGreaterThanOrEqual(2);
  const menuGap = await row.evaluate(el => {
    const quickLinks = el.querySelectorAll('a.quick-link');
    const lastQuick = quickLinks[quickLinks.length - 1].getBoundingClientRect();
    return el.querySelector('.open-in-trigger').getBoundingClientRect().left - lastQuick.right;
  });
  expect(menuGap).toBeGreaterThanOrEqual(0);
  expect(menuGap).toBeLessThanOrEqual(12);
  // The menu lists everything, quick actions included, with the existing separator.
  await trigger.click();
  const menu = page.getByRole('menu');
  for (const name of ['Explorer view', 'Claim A', 'Claim B', 'View in OK', 'View in graph']) {
    await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  }
  await expect(menu.getByRole('menuitem', { name: 'View in OK', exact: true })).toHaveCount(1);
  await expect(menu.getByRole('menuitem', { name: 'Quick OK', exact: true })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'View in OK', exact: true })).toHaveAttribute('href', await okLink.getAttribute('href'));
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
  // Clicking the icon goes to the graph without also navigating the row.
  await quick.click();
  await expect.poll(() => page.url()).toContain(`/p/graph/view?focus=${linkedId}`);
});

test('connection row menu and star target an owned child and preserve the viewed branch', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  const { default: ref } = await (await request.get('/api/branches')).json();
  expect(ref).toBeTruthy();
  const prefix = `#/${encodeURIComponent(ref)}`;
  const linkedId = 'payments.DomainModel.payment.operations.capture';
  await page.goto(`/${prefix}/node?id=payments.APIEndpoint.complete-payment`);
  const row = page.locator(`[data-testid="edge-row"][title="${linkedId}"]`);
  const star = row.locator('a.quick-link[title="View in OK"]');
  await expect(star).toHaveAttribute('href', `${prefix}/p/ok/home?id=${linkedId}`);
  await expect(star.locator('i.fa-star')).toHaveCount(1);
  const originalUrl = page.url();
  const trigger = row.getByRole('button', { name: 'Open in', exact: true });
  await trigger.click();
  await expect(page).toHaveURL(originalUrl);
  const menu = row.getByRole('menu');
  await expect(menu.getByRole('menuitem', { name: 'Claim A', exact: true })).toHaveAttribute('href', `${prefix}/p/claim-a/home?id=${linkedId}`);
  await expect(menu.getByRole('menuitem', { name: 'Claim B', exact: true })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'View in graph', exact: true })).toHaveAttribute('href', `${prefix}/p/graph/view?focus=${linkedId}`);
  const okItem = menu.getByRole('menuitem', { name: 'View in OK', exact: true });
  await expect(okItem).toHaveCount(1);
  await expect(okItem).toHaveAttribute('href', await star.getAttribute('href'));
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await trigger.click();
  // This last item extends past the card: it must remain visible and clickable.
  await okItem.click();
  await expect(page).toHaveURL(`${new URL(originalUrl).origin}/${prefix}/p/ok/home?id=${linkedId}`);
  await expect(page.getByTestId('plugin-ok-id')).toHaveText(linkedId);
});

test('a connection row can open a claimant without triggering the row navigation', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  await page.goto('/#/node?id=payments.APIEndpoint.complete-payment');
  const linkedId = 'payments.DomainModel.payment.operations.capture';
  const row = page.locator(`[data-testid="edge-row"][title="${linkedId}"]`);
  await row.getByRole('button', { name: 'Open in', exact: true }).click();
  await row.getByRole('menuitem', { name: 'Claim A', exact: true }).click();
  await expect(page.getByTestId('plugin-claim-a')).toBeVisible();
  await expect.poll(() => page.url()).toContain(`/p/claim-a/home?id=${linkedId}`);
});

test('connection-row action controls remain visible and usable on a phone', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  await page.goto('/#/node?id=payments.APIEndpoint.complete-payment');
  const row = page.locator('[data-testid="edge-row"]').first();
  const star = row.locator('a.quick-link[title="View in OK"]');
  await expect(star).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(star).toBeInViewport();
  const trigger = row.getByRole('button', { name: 'Open in', exact: true });
  await expect(trigger).toBeInViewport();
  await trigger.click();
  await row.getByRole('menuitem', { name: 'View in OK', exact: true }).click();
  await expect(page.getByTestId('plugin-ok-id')).toHaveText('payments.DomainModel.payment.operations.capture');
});

test('connection rows hide disabled plugin links and have no empty overflow menu', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  await page.route('**/api/plugins', async route => {
    const response = await route.fetch();
    const plugins = await response.json();
    await route.fulfill({ response, json: plugins.map(plugin => ({ ...plugin, status: 'disabled' })) });
  });
  await page.goto('/#/node?id=payments.APIEndpoint.complete-payment');
  const row = page.locator('[data-testid="edge-row"]').first();
  await expect(row).toBeVisible();
  await expect(row.locator('a.quick-link')).toHaveCount(0);
  await expect(row.getByRole('button', { name: 'Open in', exact: true })).toHaveCount(0);
});

for (const menuSetting of [false, undefined]) {
  test(`quick links remain independent of menu: ${menuSetting ?? 'omitted'}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
    await page.route('**/api/plugins', async route => {
      const response = await route.fetch();
      const plugins = await response.json();
      const graph = plugins.find(plugin => plugin.id === 'graph');
      for (const action of graph.manifest.contributes.nodeActions) {
        if (menuSetting === undefined) delete action.menu;
        else action.menu = menuSetting;
      }
      await route.fulfill({ response, json: plugins });
    });
    await page.goto('/#/node?id=payments.APIEndpoint.complete-payment');
    const header = page.getByTestId('node-title-row');
    await expect(header.locator('a.quick-link[title="View in graph"]')).toBeVisible();
    if (menuSetting === false) {
      await expect(header.getByRole('button', { name: 'Open in', exact: true })).toHaveCount(0);
    } else {
      await header.getByRole('button', { name: 'Open in', exact: true }).click();
      await expect(header.getByRole('menuitem', { name: 'View in graph', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const row = page.locator('[data-testid="edge-row"]').first();
    await expect(row.locator('a.quick-link[title="View in graph"]')).toBeVisible();
    await row.getByRole('button', { name: 'Open in', exact: true }).click();
    await expect(row.getByRole('menuitem', { name: 'View in OK', exact: true })).toBeVisible();
    await expect(row.getByRole('menuitem', { name: 'View in graph', exact: true })).toHaveCount(menuSetting === false ? 0 : 1);
  });
}

test('menu-only actions appear in headers and connection menus without quick icons', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
  await page.route('**/api/plugins', async route => {
    const response = await route.fetch();
    const plugins = await response.json();
    const ok = plugins.find(plugin => plugin.id === 'ok');
    for (const action of ok.manifest.contributes.nodeActions) action.quick = [];
    await route.fulfill({ response, json: plugins });
  });
  await page.goto(`/#/node?id=${MODEL}`);
  const header = page.getByTestId('node-title-row');
  await expect(header.locator('a.quick-link[title="View in OK"]')).toHaveCount(0);
  await header.getByRole('button', { name: 'Open in', exact: true }).click();
  await expect(header.getByRole('menuitem', { name: 'View in OK', exact: true })).toBeVisible();
  await page.goto('/#/node?id=payments.APIEndpoint.complete-payment');
  const row = page.locator('[data-testid="edge-row"]').first();
  await expect(row.locator('a.quick-link[title="View in OK"]')).toHaveCount(0);
  await row.getByRole('button', { name: 'Open in', exact: true }).click();
  await expect(row.getByRole('menuitem', { name: 'View in OK', exact: true })).toBeVisible();
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
  // No claimant pages: the menu holds only node actions, never a Explorer view entry.
  await page.getByTestId('node-title-row').getByRole('button', { name: /open in/i }).click();
  await expect(page.getByRole('menuitem', { name: /explorer view/i })).toHaveCount(0);
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

test('a plugin page renders SDK node links and a SchemaCard for the node it is opened with', async ({ page }) => {
  await page.goto(`/#/p/ok/home?id=${MODEL}`);
  const heading = page.getByTestId('ok-node-heading');
  await expect(heading).toBeVisible();
  // Quick icons and the menu come from the SDK components, driven by the plugin's own ctx.
  await expect(heading.locator('a.quick-link[title="View in graph"]')).toHaveAttribute('href', hrefTo('graph/view', 'focus', MODEL));
  const okLink = heading.locator('a.quick-link[title="View in OK"]');
  await expect(okLink).toHaveAttribute('href', hrefTo('ok/home', 'id', MODEL));
  await expect(okLink.locator('i.fa-star')).toHaveCount(1);
  const trigger = heading.getByRole('button', { name: 'Open in', exact: true });
  await trigger.click();
  const menu = heading.getByRole('menu');
  for (const name of ['Explorer view', 'Claim A', 'Claim B', 'View in OK', 'View in graph']) {
    await expect(menu.getByRole('menuitem', { name, exact: true })).toBeVisible();
  }
  await expect(menu.getByRole('separator')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  // The cluster is fetched through ctx.api and drawn with the SDK SchemaCard.
  const schema = page.getByTestId('ok-schema');
  await expect(schema).toContainText('customerId');
  await expect(schema).toContainText('totalAmount');
});

test('the ok plugin page without an id shows a hint', async ({ page }) => {
  await page.goto('/#/p/ok/home');
  await expect(page.getByTestId('plugin-ok-hint')).toBeVisible();
  await expect(page.getByTestId('ok-node-heading')).toHaveCount(0);
});

test('plugin pages refetch after a graph reload without remounting', async ({ page }) => {
  for (const [url, endpoint] of [[`/#/p/ok/home?id=${MODEL}`, '/api/cluster'], ['/#/p/graph/view', '/api/graph']]) {
    const seen = [];
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) seen.push(request.url()); });
    await page.goto(url);
    const host = page.locator('.plugin-host');
    await expect(host).toBeVisible();
    await expect.poll(() => seen.length).toBeGreaterThan(0);
    await page.waitForTimeout(300);
    const before = seen.length;
    const hash = await page.evaluate(() => location.hash);
    await host.evaluate(el => { el.dataset.mountMarker = 'kept'; });
    const response = await page.request.post('/api/reload');
    expect(response.ok()).toBe(true);
    // The reload event reaches the open page, which refetches through the same revision as host screens.
    await expect.poll(() => seen.length, { message: `${endpoint} refetched after reload` }).toBeGreaterThan(before);
    await expect(host).toHaveAttribute('data-mount-marker', 'kept');
    expect(await page.evaluate(() => location.hash)).toBe(hash);
    page.removeAllListeners('request');
  }
});

test.describe('explorer view bypass (view=explorer)', () => {
  const EVENT_NAME = 'order-placed';

  test('clicking a claimed event in the Explorer tree stays on the Explorer node page', async ({ page }) => {
    await page.goto('/#/namespaces');
    const item = page.locator(`.nav-node-item[title="${EVENT}"]`);
    const orders = page.locator('.nav-section-head', { hasText: /^orders$/i });
    await expect(orders).toBeVisible();
    if ((await orders.getAttribute('aria-expanded')) !== 'true') await orders.click();
    // Expand collapsed template groups until the event shows.
    for (const head of await page.locator('.nav-template-head[aria-expanded="false"]').all()) {
      if (await item.count()) break;
      await head.click();
    }
    await item.click();
    await expect(page.locator('.detail-pane h1')).toHaveText(EVENT_NAME);
    await expect.poll(() => page.url()).toContain(`node?id=${EVENT}&view=explorer`);
    await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
    await page.screenshot({ path: process.env.CORUM_SHOT_DIR ? `${process.env.CORUM_SHOT_DIR}/explorer-click.png` : undefined });
  });

  test('view=explorer renders the Explorer page and its Open in menu lists the claimant and Explorer view', async ({ page }) => {
    await page.goto(`/#/node?id=${EVENT}&view=explorer`);
    await expect(page.locator('.detail-pane h1')).toHaveText(EVENT_NAME);
    await page.getByTestId('node-title-row').getByRole('button', { name: /open in/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Claim Solo' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Explorer view' })).toBeVisible();
    await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
  });

  test('view=explorer shows the page with the menu when several plugins claim the node', async ({ page }) => {
    await page.goto(`/#/node?id=${MODEL}&view=explorer`);
    await expect(page.locator('.detail-pane h1')).toHaveText('order');
    await page.getByTestId('node-title-row').getByRole('button', { name: /open in/i }).click();
    await expect(page.getByRole('menuitem', { name: 'Claim A' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Claim B' })).toBeVisible();
  });

  test('a plugin page shows the node and links; Explorer view does not bounce back', async ({ page }) => {
    await page.goto(`/#/p/claim-solo/home?id=${EVENT}`);
    const header = page.getByTestId('plugin-claim-solo-node');
    await expect(header).toContainText(EVENT_NAME);
    await page.screenshot({ path: process.env.CORUM_SHOT_DIR ? `${process.env.CORUM_SHOT_DIR}/plugin-header.png` : undefined });
    await header.getByRole('button', { name: /open in/i }).click();
    await page.getByRole('menuitem', { name: 'Explorer view' }).click();
    await expect(page.locator('.detail-pane h1')).toHaveText(EVENT_NAME);
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/node\?id=.*&view=explorer/);
    await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
  });

  test('search for a claimed event still lands on the plugin page', async ({ page }) => {
    await page.goto('/#/dashboard');
    await page.locator('.topbar-search').click();
    await page.locator('.search-modal-input').fill(EVENT_NAME);
    await page.locator('.search-result-row', { hasText: EVENT_NAME }).first().click();
    await expect(page.getByTestId('plugin-claim-solo')).toBeVisible();
    await expect(page).toHaveURL(/#\/(.+\/)?p\/claim-solo\/home\?id=/);
  });

  test('a connection row click inside the Explorer view stays on Explorer views', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('corum:edgePanelOpen', 'true'));
    await page.goto(`/#/node?id=${MODEL}&view=explorer`);
    const row = page.locator('[data-testid="edge-row"]').first();
    await expect(row).toBeVisible();
    const linkedId = await row.getAttribute('title');
    await row.click();
    await expect(page.locator('.detail-pane h1')).toBeVisible();
    await expect.poll(() => page.url()).toContain('view=explorer');
    await expect.poll(() => decodeURIComponent(page.url())).toContain(`id=${linkedId}`);
    await expect(page.getByTestId('plugin-claim-solo')).toHaveCount(0);
  });
});
