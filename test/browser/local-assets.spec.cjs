const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 1280, height: 800 } });

for (const [name, route, ready] of [
  ['Dashboard', '/', '.nav-rail-item'],
  ['node', '/#/node?id=orders.DomainModel.order', '.detail-pane h1'],
  ['Graph', '/#/p/graph/view', '.react-flow__node'],
]) {
  test(`${name} loads fonts and icons without third-party requests`, async ({ page, baseURL }, testInfo) => {
    const external = [];
    const failed = [];
    const fonts = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== new URL(baseURL).origin) {
        external.push(url.href);
        return route.abort();
      }
      return route.continue();
    });
    page.on('requestfailed', request => {
      if (['font', 'stylesheet', 'script'].includes(request.resourceType())) failed.push(request.url());
    });
    page.on('response', response => {
      if (response.url().endsWith('.woff2')) fonts.push(response);
    });
    await page.goto(route);
    await expect(page.locator(ready).first()).toBeVisible();
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load('400 16px Inter'),
        document.fonts.load('500 16px Inter'),
        document.fonts.load('600 16px Inter'),
        document.fonts.load('700 16px Inter'),
        document.fonts.load('400 16px "JetBrains Mono"'),
        document.fonts.load('500 16px "JetBrains Mono"'),
        document.fonts.load('600 16px "JetBrains Mono"'),
        document.fonts.load('900 16px "Font Awesome 6 Free"'),
      ]);
      await document.fonts.ready;
    });
    // A solid icon outside the built-in UI's vocabulary must still work for plugins.
    const icon = await page.evaluate(() => {
      const el = document.createElement('i');
      el.className = 'fa-solid fa-otter';
      document.body.append(el);
      const style = getComputedStyle(el, '::before');
      const result = { content: style.content, family: style.fontFamily };
      el.remove();
      return result;
    });
    expect(icon.content).toBe('"\uf700"');
    expect(icon.family).toContain('Font Awesome 6 Free');
    expect(fonts.length).toBeGreaterThanOrEqual(3);
    for (const response of fonts) expect(response.status()).toBe(200);
    expect(external).toEqual([]);
    expect(failed).toEqual([]);
    await testInfo.attach(`${name}.png`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}
