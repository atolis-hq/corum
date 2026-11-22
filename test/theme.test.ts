import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'

const WEB = path.join(process.cwd(), 'web')
const theme = await import(pathToFileURL(path.join(WEB, 'host', 'theme.js')).href)

// The registry the host builds from /api/plugins: here the built-in light and dark themes.
theme.registerThemes([{
  id: 'themes',
  status: 'enabled',
  manifest: { contributes: { themes: [
    { id: 'light', label: 'Light', colorScheme: 'light' },
    { id: 'dark', label: 'Dark', colorScheme: 'dark' },
  ] } },
}])

function fakeWindow(stored: unknown, dark: boolean, opts: { throwStorage?: boolean } = {}) {
  const attrs: Record<string, string> = {}
  const listeners: Array<() => void> = []
  const store = new Map<string, string>()
  if (stored !== undefined) store.set('corum:theme', stored as string)
  const win: any = {
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } },
    localStorage: {
      getItem: (k: string) => { if (opts.throwStorage) throw new Error('denied'); return store.has(k) ? store.get(k) : null },
      setItem: (k: string, v: string) => { if (opts.throwStorage) throw new Error('denied'); store.set(k, v) },
    },
    matchMedia: () => ({
      get matches() { return dark },
      addEventListener: (_: string, fn: () => void) => { listeners.push(fn) },
      removeEventListener: () => {},
    }),
  }
  return { win, attrs, store, setDark: (v: boolean) => { dark = v; listeners.forEach(fn => fn()) } }
}

describe('theme module (ADR-011 section 8)', () => {
  it('honours a stored registered theme; everything else is system', () => {
    for (const value of ['light', 'dark']) assert.equal(theme.readChoice(fakeWindow(value, false).win.localStorage), value)
    for (const value of [undefined, '', 'system', 'solarized', '{"a":1}']) {
      assert.equal(theme.readChoice(fakeWindow(value, false).win.localStorage), 'system', String(value))
    }
  })

  it('system follows prefers-color-scheme; explicit themes ignore it', () => {
    assert.equal(theme.resolveTheme('system', true), 'dark')
    assert.equal(theme.resolveTheme('system', false), 'light')
    assert.equal(theme.resolveTheme('light', true), 'light')
    assert.equal(theme.resolveTheme('dark', false), 'dark')
    assert.equal(theme.resolveTheme('solarized', true), 'dark')
  })

  it('setChoice persists, applies, and rejects unknown ids as system', () => {
    const f = fakeWindow(undefined, false)
    assert.equal(theme.setChoice('dark', f.win), 'dark')
    assert.equal(f.store.get('corum:theme'), 'dark')
    assert.equal(f.attrs['data-theme'], 'dark')
    assert.equal(theme.setChoice('nope', f.win), 'system')
    assert.equal(f.store.get('corum:theme'), 'system')
    assert.equal(f.attrs['data-theme'], 'light')
  })

  it('system updates live on OS change; explicit theme does not', () => {
    const f = fakeWindow('system', false)
    theme.applyTheme('system', f.win)
    theme.watchSystem(f.win)
    f.setDark(true)
    assert.equal(f.attrs['data-theme'], 'dark')
    const g = fakeWindow('light', false)
    theme.applyTheme('light', g.win)
    theme.watchSystem(g.win)
    g.setDark(true)
    assert.equal(g.attrs['data-theme'], 'light')
  })

  it('storage failures do not throw and fall back to system', () => {
    const f = fakeWindow(undefined, true, { throwStorage: true })
    assert.equal(theme.getChoice(f.win), 'system')
    assert.doesNotThrow(() => theme.setChoice('dark', f.win))
    assert.equal(f.attrs['data-theme'], 'dark')
  })

  it('inline first-paint script agrees with the module (an unregistered stored id is applied until the registry loads)', () => {
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    const match = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/)
    assert.ok(match, 'inline theme-boot script present before first paint')
    assert.ok(html.indexOf('theme-boot') < html.indexOf('rel="stylesheet"'), 'script runs before stylesheets')
    for (const dark of [true, false]) {
      for (const stored of [undefined, 'light', 'dark', 'system', 'solarized']) {
        for (const throwStorage of [false, true]) {
          const f = fakeWindow(stored, dark, { throwStorage })
          vm.runInNewContext(match[1], {
            localStorage: f.win.localStorage,
            matchMedia: f.win.matchMedia,
            document: f.win.document,
          })
          // The registry is unknown at first paint: a stored id (a plugin theme, say) is applied as is; host/boot.js
          // corrects it after the plugin list loads.
          const keepsId = !throwStorage && stored !== undefined && stored !== 'system'
          const expected = keepsId ? stored : theme.resolveTheme(theme.getChoice(f.win), dark)
          assert.equal(f.attrs['data-theme'], expected, `stored=${stored} dark=${dark} throw=${throwStorage}`)
        }
      }
    }
  })
})
