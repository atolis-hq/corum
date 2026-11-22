/*
 * ADR-011 section 3: themes are plugin contributions. Covers the sanitiser (undocumented tokens), registration order,
 * the served stylesheet, the disabled-plugin fallback and the scaffold/validate tooling.
 */
import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse as parseYaml, stringify } from 'yaml'
import { loadGraph } from '../src/loader/index.js'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import { BUILTIN_PLUGIN_DIR } from '../src/web/plugins/builtin-dir.js'
import { discoverPlugins } from '../src/web/plugins/discover.js'
import { parsePluginManifest } from '../src/web/plugins/manifest.js'
import { buildThemesCss, catalogueFromTokensJson, loadTokenCatalogue, registerThemes, sanitiseThemeCss } from '../src/web/plugins/themes.js'
import { scaffoldPlugin } from '../src/plugin/scaffold.js'
import { validatePluginDir } from '../src/plugin/validate.js'

const hostTheme = await import(pathToFileURL(path.join(process.cwd(), 'web', 'host', 'theme.js')).href)
const tmpDirs: string[] = []
function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-themes-'))
  tmpDirs.push(dir)
  return dir
}
after(() => { for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true }) })

function manifestFor(id: string, themes: string): ReturnType<typeof parsePluginManifest>['manifest'] {
  const { manifest, errors } = parsePluginManifest(`id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\ncontributes:\n  themes:\n${themes}\n`)
  assert.deepEqual(errors, [])
  return manifest
}

function writeThemePlugin(parent: string, id: string, themes: Array<{ id: string; scheme?: string; css: string }>): string {
  const dir = path.join(parent, id)
  fs.mkdirSync(dir, { recursive: true })
  const entries = themes.map(t => `    - { id: ${t.id}, label: ${t.id}, colorScheme: ${t.scheme ?? 'light'}, css: ./${t.id}.css }`).join('\n')
  fs.writeFileSync(path.join(dir, 'plugin.yaml'), `id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\ncontributes:\n  themes:\n${entries}\n`)
  fs.writeFileSync(path.join(dir, 'index.js'), 'export {}\n')
  for (const theme of themes) fs.writeFileSync(path.join(dir, `${theme.id}.css`), theme.css)
  return dir
}

describe('theme sanitiser', () => {
  it('reads the documented tokens from the styling contract', () => {
    const catalogue = loadTokenCatalogue()
    assert.ok(catalogue.settable.has('--background'))
    assert.ok(catalogue.required.includes('--kind-1'))
    assert.ok(!catalogue.settable.has('--corum-tokens-version'))
    const small = catalogueFromTokensJson({ color: { x: { $value: '#fff' }, y: { $value: '#000', $extensions: { corum: { scope: 'derived' } } }, z: { $value: '1', $extensions: { corum: { scope: 'optional' } } } } })
    assert.deepEqual([...small.settable].sort(), ['--x', '--z'])
    assert.deepEqual(small.required, ['--x'])
  })

  it('reports an undocumented public token and ignores it, keeping the rest', () => {
    const result = sanitiseThemeCss(':root { --background: #000000; --sidebar-glow: #ff00ff; --foreground: #ffffff }')
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.declarations?.map(d => d.name), ['--background', '--foreground'])
    assert.ok(result.warnings.some(w => w.includes('--sidebar-glow') && w.includes('not a documented token')))
  })

  it('ignores host-owned and derived tokens and non-custom properties', () => {
    const result = sanitiseThemeCss(':root { --corum-tokens-version: 9; --node-tint: red; --nav-width: 1px; color-scheme: dark; --background: #000000 }')
    assert.deepEqual(result.declarations?.map(d => d.name), ['--background'])
    for (const name of ['--corum-tokens-version', '--node-tint', '--nav-width', 'color-scheme']) {
      assert.ok(result.warnings.some(w => w.includes(name)), name)
    }
  })

  it('accepts private --c-* primitives, bare declarations and comments', () => {
    const result = sanitiseThemeCss('/* note */ --c-ink: #000000; --foreground: var(--c-ink);')
    assert.deepEqual(result.declarations?.map(d => d.name), ['--c-ink', '--foreground'])
  })

  it('warns about missing tokens (they inherit the light defaults)', () => {
    const result = sanitiseThemeCss(':root { --background: #000000 }')
    assert.ok(result.warnings.some(w => w.includes('inherit the default') && w.includes('--foreground')))
  })

  for (const [name, css] of [
    ['a non-:root selector', 'body { --background: #000 }'],
    ['a second block', ':root { --background: #000 } :root { --card: #111 }'],
    ['@import', '@import "https://example.com/x.css"; :root { --background: #000 }'],
    ['url()', ':root { --background: url(https://example.com/x.png) }'],
    ['an escape', ':root { --background: \\75rl(x) }'],
    ['an at-rule block', '@media print { :root { --background: #000 } }'],
    ['markup', ':root { --background: #000 } </style><script>'],
    ['an unclosed parenthesis', ':root { --background: var(--c-x }'],
    ['an unclosed bracket', ':root { --background: [x }'],
    ['an unterminated string', ':root { --font-mono: "JetBrains Mono }'],
    ['a stray closing parenthesis', ':root { --background: #000) }'],
  ] as const) {
    it(`rejects a theme with ${name} as a whole`, () => {
      const result = sanitiseThemeCss(css)
      assert.equal(result.declarations, null)
      assert.ok(result.errors.length > 0)
    })
  }
})

