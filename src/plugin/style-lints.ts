import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/*
 * Advisory styling lints for `corum plugin validate` (ADR-011 section 9). They flag the two things that break a plugin
 * under another theme: colour literals and visual inline styles. They are warnings only: they never change the exit code.
 */

const SCRIPT = /\.(?:js|jsx|mjs)$/
const STYLE = /\.css$/
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist'])

const HEX = /(?<![\w&#])#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/
const FUNCTIONAL = /\b(?:rgba?|hsla?)\(/
const VISUAL_PROP = /^(?:color|background\w*|border\w*|font\w*|boxShadow|textShadow|opacity|outline\w*|fill\w*|stroke\w*|textDecoration\w*)$/
const VISUAL_CSS = /^(?:color|background[\w-]*|border[\w-]*|font[\w-]*|box-shadow|text-shadow|opacity|outline[\w-]*|fill[\w-]*|stroke[\w-]*|text-decoration[\w-]*)$/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) out.push(...sourceFiles(full))
    } else if (SCRIPT.test(entry.name) || STYLE.test(entry.name)) out.push(full)
  }
  return out
}

/** Source text with comments blanked, keeping line numbers. */
function withoutComments(text: string, css: boolean): string {
  const blanked = text.replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
  return css ? blanked : blanked.split('\n').map(line => line.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
}

function visualInlineStyles(text: string): { index: number; what: string }[] {
  const hits: { index: number; what: string }[] = []
  for (const match of text.matchAll(/\b(?:style|labelStyle|labelBgStyle|innerStyle)\s*[=:]\s*\$?\{/g)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let end = open
    for (; end < text.length; end++) {
      if (text[end] === '{') depth++
      else if (text[end] === '}' && --depth === 0) break
    }
    for (const key of text.slice(open + 1, end).matchAll(/(?:^|[{,\s])(['"]?)([A-Za-z-][\w-]*)\1\s*:(?!:)/g)) {
      if (!key[2].startsWith('--') && VISUAL_PROP.test(key[2])) hits.push({ index: open + 1 + (key.index ?? 0), what: `inline style sets ${key[2]}` })
    }
  }
  for (const match of text.matchAll(/\.style\.(\w+)\s*=/g)) {
    if (match[1] === 'cssText' || VISUAL_PROP.test(match[1])) hits.push({ index: match.index, what: `element.style.${match[1]} is set` })
  }
  for (const match of text.matchAll(/\.style\.setProperty\(\s*['"]([^'"]+)['"]/g)) {
    if (!match[1].startsWith('--') && VISUAL_CSS.test(match[1])) hits.push({ index: match.index, what: `style.setProperty(${match[1]})` })
  }
  return hits
}

/** Warnings for colour literals and visual inline styles in the plugin's own sources. */
export function lintPluginStyles(root: string): string[] {
  const warnings: string[] = []
  for (const file of sourceFiles(root)) {
    const css = STYLE.test(file)
    const text = withoutComments(readFileSync(file, 'utf8'), css)
    const lineAt = (index: number) => text.slice(0, index).split('\n').length
    const where = (index: number) => `${file}:${lineAt(index)}`
    const literal = new RegExp(`${HEX.source}|${FUNCTIONAL.source}`, 'g')
    for (const match of text.matchAll(literal)) {
      warnings.push(`${where(match.index)}: colour literal "${match[0]}"; use a design token such as var(--foreground) (docs/styling.md)`)
    }
    if (!css) {
      for (const hit of visualInlineStyles(text)) {
        warnings.push(`${where(hit.index)}: ${hit.what}; use a standard class or your own stylesheet instead of a visual inline style (docs/styling.md)`)
      }
    }
  }
  return warnings
}
