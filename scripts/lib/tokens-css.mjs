/*
 * Reads the styling contract (web/sdk/tokens.json, W3C DTCG format) and generates the default-theme CSS.
 * Shared by `npm run tokens` and the contract tests, so the committed web/tokens.css cannot drift from the source.
 */
import fs from 'node:fs'
import path from 'node:path'

export const TOKENS_JSON = path.join('web', 'sdk', 'tokens.json')
export const TOKENS_CSS = path.join('web', 'tokens.css')

export const BANNER = '/* Generated from web/sdk/tokens.json by `npm run tokens`. Do not edit; a test fails when it is stale. */\n'

/** Flat list of tokens in file order: { name (CSS custom property), path, type, value, description, since, origin, scope }. */
export function readTokens(doc) {
  const tokens = []
  const visit = (node, trail, inheritedType) => {
    const type = node.$type ?? inheritedType
    for (const [key, child] of Object.entries(node)) {
      if (key.startsWith('$') || typeof child !== 'object' || child === null) continue
      if ('$value' in child) {
        const meta = child.$extensions?.corum ?? {}
        tokens.push({
          name: `--${key}`,
          path: [...trail, key].join('.'),
          type: child.$type ?? type,
          value: child.$value,
          description: child.$description,
          since: meta.since,
          origin: meta.origin,
          scope: meta.scope ?? 'theme',
        })
      } else visit(child, [...trail, key], type)
    }
  }
  visit(doc, [], undefined)
  return tokens
}

export const contractVersion = doc => doc.$extensions?.corum?.version

function cssValue(token, byPath) {
  const render = (value, type) => {
    if (typeof value === 'string') {
      const alias = /^\{([^}]+)\}$/.exec(value)
      if (!alias) return value
      const target = byPath.get(alias[1])
      if (!target) throw new Error(`${token.path}: alias ${value} does not resolve`)
      return `var(${target.name})`
    }
    if (type === 'shadow') {
      const layers = Array.isArray(value) ? value : [value]
      return layers.map(l => `${l.offsetX} ${l.offsetY} ${l.blur} ${l.spread} ${l.color}`).join(', ')
    }
    if (Array.isArray(value)) return value.map(v => (/[\s]/.test(v) ? `"${v}"` : v)).join(', ')
    throw new Error(`${token.path}: unsupported $value for type ${type}`)
  }
  return render(token.value, token.type)
}

/** The committed web/tokens.css for a parsed tokens.json. Only tokens with the default `theme` scope are written. */
export function generateTokensCss(doc) {
  const tokens = readTokens(doc)
  const byPath = new Map(tokens.map(t => [t.path, t]))
  const lines = tokens.filter(t => t.scope === 'theme').map(t => `  ${t.name}: ${cssValue(t, byPath)};`)
  return [
    BANNER,
    '/* Host-owned: themes must not set this. */',
    ':root {',
    `  --corum-tokens-version: ${contractVersion(doc)};`,
    '}',
    '',
    ':root,',
    '[data-theme="light"] {',
    ...lines,
    '  color-scheme: light;',
    '}',
    '',
  ].join('\n')
}

export function readTokensJson(root = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(root, TOKENS_JSON), 'utf8'))
}
