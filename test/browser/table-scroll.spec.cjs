const { test, expect } = require('@playwright/test');

for (const width of [393, 1280, 1440]) {
  test(`detail tables contain horizontal overflow at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/node?id=orders.DomainModel.order');
    await expect(page.locator('.detail-pane h1')).toBeVisible();
    // Branch initialization can replace the detail DOM after its first render.
    // Retry the injection and measurement together against the current tables.
    await expect(async () => {
      // A long property key exercises natural table overflow without changing fixtures.
      await page.locator('.prop-key-label').first().evaluate(el => {
        el.textContent = 'wide_property_'.repeat(16);
      });
      for (const content of ['.prop-table', '.field-table', '.enum-table']) {
        const region = page.locator(`.table-scroll:has(> div > ${content}), .table-scroll:has(> ${content})`).first();
        await expect(region).toBeVisible();
        const metrics = await region.evaluate(el => {
          el.scrollLeft = el.scrollWidth;
          const style = getComputedStyle(el);
          return {
            width: el.clientWidth, total: el.scrollWidth, left: el.scrollLeft,
            overflow: style.overflowX, scrollbar: style.scrollbarWidth,
            webkitScrollbar: getComputedStyle(el, '::-webkit-scrollbar').display,
            max: el.scrollWidth - el.clientWidth,
          };
        });
        expect(metrics.overflow).toBe('auto');
        expect(metrics.scrollbar).toBe('none');
        expect(metrics.webkitScrollbar).toBe('none');
        if (width === 393 || content === '.prop-table') {
          expect(metrics.total).toBeGreaterThan(metrics.width);
          expect(metrics.left).toBe(metrics.max);
          expect(metrics.left).toBeGreaterThan(0);
        } else {
          expect(metrics.total).toBe(metrics.width);
          expect(metrics.left).toBe(0);
        }
      }
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth - innerWidth,
        content: document.querySelector('.content').scrollWidth - document.querySelector('.content').clientWidth,
      }));
      expect(overflow).toEqual({ document: 0, content: 0 });
    }).toPass({ timeout: 10000 });
  });
}
