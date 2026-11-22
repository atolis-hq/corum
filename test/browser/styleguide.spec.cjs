/*
 * Style guide runtime and visual checks (ADR-011 section 9). The guide (web/builtin/styleguide) renders the whole
 * styling contract; this spec opens it in every registered theme and asserts:
 *   - no visual inline styles (only custom properties) in the DOM,
 *   - axe-core finds no colour-contrast violations,
 *   - every focusable sample shows a visible --ring focus indicator,
 *   - a sentinel theme (every colour token set to one conspicuous colour) leaves no element outside pack-coloured ones
 *     in its original palette,
 *   - the page matches the per-theme screenshot baseline (test/browser/styleguide.spec.cjs-snapshots/, Linux).
 * Update baselines: `npm run test:web -- styleguide --update-snapshots` (see docs/styling.md).
 */
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const GUIDE = '[data-testid="styleguide"]';
const SENTINEL = [255, 0, 255];
const URL = '/#/p/styleguide/home';
const THEMES = ['Light', 'Dark', 'High contrast'];

// Tall enough that the whole guide is in view, so the element screenshot is the whole page.
test.use({ viewport: { width: 1280, height: 6000 } });

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', ...parts), 'utf8'));

/** Flat token list from tokens.json: { name, type, scope }. */
function tokens() {
  const found = [];
  const visit = (node, inherited) => {
    const type = node.$type ?? inherited;
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') || typeof child !== 'object' || child === null) continue;
      if ('$value' in child) found.push({ name: `--${key}`, type: child.$type ?? type, scope: child.$extensions?.corum?.scope ?? 'theme' });
      else visit(child, type);
    }
  };
  visit(readJson('web', 'sdk', 'tokens.json'), undefined);
  return found;
}

const settings = page => page.locator('.settings');

async function registeredThemes(page) {
  await page.goto('/');
  await settings(page).getByRole('button', { name: 'Settings' }).click();
  const radios = settings(page).getByRole('menuitemradio');
  await expect(radios.nth(1)).toBeVisible();
  const names = (await radios.allInnerTexts()).map(name => name.trim()).filter(name => name && name !== 'System');
  await page.keyboard.press('Escape');
  return names;
}

