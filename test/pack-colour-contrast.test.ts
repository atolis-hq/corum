/*
 * ADR-011 section 5: pack colours are derived per theme with CSS color-mix(). This test evaluates the derivation
 * expressions found in web/style.css (no browser needed) for every pack colour in the repo's packs, in both themes,
 * and fails when derived text or border colours fall below the minimum ratios recorded here.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CORE_EDGE_TYPES } from '../src/loader/constants.js'
import type { PackColour } from '../src/schema/index.js'

const ROOT = process.cwd()
const CSS = fs.readFileSync(path.join(ROOT, 'web', 'style.css'), 'utf8')
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

/** Token declarations (`--name: #rrggbb`) of the theme block for one scheme. */
function themeTokens(scheme: Scheme): Map<string, string> {
  const block = new RegExp(`(?:\\[data-theme="${scheme}"\\])\\s*\\{([^}]*)\\}`).exec(CSS)
  assert.ok(block, `no ${scheme} theme block in web/style.css`)
  const tokens = new Map<string, string>()
  for (const m of block[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())
  return tokens
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

  for (const scheme of ['light', 'dark'] as const) {
    describe(`${scheme} theme`, () => {
      const tokens = themeTokens(scheme)
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
