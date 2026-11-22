import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BUILTIN_PLUGIN_DIR } from './builtin-dir.js'
import type { PluginTheme, ThemeColorScheme } from './manifest.js'
import type { PluginStatus } from './status.js'

/*
 * Theme contributions (ADR-011 section 3). A theme is a CSS file of custom-property values. The server never serves
 * the author's file: it is sanitised here (only documented tokens survive, nothing that can load or select anything)
 * and wrapped in a rule scoped to `html[data-theme="<id>"]`.
 */

export type TokenCatalogue = {
  /** Tokens a theme may set: documented with the `theme` (default) or `optional` scope. */
  settable: Set<string>
  /** Tokens every complete theme sets (the `theme` scope). */
  required: string[]
}

type TokenNode = Record<string, unknown>

function walk(node: TokenNode, visit: (name: string, scope: string) => void): void {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || typeof child !== 'object' || child === null) continue
    const record = child as TokenNode
    if ('$value' in record) {
      const extensions = record.$extensions as { corum?: { scope?: string } } | undefined
      visit(`--${key}`, extensions?.corum?.scope ?? 'theme')
    } else walk(record, visit)
  }
}

/** The documented tokens, from the styling contract (`web/sdk/tokens.json`). */
export function catalogueFromTokensJson(doc: unknown): TokenCatalogue {
  const settable = new Set<string>()
  const required: string[] = []
  walk(doc as TokenNode, (name, scope) => {
    if (scope === 'theme') { settable.add(name); required.push(name) }
    else if (scope === 'optional') settable.add(name)
  })
  return { settable, required }
}

let cached: TokenCatalogue | null = null

export function loadTokenCatalogue(): TokenCatalogue {
  cached ??= catalogueFromTokensJson(JSON.parse(readFileSync(path.join(BUILTIN_PLUGIN_DIR, '..', 'sdk', 'tokens.json'), 'utf8')))
  return cached
}

/** Private colour primitives (`--c-*`) are theme-file internals, not part of the public namespace. */
const PRIVATE_PREFIX = '--c-'

export type SanitisedTheme = {
  /** The declarations that survived, or null when the whole theme is rejected. */
  declarations: Array<{ name: string; value: string }> | null
  errors: string[]
  warnings: string[]
}

/** True when every ( and [ is closed in order and every quote is terminated (braces are checked by the block rule). */
function isBalanced(text: string): boolean {
  const stack: string[] = []
  let quote: string | null = null
  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\n') return false
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(' || ch === '[') stack.push(ch === '(' ? ')' : ']')
    else if (ch === ')' || ch === ']') { if (stack.pop() !== ch) return false }
  }
  return quote === null && stack.length === 0
}

/**
 * Check one theme file. Accepts a single `:root { ... }` block or bare declarations. Any other selector, at-rule,
 * `url(`, escape or markup rejects the whole file. Declarations of undocumented public tokens (and of anything that is
 * not a custom property) are reported and dropped; the rest of the theme still applies.
 */