async function openGuide(page, themeLabel) {
  await page.goto(URL);
  if (themeLabel) {
    await settings(page).getByRole('button', { name: 'Settings' }).click();
    await settings(page).getByRole('menuitemradio', { name: themeLabel }).click();
  }
  await expect(page.locator(GUIDE)).toBeVisible();
  await expect(page.locator('[data-testid="styleguide-vocabulary"]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('the guide is hidden from the rail and reachable from the Settings menu and by URL', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  await expect(page.locator('.nav-rail').getByText('Style guide')).toHaveCount(0);
  await settings(page).getByRole('button', { name: 'Settings' }).click();
  await settings(page).getByRole('menuitem', { name: 'Style guide' }).click();
  await expect(page).toHaveURL(/#.*\/p\/styleguide\/home/);
  await expect(page.locator(GUIDE)).toBeVisible();
  await page.goto(URL);
  await expect(page.locator(GUIDE)).toBeVisible();
});

test('the guide lists every documented token and standard class', async ({ page }) => {
  await openGuide(page);
  const classes = Object.keys(readJson('web', 'sdk', 'classes.json').classes);
  const colours = tokens().filter(token => token.type === 'color');
  await expect(page.locator('[data-token]')).toHaveCount(colours.length);
  await expect(page.locator('[data-class]')).toHaveCount(classes.length);
});

test('the registered themes are the ones the guide is checked in', async ({ page }) => {
  expect((await registeredThemes(page)).sort()).toEqual([...THEMES].sort());
});

for (const label of THEMES) {
  test.describe(`theme: ${label}`, () => {
    test('has no visual inline styles', async ({ page }) => {
      await openGuide(page, label);
      const offenders = await page.evaluate(() => [...document.querySelectorAll('[style]')]
        .map(el => ({ tag: el.tagName.toLowerCase(), props: [...el.style].filter(prop => !prop.startsWith('--')) }))
        .filter(entry => entry.props.length > 0));
      expect(offenders).toEqual([]);
    });

    test('has no axe colour-contrast violations', async ({ page }) => {
      await openGuide(page, label);
      await page.addScriptTag({ path: require.resolve('axe-core') });
      const violations = await page.evaluate(async (selector) => {
        const out = await window.axe.run(document.querySelector(selector), { runOnly: ['color-contrast'] });
        return out.violations.flatMap(v => v.nodes.map(n => ({ rule: v.id, target: n.target.join(' '), summary: n.failureSummary })));
      }, GUIDE);
      expect(violations).toEqual([]);
    });

    test('shows a visible --ring focus indicator on every focusable sample', async ({ page }) => {
      await openGuide(page, label);
      const results = await page.evaluate((selector) => {
        const root = document.querySelector(selector);
        const focusable = [...root.querySelectorAll('a[href], button:not([disabled]), [tabindex="0"]')].filter(el => el.tabIndex >= 0);
        const probe = document.createElement('span');
        probe.setAttribute('class', 'text-warning');
        root.appendChild(probe);
        probe.style.setProperty('color', 'var(--ring)');
        const ringColour = getComputedStyle(probe).color;
        probe.remove();
        const bad = [];
        for (const el of focusable) {
          el.focus({ focusVisible: true });
          const style = getComputedStyle(el);
          const visible = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0 && style.outlineColor === ringColour;
          if (!visible) bad.push(`${el.tagName.toLowerCase()}.${el.className} outline=${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} (ring ${ringColour})`);
        }
        return { count: focusable.length, bad };
      }, GUIDE);
      expect(results.count).toBeGreaterThan(5);
      expect(results.bad).toEqual([]);
    });

    test('matches the visual baseline', async ({ page }) => {
      await openGuide(page, label);
      await expect(page.locator(GUIDE)).toHaveScreenshot(`styleguide-${label.toLowerCase().replace(/\s+/g, '-')}.png`, {
        animations: 'disabled',
        maxDiffPixelRatio: 0.002,
      });
    });
  });
}

test('a sentinel theme leaves no non-pack-coloured element in its original palette', async ({ page }) => {
  await openGuide(page);
  const themeTokens = tokens().filter(token => token.scope === 'theme');
  const sentinel = `rgb(${SENTINEL.join(', ')})`;
  const css = [
    ':root, html[data-theme] {',
    ...themeTokens.filter(token => token.type === 'color').map(token => `  ${token.name}: ${sentinel} !important;`),
    ...themeTokens.filter(token => token.type === 'shadow').map(token => `  ${token.name}: 0 0 0 1px ${sentinel} !important;`),
    '}',
  ].join('\n');

  const collectStrays = ({ selector, sentinelRgb }) => {
    // Computed colours may be in any CSS colour space (color-mix gives oklch); a canvas pixel normalises them to sRGB.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const isSentinel = value => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return a === 0 || (Math.abs(r - sentinelRgb[0]) <= 2 && Math.abs(g - sentinelRgb[1]) <= 2 && Math.abs(b - sentinelRgb[2]) <= 2);
    };
    const out = [];
    for (const el of document.querySelector(selector).querySelectorAll('*')) {
      // Pack-coloured elements take their colour from pack data, not from the theme; the icon font has no colours of its own.
      if (el.closest('.node-coloured, .edge-coloured')) continue;
      const style = getComputedStyle(el);
      const checks = { color: [style.color], backgroundColor: [style.backgroundColor] };
      for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
        if (parseFloat(style[`border${side}Width`]) > 0 && style[`border${side}Style`] !== 'none') checks[`border${side}Color`] = [style[`border${side}Color`]];
      }
      if (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) checks.outlineColor = [style.outlineColor];
      if (style.boxShadow !== 'none') checks.boxShadow = style.boxShadow.match(/(?:rgba?|oklch|color)\([^)]*\)/g) ?? [];
      for (const [prop, values] of Object.entries(checks)) {
        if (!values.every(isSentinel)) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').join('.')} ${prop}=${values.join(' ')}`);
      }
    }
    return [...new Set(out)];
  };
  const args = { selector: GUIDE, sentinelRgb: SENTINEL };
  // Control: without the sentinel theme the check finds plenty, so it is not vacuous.
  expect((await page.evaluate(collectStrays, args)).length).toBeGreaterThan(20);
  await page.addStyleTag({ content: css });
  await page.waitForTimeout(100);
  expect(await page.evaluate(collectStrays, args)).toEqual([]);
});
