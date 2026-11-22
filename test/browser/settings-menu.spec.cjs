const { test, expect } = require('@playwright/test');

const trigger = page => page.getByRole('button', { name: 'Settings' });
const html = page => page.locator('html');

test('keyboard: focus in on open, arrows wrap, Escape returns focus', async ({ page }) => {
  await page.goto('/');
  await trigger(page).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const system = page.getByRole('menuitemradio', { name: 'System' });
  await expect(system).toBeFocused();
  await expect(system).toHaveAttribute('aria-checked', 'true');
  // Themes are contributed by plugins and listed once the plugin list has loaded.
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeVisible();
  await expect(system).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Light' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Debug mode' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(system).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(page.getByRole('menuitemcheckbox', { name: 'Debug mode' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(system).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(trigger(page)).toBeFocused();
});

test('theme choice applies, persists across reload, and outside click keeps selection', async ({ page }) => {
  await page.goto('/');
  await trigger(page).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('corum:theme'))).toBe('dark');
  await expect(trigger(page)).toBeFocused();
  await page.reload();
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await trigger(page).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.mouse.click(600, 300);
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('corum:theme'))).toBe('dark');
});

test('desktop: an outside click closes the menu and still reaches the clicked element', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await trigger(page).click();
  await expect(page.getByRole('menu')).toBeVisible();
  const reached = await page.evaluate(() => {
    const el = document.elementFromPoint(700, 400);
    return !!el && !el.closest('.settings-backdrop');
  });
  expect(reached).toBe(true);
  await page.mouse.click(700, 400);
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('system follows the OS setting live; unknown stored id falls back to system', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => localStorage.setItem('corum:theme', 'solarized'));
  await page.goto('/');
  await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(html(page)).toHaveAttribute('data-theme', 'light');
});

for (const width of [375, 780]) {
  test(`narrow layout at ${width}px: trigger and menu stay inside the viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 812 });
    await page.goto('/');
    const inside = async locator => {
      const box = await locator.boundingBox();
      const vp = page.viewportSize();
      expect(box).not.toBeNull();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
      expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
    };
    await inside(trigger(page));
    await trigger(page).click();
    await inside(page.getByRole('menu'));
    for (const item of await page.getByRole('menuitemradio').all()) await inside(item);
    await inside(page.getByRole('menuitemcheckbox', { name: 'Debug mode' }));
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(html(page)).toHaveAttribute('data-theme', 'dark');
  });
}

test('debug mode keeps its storage key and value format', async ({ page }) => {
  await page.goto('/');
  await trigger(page).click();
  const debug = page.getByRole('menuitemcheckbox', { name: 'Debug mode' });
  await expect(debug).toHaveAttribute('aria-checked', 'false');
  await debug.click();
  await expect(debug).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => localStorage.getItem('corum:debugMode'))).toBe('true');
  await page.reload();
  await trigger(page).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Debug mode' })).toHaveAttribute('aria-checked', 'true');
});
