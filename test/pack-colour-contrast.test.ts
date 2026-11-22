/*
 * ADR-011 section 5: pack colours are derived per theme with CSS color-mix(). This test evaluates the derivation
 * expressions found in web/style.css (no browser needed) for every pack colour in the repo's packs, in every
 * registered theme (each in its own colour scheme), and fails when derived text or border colours fall below the minimum ratios recorded here.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CORE_EDGE_TYPES } from '../src/loader/constants.js'
import type { PackColour } from '../src/schema/index.js'
import { BUILTIN_PLUGIN_DIR } from '../src/web/plugins/builtin-dir.js'
import { discoverPlugins } from '../src/web/plugins/discover.js'
import { registerThemes, sanitiseThemeCss } from '../src/web/plugins/themes.js'

const ROOT = process.cwd()
// The host's default (light) values are generated into tokens.css (from web/sdk/tokens.json); the derivations live in style.css.
// Themes are plugin contributions (web/builtin/themes) resolved over those defaults.
const CSS = ['tokens.css', 'style.css'].map(file => fs.readFileSync(path.join(ROOT, 'web', file), 'utf8')).join('\n')
const PACKS = path.join(ROOT, '.corum', 'packs')

/** Minimum contrast ratios. Text: WCAG 1.4.3 (AA). Borders: WCAG 1.4.11 (non-text contrast). */
const MIN_TEXT_RATIO = 4.5
const MIN_BORDER_RATIO = 3

type Scheme = 'light' | 'dark'
type Rgb = [number, number, number]

const hexToRgb = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  assert.ok(m, `expected a #rrggbb colour, got '${hex}'`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const luminance = ([r, g, b]: Rgb) => {
  const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
export const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const mix = (a: Rgb, pct: number, b: Rgb): Rgb => a.map((v, i) => (v * pct + b[i] * (100 - pct)) / 100) as Rgb

/** Token values of the host's default (light) theme: the fallback every theme inherits for tokens it does not set. */
function hostDefaults(): Map<string, string> {
  const block = /:root,\s*\[data-theme="light"\]\s*\{([^}]*)\}/.exec(CSS)
  assert.ok(block, 'no default theme block in web/tokens.css')
  const tokens = new Map<string, string>()
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())
  return tokens
}

/** Every registered theme (ADR-011 section 3): the enabled built-in plugins' themes, in registration order. */
function registeredThemes() {
  const { plugins } = discoverPlugins({ builtinDir: BUILTIN_PLUGIN_DIR, graphDir: null, graphYaml: null, packPluginDirs: [] })
  const { themes } = registerThemes(plugins.map(plugin => ({ id: plugin.manifest.id, status: 'enabled' as const, manifest: plugin.manifest })))
  const dirs = new Map(plugins.map(plugin => [plugin.manifest.id, plugin.dir]))
  return themes.map(theme => ({ theme, dir: dirs.get(theme.pluginId)! }))
}

/**
 * The resolved token values of one theme: its sanitised declarations over the host defaults, with var() references
 * (to its private primitives or other tokens) followed to a final value.
 */
function themeTokens(dir: string, file: string): Map<string, string> {
  const declared = sanitiseThemeCss(fs.readFileSync(path.join(dir, ...file.split('/')), 'utf8'))
  assert.ok(declared.declarations, `${file}: ${declared.errors.join('; ')}`)
  const raw = new Map(hostDefaults())
  for (const d of declared.declarations) raw.set(d.name, d.value)
  const resolve = (value: string, depth = 0): string => {
    assert.ok(depth < 10, `var() cycle in ${value}`)
    return value.replace(/var\((--[\w-]+)\)/g, (_, name: string) => resolve(raw.get(name) ?? assert.fail(`${file}: ${name} is not defined`), depth + 1))
  }
  return new Map([...raw].map(([name, value]) => [name, resolve(value)]))
}

interface Derivation { token: string; colour: string; pct: number; other: string }

/** Every `--(node|edge)-(tint|border|on-tint)` declaration, in the one supported form. Anything else fails closed. */
function derivations(): Derivation[] {
  const found: Derivation[] = []
  for (const m of CSS.matchAll(/(--(?:node|edge)-(?:tint|border|on-tint))\s*:\s*([^;]+);/g)) {
    const expr = /^color-mix\(in srgb,\s*var\((--[\w-]+)\)\s+(\d+)%,\s*var\((--[\w-]+)\)\)$/.exec(m[2].trim())
    assert.ok(expr, `unsupported derivation for ${m[1]}: '${m[2].trim()}'. Use color-mix(in srgb, var(--x) N%, var(--y)) so the contrast test can evaluate it.`)
    found.push({ token: m[1], colour: expr[1], pct: Number(expr[2]), other: expr[3] })
  }
  return found
}

function resolveColour(colour: PackColour, scheme: Scheme): string {
  return typeof colour === 'string' ? colour : colour[scheme]
}

interface PackColourEntry { source: string; colour: PackColour }

