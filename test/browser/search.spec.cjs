const { test, expect } = require('@playwright/test');
const child = 'orders.DomainModel.order.operations.place';
test('search finds an operation with its owner and focuses it in the host view', async ({ page }) => {
  await page.addInitScript(() => {
    window.scrolledNodes = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...args) {
      window.scrolledNodes.push(this.id);
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await page.locator('.topbar-search').click();
  await page.locator('.search-modal-input').fill('place');
  const row = page.locator('.search-result-row').filter({ has: page.locator('.search-result-name', { hasText: /^place$/ }) });
  await expect(row).toContainText('orders.DomainModel.order');
  await row.click();
  await expect(page).toHaveURL(new RegExp('/node\\?id=' + child.replaceAll('.', '\\.')));
  await expect(page.getByRole('heading', { name: 'order', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrolledNodes.some(id => id.includes('operations') && id.includes('place')))).toBe(true);
});
