const { test, expect } = require('@playwright/test');

test.use({ viewport: { width: 375, height: 812 } });

async function boxes(page) {
  return page.locator('.nav-rail .nav-rail-item').evaluateAll(els =>
    els.map(el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; }));
}

function expectAligned(items) {
  expect(items.length).toBeGreaterThan(1);
  for (const item of items) {
    expect(item.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(item.height - items[0].height)).toBeLessThan(0.5);
    expect(Math.abs(item.top - items[0].top)).toBeLessThan(0.5);
    expect(Math.abs(item.bottom - items[0].bottom)).toBeLessThan(0.5);
  }
}

test('rail items, including Settings, share equal height and edges', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.settings-trigger')).toBeVisible();
  expectAligned(await boxes(page));
  expect((await page.locator('.nav-rail').boundingBox()).height).toBeLessThan(64);
});

test('a taller label grows every item together', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.settings-trigger')).toBeVisible();
  const before = await boxes(page);
  await page.locator('.nav-rail-item span').first().evaluate(el => {
    el.style.fontSize = '30px';
    el.style.lineHeight = '2';
  });
  const after = await boxes(page);
  expect(after[0].height).toBeGreaterThan(before[0].height);
  expectAligned(after);
});