function packColours(): PackColourEntry[] {
  const entries: PackColourEntry[] = []
  for (const pack of fs.readdirSync(PACKS)) {
    const templates = path.join(PACKS, pack, 'templates')
    if (fs.existsSync(templates)) {
      for (const file of fs.readdirSync(templates).filter(f => f.endsWith('.yaml'))) {
        const t = parseYaml(fs.readFileSync(path.join(templates, file), 'utf8')) as { name?: string; ui?: { colour?: PackColour } }
        if (t?.ui?.colour) entries.push({ source: `template ${pack}/${t.name ?? file}`, colour: t.ui.colour })
      }
    }
    const edgeTypes = path.join(PACKS, pack, 'edge-types.yaml')
    if (fs.existsSync(edgeTypes)) {
      const doc = parseYaml(fs.readFileSync(edgeTypes, 'utf8')) as { 'edge-types'?: Record<string, { colour?: PackColour }> }
      for (const [name, def] of Object.entries(doc?.['edge-types'] ?? {})) {
        if (def.colour) entries.push({ source: `edge type ${pack}/${name}`, colour: def.colour })
      }
    }
  }
  for (const def of Object.values(CORE_EDGE_TYPES)) {
    if (def.colour) entries.push({ source: `core edge type ${def.name}`, colour: def.colour })
  }
  return entries
}

describe('pack colour contrast (ADR-011 section 5)', () => {
  const entries = packColours()
  const derived = derivations()

  it('finds pack colours and the derivation expressions to evaluate', () => {
    assert.ok(entries.length >= 20, `expected the repo's pack colours, found ${entries.length}`)
    for (const family of ['node', 'edge']) {
      for (const kind of ['tint', 'border', 'on-tint']) {
        assert.ok(derived.some(d => d.token === `--${family}-${kind}`), `no derivation for --${family}-${kind}`)
      }
    }
  })

  it('accepts both the string and the { light, dark } form (the contrast math resolves each per scheme)', () => {
    assert.equal(resolveColour('#112233', 'dark'), '#112233')
    assert.equal(resolveColour({ light: '#111111', dark: '#eeeeee' }, 'dark'), '#eeeeee')
    assert.equal(resolveColour({ light: '#111111', dark: '#eeeeee' }, 'light'), '#111111')
  })

  it('covers every registered theme, including the built-in light, dark and high-contrast', () => {
    assert.deepEqual(registeredThemes().map(entry => entry.theme.id), ['light', 'dark', 'high-contrast'])
  })

  for (const { theme, dir } of registeredThemes()) {
    const scheme: Scheme = theme.colorScheme
    describe(`${theme.id} theme (${scheme})`, () => {
      const tokens = themeTokens(dir, theme.css)
      const surface = (name: string): Rgb => hexToRgb(tokens.get(name) ?? assert.fail(`theme token ${name} is missing or not a hex colour`))

      /** The derived colour of `token` for a pack colour, for both node-* and edge-* tokens. */
      const derive = (family: 'node' | 'edge', part: string, packHex: string): Rgb => {
        const d = derived.find(x => x.token === `--${family}-${part}`) ?? assert.fail(`no --${family}-${part}`)
        assert.equal(d.colour, `--${family}-colour`, `--${family}-${part} must derive from --${family}-colour`)
        return mix(hexToRgb(packHex), d.pct, surface(d.other))
      }

      // Pack colours of templates and edge types, plus the theme-defined kind colours and the edge default.
      const subjects: Array<{ source: string; hex: string; families: Array<'node' | 'edge'> }> = [
        ...entries.map(e => ({
          source: e.source,
          hex: resolveColour(e.colour, scheme),
          families: (e.source.includes('edge type') ? ['edge'] : ['node']) as Array<'node' | 'edge'>,
        })),
        ...[1, 2, 3, 4, 5, 6, 7, 8].map(n => ({ source: `--kind-${n}`, hex: tokens.get(`--kind-${n}`)!, families: ['node'] as Array<'node'> })),
        { source: '--edge-default', hex: tokens.get('--edge-default')!, families: ['edge'] },
      ]

      for (const subject of subjects) {
        for (const family of subject.families) {
          it(`${subject.source} ${subject.hex}: derived text and border are readable`, () => {
            const tint = derive(family, 'tint', subject.hex)
            const text = derive(family, 'on-tint', subject.hex)
            const border = derive(family, 'border', subject.hex)
            const background = surface('--background')
            const card = surface('--card')
            const textOnTint = contrast(text, tint)
            const textOnBackground = contrast(text, background)
            assert.ok(textOnTint >= MIN_TEXT_RATIO, `on-tint text ${textOnTint.toFixed(2)}:1 on its tint is below ${MIN_TEXT_RATIO}:1`)
            assert.ok(textOnBackground >= MIN_TEXT_RATIO, `on-tint text ${textOnBackground.toFixed(2)}:1 on --background is below ${MIN_TEXT_RATIO}:1`)
            for (const [name, surfaceColour] of [['--card', card], ['--background', background]] as const) {
              const ratio = contrast(border, surfaceColour)
              assert.ok(ratio >= MIN_BORDER_RATIO, `border ${ratio.toFixed(2)}:1 on ${name} is below ${MIN_BORDER_RATIO}:1`)
            }
          })
        }
      }
    })
  }
})