export function sanitiseThemeCss(source: string, catalogue: TokenCatalogue = loadTokenCatalogue()): SanitisedTheme {
  const errors: string[] = []
  const warnings: string[] = []
  const reject = (message: string): SanitisedTheme => ({ declarations: null, errors: [...errors, message], warnings })

  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
  if (/@/.test(text)) return reject('at-rules (such as @import) are not allowed in a theme')
  if (/url\s*\(|image-set\s*\(|expression\s*\(|\\|[<>]/i.test(text)) return reject('url(), image-set(), escapes and markup are not allowed in a theme')

  // An unclosed ( [ or quote runs to the end of the shared stylesheet in CSS and would swallow every theme after this one.
  if (!isBalanced(text)) return reject('unbalanced brackets or quotes')

  let body = text
  if (text.includes('{') || text.includes('}')) {
    const match = /^:root\s*\{([^{}]*)\}$/.exec(text)
    if (!match) return reject('a theme may contain only one :root { ... } block or bare declarations')
    body = match[1]
  }

  const kept = new Map<string, string>()
  const warn = (message: string) => warnings.push(message)
  for (const raw of body.split(';')) {
    const declaration = raw.trim()
    if (declaration === '') continue
    const colon = declaration.indexOf(':')
    if (colon < 1) return reject(`cannot parse declaration "${declaration}"`)
    const name = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (value === '') return reject(`declaration ${name} has no value`)
    if (!name.startsWith('--')) {
      warn(`${name} is not a custom property and is ignored (themes set documented tokens only)`)
    } else if (name.startsWith(PRIVATE_PREFIX) || catalogue.settable.has(name)) {
      kept.set(name, value)
    } else {
      warn(`${name} is not a documented token and is ignored`)
    }
  }
  const missing = catalogue.required.filter(token => !kept.has(token))
  if (missing.length > 0) warn(`missing tokens inherit the default (light) values: ${missing.join(', ')}`)
  return { declarations: [...kept].map(([name, value]) => ({ name, value })), errors, warnings }
}

/** The CSS the server serves for one theme, scoped to its id. */
export function scopedThemeCss(id: string, colorScheme: ThemeColorScheme, declarations: Array<{ name: string; value: string }>): string {
  const lines = [`  color-scheme: ${colorScheme};`, ...declarations.map(d => `  ${d.name}: ${d.value};`)]
  return `html[data-theme="${id}"] {\n${lines.join('\n')}\n}\n`
}

export type RegisteredTheme = PluginTheme & { pluginId: string }

/** Themes of the enabled plugins in discovery order. The first registration of an id wins; later ones are diagnostics. */
export function registerThemes(statuses: Pick<PluginStatus, 'id' | 'status' | 'manifest'>[]): { themes: RegisteredTheme[]; diagnostics: string[] } {
  const themes: RegisteredTheme[] = []
  const diagnostics: string[] = []
  for (const status of statuses) {
    if (status.status !== 'enabled') continue
    for (const theme of status.manifest.contributes.themes) {
      const existing = themes.find(entry => entry.id === theme.id)
      if (existing) {
        diagnostics.push(`theme "${theme.id}" from plugin "${status.id}" is a duplicate; keeping the one from plugin "${existing.pluginId}"`)
        continue
      }
      themes.push({ ...theme, pluginId: status.id })
    }
  }
  return { themes, diagnostics }
}

/**
 * The stylesheet for every registered theme. `read` returns a theme file's text, or null when it cannot be read.
 * Rejected or unreadable themes are left out and reported; the rest are unaffected.
 */
export async function buildThemesCss(
  statuses: Pick<PluginStatus, 'id' | 'status' | 'manifest'>[],
  read: (pluginId: string, file: string) => Promise<string | null>,
): Promise<{ css: string; themes: RegisteredTheme[]; diagnostics: string[] }> {
  const { themes, diagnostics } = registerThemes(statuses)
  const served: RegisteredTheme[] = []
  const blocks: string[] = []
  for (const theme of themes) {
    const source = await read(theme.pluginId, theme.css)
    if (source === null) {
      diagnostics.push(`theme "${theme.id}" (plugin "${theme.pluginId}"): cannot read ${theme.css}`)
      continue
    }
    const result = sanitiseThemeCss(source)
    for (const message of result.warnings) diagnostics.push(`warning: theme "${theme.id}" (plugin "${theme.pluginId}"): ${message}`)
    for (const message of result.errors) diagnostics.push(`theme "${theme.id}" (plugin "${theme.pluginId}") rejected: ${message}`)
    if (result.declarations === null) continue
    served.push(theme)
    blocks.push(scopedThemeCss(theme.id, theme.colorScheme, result.declarations))
  }
  return { css: blocks.join('\n'), themes: served, diagnostics }
}
