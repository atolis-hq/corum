import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { pathToFileURL } from 'node:url'
import { parsePluginManifest } from '../src/web/plugins/manifest.js'
import { buildLayoutsCss, registerLayouts, sanitiseLayoutCss } from '../src/web/plugins/layouts.js'
import { catalogueFromTokensJson, sanitiseThemeCss } from '../src/web/plugins/themes.js'

const WEB = path.join(process.cwd(), 'web')
const layout = await import(pathToFileURL(path.join(WEB, 'host', 'layout.js')).href)

const base = 'id: p\nversion: 0.1.0\nengines: { corum: ">=0.1.0" }\nmain: ./index.js\n'
const parse = (contributes: string) => parsePluginManifest(`${base}contributes:\n${contributes}`)

describe('manifest contributes.layouts', () => {
  it('accepts id, label and css', () => {
    const parsed = parse('  layouts:\n    - { id: compact, label: Compact, css: ./compact.css }\n')
    assert.deepEqual(parsed.errors, [])
    assert.deepEqual(parsed.manifest?.contributes.layouts, [{ id: 'compact', label: 'Compact', css: './compact.css' }])
  })
  it('defaults to no layouts', () => {
    assert.deepEqual(parse('  pages: []\n').manifest?.contributes.layouts, [])
  })
  it('rejects bad entries with diagnostics', () => {
    const parsed = parse([
      '  layouts:',
      '    - { id: default, label: D, css: ./a.css }',
      '    - { id: x, label: X, css: ./x.css }',
      '    - { id: x, label: X2, css: ./x2.css }',
      '    - { id: Bad_Id, label: B, css: ./b.css }',
      '    - { id: nolabel, css: ./c.css }',
      '    - { id: escape, label: E, css: ../e.css }',
      '    - { id: notcss, label: N, css: ./n.txt }',
      '    - nope',
    ].join('\n'))
    assert.equal(parsed.manifest, null)
    const text = parsed.errors.join('\n')
    for (const needle of ['reserved', 'duplicated', 'must match', 'label is required', 'relative path', '.css file', 'must be a mapping']) {
      assert.match(text, new RegExp(needle))
    }
  })
  it('requires a list', () => {
    assert.match(parse('  layouts: nope\n').errors.join(), /contributes\.layouts must be a list/)
  })
})

describe('layout sanitiser', () => {
  it('keeps layout tokens from a scoped block', () => {
    const out = sanitiseLayoutCss('compact', '[data-layout="compact"] { --nav-width: 64px; --density: 0.75; --content-max: 1200px }')
    assert.deepEqual(out.errors, [])
    assert.deepEqual(out.warnings, [])
    assert.deepEqual(out.declarations, [
      { name: '--nav-width', value: '64px' }, { name: '--density', value: '0.75' }, { name: '--content-max', value: '1200px' },
    ])
  })
  it('rejects descendant and foreign selectors, at-rules, url() and markup', () => {
    for (const css of [
      '[data-layout="compact"] .nav-rail { --density: 1 }',
      '[data-layout="other"] { --density: 1 }',
      '.nav-rail { display: none }',
      '@media (min-width: 1px) { [data-layout="compact"] { --density: 1 } }',
      '[data-layout="compact"] { --density: 1; background: url(x.png) }',
      '[data-layout="compact"] { --density: 1 } </style>',
      '[data-layout="compact"] { --density: 1 } [data-layout="compact"] { --density: 2 }',
    ]) assert.equal(sanitiseLayoutCss('compact', css).declarations, null, css)
  })
  it('drops non-layout tokens and plain properties with a warning, keeping the layout', () => {
    const out = sanitiseLayoutCss('compact', '[data-layout="compact"] { --background: red; display: none; --density: 0.8 }')
    assert.deepEqual(out.declarations, [{ name: '--density', value: '0.8' }])
    assert.equal(out.warnings.length, 2)
  })
  it('drops out-of-range and malformed values', () => {
    const out = sanitiseLayoutCss('x', ':root { --nav-width: 10px; --density: 9; --content-max: 100%; --nav-width: 1em }')
    assert.deepEqual(out.declarations, [])
    assert.equal(out.warnings.length, 4)
    assert.deepEqual(sanitiseLayoutCss('x', '--content-max: none').declarations, [{ name: '--content-max', value: 'none' }])
  })
  it('a theme setting a layout token is told it is ignored', () => {
    const tokens = JSON.parse(fs.readFileSync(path.join(WEB, 'sdk', 'tokens.json'), 'utf8'))
    const out = sanitiseThemeCss(':root { --density: 0.8; --background: #fff }', catalogueFromTokensJson(tokens))
    assert.ok(!out.declarations?.some(d => d.name === '--density'))
    assert.ok(out.warnings.some(w => w.includes('--density')))
  })
})

const status = (id: string, layouts: Array<{ id: string; label: string; css: string }>, state = 'enabled') =>
  ({ id, status: state, manifest: { contributes: { pages: [], nodeActions: [], themes: [], layouts } } }) as any

