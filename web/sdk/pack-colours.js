/* Pack colours (ADR-011 section 5): pack data reaches the UI as custom properties, never as inline colour values.
   The host injects one `--pack-*` variable per pack colour (see web/host/pack-colours.js); these helpers return the
   `--node-colour` / `--edge-colour` custom-property bags components put in `style`. Tint, border and readable-text
   colours are derived in web/style.css (`.node-coloured`, `.edge-coloured`) so they follow every theme. */

/* Variable names only allow [a-z0-9-]; template names are PascalCase, so case is folded and anything else becomes `-`. */
export function packColourSlug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9-]/g, '-')
}

export const packNodeVar = template => `--pack-node-${packColourSlug(template)}`
export const packEdgeVar = type => `--pack-edge-${packColourSlug(type)}`
export const packEdgeDashVar = type => `--pack-edge-dash-${packColourSlug(type)}`

/* The one edge-type styling definition: used for tags, pills and graph strokes alike. Unknown types use `--edge-default`. */
export function edgeTypeStyle(type) {
  return {
    '--edge-colour': `var(${packEdgeVar(type)},var(--edge-default))`,
    '--edge-dash': `var(${packEdgeDashVar(type)},none)`,
  }
}

/* Colour of a template's nodes: the first named template that has a pack colour wins, else the neutral token.
   Pass several names to fall back, e.g. a subtype to its group. */
export function templateColourStyle(...templates) {
  const fallback = 'var(--subtle-foreground)'
  const value = templates.filter(Boolean).reduceRight((rest, template) => `var(${packNodeVar(template)},${rest})`, fallback)
  return { '--node-colour': value }
}

/* Stylesheet text defining the `--pack-*` variables. `{ light, dark }` colours use light-dark(), which follows the
   active theme's `color-scheme`, so no component branches on the theme. Values are validated by the loader; anything
   that is not a plain hex colour is skipped here as well. */
const SAFE_COLOUR = /^#[0-9A-Fa-f]{6}$/

function cssColour(colour) {
  if (typeof colour === 'string') return SAFE_COLOUR.test(colour) ? colour : null
  if (colour && SAFE_COLOUR.test(colour.light ?? '') && SAFE_COLOUR.test(colour.dark ?? '')) {
    return `light-dark(${colour.light}, ${colour.dark})`
  }
  return null
}

export function packColourCss(templates, edgeTypes) {
  const lines = []
  for (const template of templates ?? []) {
    const value = cssColour(template?.ui?.colour)
    if (value) lines.push(`${packNodeVar(template.name)}: ${value};`)
  }
  for (const def of edgeTypes ?? []) {
    const value = cssColour(def?.colour)
    if (value) lines.push(`${packEdgeVar(def.name)}: ${value};`)
    const dash = def?.line?.dash
    if (typeof dash === 'string' && /^[0-9]+(?:[ ,]+[0-9]+)*$/.test(dash)) {
      lines.push(`${packEdgeDashVar(def.name)}: ${dash.replace(/[ ,]+/g, ' ')};`)
    }
  }
  return `:root {\n  ${lines.join('\n  ')}\n}\n`
}
