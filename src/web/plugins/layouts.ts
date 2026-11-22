import { isBalanced } from './themes.js'
import { DEFAULT_LAYOUT_ID } from './manifest.js'
import type { PluginLayout } from './manifest.js'
import type { PluginStatus } from './status.js'

/*
 * Layout contributions (ADR-011 section 6). A layout is a CSS file that sets only the layout token group
 * (--nav-width, --content-max, --density) on the root element. The server never serves the author's file: it is
 * sanitised here and re-emitted as `html[data-layout="<id>"] { ... }`. A layout cannot select, hide or reorder anything
 * inside the page, and cannot contain JavaScript, so it cannot change plugin markup.
 */

type Range = { check: (value: string) => boolean; expected: string }

const px = (min: number, max: number) => (value: string) => {
  const match = /^(\d+(?:\.\d+)?)px$/.exec(value)
  return match !== null && Number(match[1]) >= min && Number(match[1]) <= max
}

/** The layout token group and the values each accepts. */
export const LAYOUT_TOKENS: Record<string, Range> = {
  '--nav-width': { check: px(48, 120), expected: 'a px length from 48px to 120px' },
  '--content-max': { check: value => value === 'none' || px(480, 2400)(value), expected: '"none" or a px length from 480px to 2400px' },
  '--density': {
    check: value => /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 0.5 && Number(value) <= 1.5,
    expected: 'a number from 0.5 to 1.5',
  },
}

export type SanitisedLayout = {
  /** The declarations that survived, or null when the whole layout is rejected. */
  declarations: Array<{ name: string; value: string }> | null
  errors: string[]
  warnings: string[]
}

/**
 * Check one layout file for layout `id`. Accepts one `[data-layout="<id>"] { ... }` (or `html[data-layout="<id>"]`,
 * or `:root`) block, or bare declarations. Any other selector, at-rule, `url(`, escape or markup rejects the whole
 * file. Declarations that are not layout tokens, or whose value is out of range, are reported and dropped.
 */
export function sanitiseLayoutCss(id: string, source: string): SanitisedLayout {
  const errors: string[] = []
  const warnings: string[] = []
  const reject = (message: string): SanitisedLayout => ({ declarations: null, errors: [...errors, message], warnings })

  const text = source.replace(/\/\*[\s\S]*?\*\//g, ' ').trim()
  if (/@/.test(text)) return reject('at-rules (such as @import) are not allowed in a layout')
  if (/url\s*\(|image-set\s*\(|expression\s*\(|\\|[<>]/i.test(text)) return reject('url(), image-set(), escapes and markup are not allowed in a layout')
  if (!isBalanced(text)) return reject('unbalanced brackets or quotes')

  let body = text
  if (text.includes('{') || text.includes('}')) {
    const match = /^([^{}]*)\{([^{}]*)\}$/.exec(text)
    if (!match) return reject('a layout may contain only one rule block or bare declarations')
    const selector = match[1].trim().replace(/\s+/g, '')
    const allowed = [`[data-layout="${id}"]`, `html[data-layout="${id}"]`, `[data-layout='${id}']`, `html[data-layout='${id}']`, ':root']
    if (!allowed.includes(selector)) {
      return reject(`the only selector a layout may use is [data-layout="${id}"] (the root element); got "${match[1].trim()}"`)
    }
    body = match[2]
  }

  const kept = new Map<string, string>()
  for (const raw of body.split(';')) {
    const declaration = raw.trim()
    if (declaration === '') continue
    const colon = declaration.indexOf(':')
    if (colon < 1) return reject(`cannot parse declaration "${declaration}"`)
    const name = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (value === '') return reject(`declaration ${name} has no value`)
    const range = LAYOUT_TOKENS[name]
    if (!range) {
      warnings.push(`${name} is not a layout token and is ignored (layouts set ${Object.keys(LAYOUT_TOKENS).join(', ')} only)`)
    } else if (!range.check(value)) {
      warnings.push(`${name}: "${value}" is not ${range.expected}; ignored`)
    } else kept.set(name, value)
  }
  return { declarations: [...kept].map(([name, value]) => ({ name, value })), errors, warnings }
}

/** The CSS the server serves for one layout, scoped to its id. */
export function scopedLayoutCss(id: string, declarations: Array<{ name: string; value: string }>): string {
  return `html[data-layout="${id}"] {\n${declarations.map(d => `  ${d.name}: ${d.value};`).join('\n')}\n}\n`
}

export type RegisteredLayout = PluginLayout & { pluginId: string }

/** Layouts of the enabled plugins in discovery order. The first registration of an id wins; later ones are diagnostics. */
export function registerLayouts(statuses: Pick<PluginStatus, 'id' | 'status' | 'manifest'>[]): { layouts: RegisteredLayout[]; diagnostics: string[] } {
  const layouts: RegisteredLayout[] = []
  const diagnostics: string[] = []
  for (const status of statuses) {
    if (status.status !== 'enabled') continue
    for (const layout of status.manifest.contributes.layouts ?? []) {
      if (layout.id === DEFAULT_LAYOUT_ID) continue
      const existing = layouts.find(entry => entry.id === layout.id)
      if (existing) {
        diagnostics.push(`layout "${layout.id}" from plugin "${status.id}" is a duplicate; keeping the one from plugin "${existing.pluginId}"`)
        continue
      }
      layouts.push({ ...layout, pluginId: status.id })
    }
  }
  return { layouts, diagnostics }
}

/** The stylesheet for every registered layout. Rejected or unreadable layouts are left out and reported. */
export async function buildLayoutsCss(
  statuses: Pick<PluginStatus, 'id' | 'status' | 'manifest'>[],
  read: (pluginId: string, file: string) => Promise<string | null>,
): Promise<{ css: string; layouts: RegisteredLayout[]; diagnostics: string[] }> {
  const { layouts, diagnostics } = registerLayouts(statuses)
  const served: RegisteredLayout[] = []
  const blocks: string[] = []
  for (const layout of layouts) {
    const source = await read(layout.pluginId, layout.css)
    if (source === null) {
      diagnostics.push(`layout "${layout.id}" (plugin "${layout.pluginId}"): cannot read ${layout.css}`)
      continue
    }
    const result = sanitiseLayoutCss(layout.id, source)
    for (const message of result.warnings) diagnostics.push(`warning: layout "${layout.id}" (plugin "${layout.pluginId}"): ${message}`)
    for (const message of result.errors) diagnostics.push(`layout "${layout.id}" (plugin "${layout.pluginId}") rejected: ${message}`)
    if (result.declarations === null) continue
    served.push(layout)
    blocks.push(scopedLayoutCss(layout.id, result.declarations))
  }
  return { css: blocks.join('\n'), layouts: served, diagnostics }
}
