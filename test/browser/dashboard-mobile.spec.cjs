const { test, expect } = require('@playwright/test');

async function openDashboard(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.hero-card')).toHaveCount(4);
}

test('dashboard has no horizontal overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openDashboard(page);
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  const cards = page.locator('.hero-card');
  for (let i = 0; i < 4; i++) {
    await expect(cards.nth(i)).toBeVisible();
    const box = await cards.nth(i).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(375);
  }
});

test('dashboard hero cards stay in a single row on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await openDashboard(page);
  const tops = await page.locator('.hero-card').evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
  expect(new Set(tops).size).toBe(1);
  expect(await page.locator('.dashboard-hero').evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
});