describe('layout registry and stylesheet', () => {
  it('first registration wins and disabled plugins contribute nothing', () => {
    const { layouts, diagnostics } = registerLayouts([
      status('a', [{ id: 'wide', label: 'Wide', css: './w.css' }]),
      status('b', [{ id: 'wide', label: 'Wide 2', css: './w.css' }]),
      status('c', [{ id: 'off', label: 'Off', css: './o.css' }], 'disabled'),
    ])
    assert.deepEqual(layouts.map(l => [l.id, l.pluginId]), [['wide', 'a']])
    assert.equal(diagnostics.length, 1)
  })
  it('serves scoped CSS, leaving out rejected and unreadable layouts', async () => {
    const files: Record<string, string> = {
      './ok.css': '[data-layout="ok"] { --density: 0.9 }',
      './bad.css': '[data-layout="bad"] .x { --density: 0.9 }',
    }
    const built = await buildLayoutsCss([status('p', [
      { id: 'ok', label: 'Ok', css: './ok.css' },
      { id: 'bad', label: 'Bad', css: './bad.css' },
      { id: 'gone', label: 'Gone', css: './gone.css' },
    ])], async (_p, file) => files[file] ?? null)
    assert.equal(built.css, 'html[data-layout="ok"] {\n  --density: 0.9;\n}\n')
    assert.deepEqual(built.layouts.map(l => l.id), ['ok'])
    assert.equal(built.diagnostics.length, 2)
  })
  it('the built-in plugin ships compact and it is valid', async () => {
    const dir = path.join(WEB, 'builtin', 'layouts')
    const parsed = parsePluginManifest(fs.readFileSync(path.join(dir, 'plugin.yaml'), 'utf8'))
    assert.deepEqual(parsed.errors, [])
    const compact = parsed.manifest!.contributes.layouts.find(l => l.id === 'compact')
    assert.ok(compact)
    const out = sanitiseLayoutCss('compact', fs.readFileSync(path.join(dir, compact.css), 'utf8'))
    assert.deepEqual(out.errors, [])
    assert.deepEqual(out.warnings, [])
    assert.ok(out.declarations!.length >= 2)
  })
})

function fakeWindow(stored: unknown, opts: { throwStorage?: boolean } = {}) {
  const attrs: Record<string, string> = {}
  const store = new Map<string, string>()
  if (stored !== undefined) store.set('corum:layout', stored as string)
  const win: any = {
    document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } },
    localStorage: {
      getItem: (k: string) => { if (opts.throwStorage) throw new Error('denied'); return store.has(k) ? store.get(k) : null },
      setItem: (k: string, v: string) => { if (opts.throwStorage) throw new Error('denied'); store.set(k, v) },
    },
  }
  return { win, attrs, store }
}

describe('host layout selection', () => {
  it('lists default first, then registered layouts; default is reserved', () => {
    layout.registerLayouts([{ id: 'layouts', status: 'enabled', manifest: { contributes: { layouts: [
      { id: 'default', label: 'Fake' }, { id: 'compact', label: 'Compact' },
    ] } } }])
    assert.deepEqual(layout.getLayouts().map((l: any) => l.id), ['default', 'compact'])
  })
  it('persists under corum:layout and applies data-layout', () => {
    const { win, attrs, store } = fakeWindow(undefined)
    assert.equal(layout.getChoice(win), 'default')
    assert.equal(layout.setChoice('compact', win), 'compact')
    assert.equal(store.get('corum:layout'), 'compact')
    assert.equal(attrs['data-layout'], 'compact')
    assert.equal(layout.getChoice(win), 'compact')
  })
  it('falls back to default for an unregistered id without rewriting storage', () => {
    const { win, attrs, store } = fakeWindow('gone')
    assert.equal(layout.getChoice(win), 'default')
    layout.applyLayout(layout.getChoice(win), win)
    assert.equal(attrs['data-layout'], 'default')
    assert.equal(store.get('corum:layout'), 'gone')
    assert.equal(layout.setChoice('gone', win), 'default')
  })
  it('survives unavailable storage', () => {
    const { win } = fakeWindow('compact', { throwStorage: true })
    assert.equal(layout.getChoice(win), 'default')
    assert.equal(layout.setChoice('compact', win), 'compact')
  })
  it('the inline boot script agrees with readChoice', () => {
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8')
    const script = /<script id="layout-boot">([\s\S]*?)<\/script>/.exec(html)![1]
    const run = (stored: unknown, throws = false) => {
      const attrs: Record<string, string> = {}
      vm.runInNewContext(script, {
        document: { documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v } } },
        localStorage: { getItem: () => { if (throws) throw new Error('x'); return stored } },
      })
      return attrs['data-layout']
    }
    assert.equal(run('compact'), 'compact')
    assert.equal(run(null), 'default')
    assert.equal(run('Bad Id!'), 'default')
    assert.equal(run('x', true), 'default')
  })
  it('the default layout tokens reproduce the stock shell', () => {
    const tokens = fs.readFileSync(path.join(WEB, 'tokens.css'), 'utf8')
    assert.match(tokens, /--nav-width: 72px;/)
    assert.match(tokens, /--content-max: none;/)
    assert.match(tokens, /--density: 1;/)
  })
})
