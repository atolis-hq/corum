import type { PackColour } from '../schema/index.js'

const HEX_COLOUR_RE = /^#[0-9A-Fa-f]{6}$/

/** Pack colours are `#rrggbb`, or `{ light, dark }` with a `#rrggbb` for each colour scheme. */
export function describePackColourProblem(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return HEX_COLOUR_RE.test(value) ? undefined : `colour '${value}' must be a #rrggbb hex string`
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>
    const extra = Object.keys(obj).filter(key => key !== 'light' && key !== 'dark')
    if (extra.length > 0) return `colour has unknown key '${extra[0]}': expected only light and dark`
    for (const scheme of ['light', 'dark'] as const) {
      const valid = typeof obj[scheme] === 'string' && HEX_COLOUR_RE.test(obj[scheme] as string)
      if (!valid) return `colour.${scheme} must be a #rrggbb hex string`
    }
    return undefined
  }
  return 'colour must be a #rrggbb hex string or an object with light and dark #rrggbb strings'
}

export function isPackColour(value: unknown): value is PackColour {
  return describePackColourProblem(value) === undefined
}
