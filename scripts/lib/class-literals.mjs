/*
 * Reads the CSS class names a plugin script uses from its `className` / `class` attributes and `className:` properties.
 * Static words are returned in `classes`; a word that touches a `${...}` placeholder cannot be checked statically and
 * is returned as a `dynamic` prefix (for example `fa-` in `fa-${icon}`). Used by the styling contract tests.
 */

const KEY = /\b(?:className|class)\s*(?:=|:)\s*/g

/** The end index (exclusive) of the balanced `{...}` expression starting at `open`, skipping strings and templates. */
function balancedEnd(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") { i = quotedEnd(text, i); continue }
    if (ch === '`') { i = templateEnd(text, i); continue }
    if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) return i + 1
  }
  return text.length
}

function quotedEnd(text, start) {
  const quote = text[start]
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === quote) return i
  }
  return text.length
}

/** Index of the closing backtick of a template literal, descending into `${...}`. */
function templateEnd(text, start) {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === '\\') i++
    else if (text[i] === '`') return i
    else if (text[i] === '$' && text[i + 1] === '{') i = balancedEnd(text, i + 1) - 1
  }
  return text.length
}

/** Words of a string that has literal parts separated by one `${...}` placeholder marker (\u0000). */
function splitWords(value, out) {
  for (const word of value.split(/\s+/)) {
    if (!word) continue
    if (!word.includes('\u0000')) { out.classes.add(word); continue }
    const prefix = word.slice(0, word.indexOf('\u0000'))
    if (prefix) out.dynamic.add(prefix)
  }
}

/** Static text of a template literal with each `${...}` replaced by a marker. */
function templateText(text, start, end) {
  let out = ''
  for (let i = start + 1; i < end; i++) {
    if (text[i] === '$' && text[i + 1] === '{') {
      const close = balancedEnd(text, i + 1)
      out += '\u0000'
      i = close - 1
    } else out += text[i]
  }
  return out
}

/** Every string and template literal inside an expression, as { text, quote } (nested ones included). */
function literalsIn(text, start, end, found) {
  for (let i = start; i < end; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'") {
      const close = quotedEnd(text, i)
      // Operands of a comparison or `??` are values, not class names.
      if (!/(?:===?|!==?|\?\?)\s*$/.test(text.slice(Math.max(0, i - 6), i))) found.push(text.slice(i + 1, close))
      i = close
    }
    else if (ch === '`') {
      const close = templateEnd(text, i)
      found.push(templateText(text, i, close))
      for (let j = i + 1; j < close; j++) {
        if (text[j] === '$' && text[j + 1] === '{') {
          const inner = balancedEnd(text, j + 1)
          literalsIn(text, j + 2, inner - 1, found)
          j = inner - 1
        }
      }
      i = close
    }
  }
}

/** @returns {{ classes: Map<string, number[]>, dynamic: Map<string, number[]> }} class names / dynamic prefixes with 1-based lines */
export function classLiterals(text) {
  const classes = new Map()
  const dynamic = new Map()
  const lineAt = index => text.slice(0, index).split('\n').length
  for (const match of text.matchAll(KEY)) {
    const start = match.index + match[0].length
    const found = []
    if (text[start] === '"' || text[start] === "'") found.push(text.slice(start + 1, quotedEnd(text, start)))
    else if (text[start] === '`') literalsIn(text, start, templateEnd(text, start) + 1, found)
    else if (text[start] === '$' && text[start + 1] === '{') literalsIn(text, start + 2, balancedEnd(text, start + 1) - 1, found)
    else continue
    const words = { classes: new Set(), dynamic: new Set() }
    for (const value of found) splitWords(value, words)
    const line = lineAt(match.index)
    for (const name of words.classes) classes.set(name, [...(classes.get(name) ?? []), line])
    for (const name of words.dynamic) dynamic.set(name, [...(dynamic.get(name) ?? []), line])
  }
  return { classes, dynamic }
}
