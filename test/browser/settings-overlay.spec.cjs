const { test, expect } = require('@playwright/test');

const trigger = page => page.getByRole('button', { name: 'Settings' });

test('settings menu is a top-level overlay on a phone', async ({ page }) => {
  await page.goto('/');
  await trigger(page).tap();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  const vp = page.viewportSize();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
  const result = await page.evaluate(() => {
    const el = document.querySelector('[role="menu"]');
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return { topIsMenu: el.contains(top), inRail: !!el.closest('.nav-rail') };
  });
  expect(result.topIsMenu).toBe(true);
  expect(result.inRail).toBe(false);
});

test('backdrop tap closes the menu and returns focus to the trigger', async ({ page }) => {
  await page.goto('/');
  await trigger(page).tap();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.getByTestId('settings-backdrop').tap({ position: { x: 187, y: 20 } });
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test('Escape closes the menu and returns focus to the trigger', async ({ page }) => {
  await page.goto('/');
  await trigger(page).tap();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});