describe('theme registration', () => {
  const light = '    - { id: light, label: Light, colorScheme: light, css: a.css }'
  const one = (id: string, themes: string) => ({ id, status: 'enabled' as const, manifest: manifestFor(id, themes)! })

  it('registers themes in plugin order; the first registration of an id wins', () => {
    const { themes, diagnostics } = registerThemes([
      one('builtin', light),
      one('third-party', `    - { id: light, label: Impostor, colorScheme: dark, css: b.css }\n    - { id: sepia, label: Sepia, colorScheme: light, css: c.css }`),
    ])
    assert.deepEqual(themes.map(t => [t.id, t.label, t.pluginId]), [['light', 'Light', 'builtin'], ['sepia', 'Sepia', 'third-party']])
    assert.equal(diagnostics.length, 1)
    assert.match(diagnostics[0], /theme "light" from plugin "third-party" is a duplicate; keeping the one from plugin "builtin"/)
  })

  it('a disabled or unavailable plugin registers nothing', () => {
    const disabled = { ...one('off', light), status: 'disabled' as const }
    const unavailable = { ...one('gone', light), status: 'unavailable' as const }
    assert.deepEqual(registerThemes([disabled, unavailable]).themes, [])
  })

  it('the built-in themes plugin registers light, dark and high-contrast and cannot be overridden by a pack plugin', () => {
    const tmp = tmpDir()
    const impostor = writeThemePlugin(tmp, 'impostor', [{ id: 'dark', scheme: 'light', css: ':root { --background: #ffffff }' }, { id: 'extra', css: ':root { --background: #fefefe }' }])
    const { plugins } = discoverPlugins({ builtinDir: BUILTIN_PLUGIN_DIR, graphDir: null, graphYaml: null, packPluginDirs: [impostor] })
    const { themes } = registerThemes(plugins.map(p => ({ id: p.manifest.id, status: 'enabled' as const, manifest: p.manifest })))
    assert.deepEqual(themes.map(t => `${t.id}:${t.pluginId}:${t.colorScheme}`), ['light:themes:light', 'dark:themes:dark', 'high-contrast:themes:light', 'extra:impostor:light'])
  })

  it('accepts balanced quotes and brackets', () => {
    const result = sanitiseThemeCss(':root { --font-mono: "JetBrains Mono", monospace; --shadow-sm: 0 1px rgba(0, 0, 0, 0.1) }')
    assert.equal(result.errors.length, 0)
    assert.equal(result.declarations?.length, 2)
  })

  it('a malformed theme does not affect the themes served after it', async () => {
    const files: Record<string, string> = { 'a.css': ':root { --background: var(--c-x }', 'b.css': ':root { --background: #202020 }' }
    const built = await buildThemesCss(
      [one('p', `    - { id: broken, label: Broken, colorScheme: light, css: a.css }\n    - { id: after, label: After, colorScheme: dark, css: b.css }`)],
      async (_plugin, file) => files[file] ?? null,
    )
    assert.deepEqual(built.themes.map(t => t.id), ['after'])
    assert.match(built.css, /^html\[data-theme="after"\] \{\n {2}color-scheme: dark;\n {2}--background: #202020;\n\}\n$/)
    assert.ok(built.diagnostics.some(d => d.includes('"broken"') && d.includes('unbalanced')))
  })

  it('builds scoped CSS, drops rejected themes and reports them', async () => {
    const files: Record<string, string> = { 'a.css': ':root { --background: #101010; --bogus: 1 }', 'b.css': 'body { color: red }' }
    const built = await buildThemesCss(
      [one('p', `    - { id: good, label: Good, colorScheme: dark, css: a.css }\n    - { id: evil, label: Evil, colorScheme: light, css: b.css }\n    - { id: absent, label: Absent, colorScheme: light, css: c.css }`)],
      async (_plugin, file) => files[file] ?? null,
    )
    assert.deepEqual(built.themes.map(t => t.id), ['good'])
    assert.match(built.css, /^html\[data-theme="good"\] \{\n {2}color-scheme: dark;\n {2}--background: #101010;\n\}/)
    assert.doesNotMatch(built.css, /--bogus|evil|body/)
    assert.ok(built.diagnostics.some(d => d.includes('"evil"') && d.includes('rejected')))
    assert.ok(built.diagnostics.some(d => d.includes('"absent"') && d.includes('cannot read')))
    assert.ok(built.diagnostics.some(d => d.includes('--bogus') && d.includes('not a documented token')))
  })
})

describe('host theme selection with a registry', () => {
  const statuses = (...entries: Array<{ id: string; status?: string; themes: Array<{ id: string; label: string; colorScheme: string }> }>) =>
    entries.map(e => ({ id: e.id, status: e.status ?? 'enabled', manifest: { contributes: { themes: e.themes } } }))
  const builtin = { id: 'themes', themes: [{ id: 'light', label: 'Light', colorScheme: 'light' }, { id: 'dark', label: 'Dark', colorScheme: 'dark' }] }
  const store = (value?: string) => ({ getItem: () => value ?? null })

  it('before the registry loads, a stored choice is reported as stored (so Settings cannot overwrite it by accident)', async () => {
    const fresh = await import(`${pathToFileURL(path.join(process.cwd(), 'web', 'host', 'theme.js')).href}?fresh`)
    assert.equal(fresh.readChoice(store('dark')), 'dark')
    assert.equal(fresh.readChoice(store()), 'system')
    fresh.registerThemes([])
    assert.equal(fresh.readChoice(store('dark')), 'system')
  })

  it('lists registered themes of enabled plugins only; first wins; system is reserved', () => {
    const list = hostTheme.registerThemes(statuses(builtin,
      { id: 'x', themes: [{ id: 'light', label: 'Fake', colorScheme: 'dark' }, { id: 'system', label: 'S', colorScheme: 'light' }, { id: 'sepia', label: 'Sepia', colorScheme: 'light' }] },
      { id: 'y', status: 'disabled', themes: [{ id: 'neon', label: 'Neon', colorScheme: 'dark' }] }))
    assert.deepEqual(list.map((t: { id: string }) => t.id), ['light', 'dark', 'sepia'])
    assert.equal(list[0].label, 'Light')
  })

  it('a stored theme from a disabled plugin falls back to system without rewriting storage', () => {
    hostTheme.registerThemes(statuses(builtin, { id: 'y', status: 'disabled', themes: [{ id: 'neon', label: 'Neon', colorScheme: 'dark' }] }))
    assert.equal(hostTheme.readChoice(store('neon')), 'system')
    assert.equal(hostTheme.resolveTheme('neon', true), 'dark')
    assert.equal(hostTheme.resolveTheme('neon', false), 'light')
    let writes = 0
    const win: any = {
      document: { documentElement: { setAttribute: () => {} } },
      localStorage: { getItem: () => 'neon', setItem: () => { writes++ } },
      matchMedia: () => ({ matches: true }),
    }
    hostTheme.applyTheme(hostTheme.getChoice(win), win)
    assert.equal(writes, 0)
  })

  it('system picks the first registered theme matching the colour scheme, and light defaults when none match', () => {
    hostTheme.registerThemes(statuses(
      { id: 'a', themes: [{ id: 'sepia', label: 'Sepia', colorScheme: 'light' }, { id: 'night', label: 'Night', colorScheme: 'dark' }, { id: 'dusk', label: 'Dusk', colorScheme: 'dark' }] }))
    assert.equal(hostTheme.resolveTheme('system', false), 'sepia')
    assert.equal(hostTheme.resolveTheme('system', true), 'night')
    hostTheme.registerThemes(statuses({ id: 'a', themes: [{ id: 'sepia', label: 'Sepia', colorScheme: 'light' }] }))
    assert.equal(hostTheme.resolveTheme('system', true), 'light')
    hostTheme.registerThemes([])
    assert.equal(hostTheme.resolveTheme('system', true), 'light')
  })
})

describe('themes over HTTP', () => {
  function graphDirWith(plugin: string | null, overrides: unknown[] = []): string {
    const graphDir = tmpDir()
    fs.cpSync(path.resolve('fixtures', 'sample-graph'), graphDir, { recursive: true })
    const yaml = parseYaml(fs.readFileSync(path.join(graphDir, 'graph.yaml'), 'utf8')) as { templatePacks: Array<{ path: string }>; plugins?: unknown[] }
    for (const pack of yaml.templatePacks) pack.path = path.resolve('fixtures', 'sample-graph', pack.path)
    yaml.plugins = [...(plugin ? [{ path: plugin }] : []), ...overrides]
    fs.writeFileSync(path.join(graphDir, 'graph.yaml'), stringify(yaml))
    return graphDir
  }

  async function serve(graphDir: string): Promise<WebServerHandle> {
    const graph = await loadGraph({ graphPath: graphDir, strict: false })
    return startWebServer(graph, { graphPath: graphDir, port: 0, host: '127.0.0.1', logger: () => {} })
  }

  const css = ':root { --background: #101820; --foreground: #f0f0f0; --sidebar-glow: #ff00ff; --c-x: #123456 }'

  it('serves the built-in themes, a contributed theme (sanitised and scoped) and lists them in /api/plugins', async () => {
    const graphDir = graphDirWith('plugins/night')
    writeThemePlugin(path.join(graphDir, 'plugins'), 'night', [{ id: 'midnight', scheme: 'dark', css }])
    const handle = await serve(graphDir)
    try {
      const origin = `http://127.0.0.1:${handle.port}`
      const plugins = await (await fetch(`${origin}/api/plugins`)).json() as Array<{ id: string; status: string; manifest: { contributes: { themes: Array<{ id: string }> } } }>
      assert.deepEqual(plugins.find(p => p.id === 'themes')?.manifest.contributes.themes.map(t => t.id), ['light', 'dark', 'high-contrast'])
      assert.deepEqual(plugins.find(p => p.id === 'night')?.manifest.contributes.themes.map(t => t.id), ['midnight'])
      const index = await (await fetch(`${origin}/`)).text()
      const link = /href="(\/v\/[^"/]+\/api\/themes\.css)"/.exec(index)
      assert.ok(link, 'the page links the themes stylesheet under the version prefix')
      assert.equal((await fetch(`${origin}${link[1]}`)).status, 200)
      assert.equal((await fetch(`${origin}/v/0.0.0-stale/api/themes.css`)).status, 404)
      const response = await fetch(`${origin}/api/themes.css`)
      assert.equal(response.status, 200)
      assert.match(response.headers.get('content-type') ?? '', /text\/css/)
      const body = await response.text()
      for (const id of ['light', 'dark', 'high-contrast', 'midnight']) assert.ok(body.includes(`html[data-theme="${id}"] {`), id)
      assert.match(body, /html\[data-theme="midnight"\] \{\n {2}color-scheme: dark;\n {2}--background: #101820;/)
      assert.ok(!body.includes('--sidebar-glow'), 'undocumented token is not served')
      assert.ok(body.includes('--c-x: #123456'))
    } finally { await handle.close() }
  })

  it('a disabled plugin contributes no theme', async () => {
    const graphDir = graphDirWith('plugins/night', [{ id: 'night', enabled: false }])
    writeThemePlugin(path.join(graphDir, 'plugins'), 'night', [{ id: 'midnight', scheme: 'dark', css }])
    const handle = await serve(graphDir)
    try {
      const origin = `http://127.0.0.1:${handle.port}`
      const body = await (await fetch(`${origin}/api/themes.css`)).text()
      assert.ok(body.includes('html[data-theme="dark"]'))
      assert.ok(!body.includes('midnight'))
      const plugins = await (await fetch(`${origin}/api/plugins`)).json() as Array<{ id: string; status: string }>
      assert.equal(plugins.find(p => p.id === 'night')?.status, 'disabled')
      // The host registry built from that response omits the theme, so a stored "midnight" falls back to System.
      hostTheme.registerThemes(plugins)
      assert.ok(!hostTheme.getThemes().some((t: { id: string }) => t.id === 'midnight'))
      assert.equal(hostTheme.readChoice({ getItem: () => 'midnight' }), 'system')
    } finally { await handle.close() }
  })
})

describe('theme tooling', () => {
  it('scaffolds a starter theme that validates cleanly', () => {
    const tmp = tmpDir()
    const dir = path.join(tmp, 'my-theme')
    const result = scaffoldPlugin('my-theme', dir, '0.1.0', { theme: true })
    assert.ok(result.ok)
    assert.ok(result.ok && result.files.includes('theme.css'))
    const manifest = parsePluginManifest(fs.readFileSync(path.join(dir, 'plugin.yaml'), 'utf8')).manifest
    assert.deepEqual(manifest?.contributes.themes, [{ id: 'my-theme', label: 'my-theme', colorScheme: 'light', css: './theme.css' }])
    const checked = validatePluginDir(dir, new Set(), '0.1.0')
    assert.deepEqual(checked.errors, [])
    assert.deepEqual(checked.warnings, [])
  })

  it('validate errors on an unsafe theme file and warns about undocumented tokens', () => {
    const tmp = tmpDir()
    const dir = writeThemePlugin(tmp, 'themed', [{ id: 'ok', css: ':root { --background: #ffffff; --made-up: 1 }' }, { id: 'bad', css: '@import "x.css";' }])
    const checked = validatePluginDir(dir, new Set(), '0.1.0')
    assert.equal(checked.exitCode, 1)
    assert.ok(checked.errors.some(e => e.includes('theme "bad"') && e.includes('at-rules')))
    assert.ok(checked.warnings.some(w => w.includes('theme "ok"') && w.includes('--made-up')))
    assert.ok(!checked.warnings.some(w => w.includes('colour literal')), 'theme files are exempt from the colour-literal lint')
  })

  it('validate errors when the css file is missing', () => {
    const tmp = tmpDir()
    const dir = writeThemePlugin(tmp, 'themed', [{ id: 'ok', css: ':root { --background: #ffffff }' }])
    fs.rmSync(path.join(dir, 'ok.css'))
    assert.ok(validatePluginDir(dir, new Set(), '0.1.0').errors.some(e => e.includes('does not exist')))
  })
})
