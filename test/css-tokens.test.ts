import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const WEB = path.join(process.cwd(), 'web')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(css|js|jsx|mjs|html|json)$/.test(entry.name)) out.push(full)
  }
  return out
}

describe('css tokens (ADR-011 section 1)', () => {
  const LEGACY = /--(?:paper-[23]|paper|ink-[234]|ink|rule-2|rule|accent-2|accent-ink|ok|warn)(?![\w-])/

  it('no legacy variable name appears anywhere in web/', () => {
    const hits: string[] = []
    for (const file of walk(WEB)) {
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((text, index) => {
        if (LEGACY.test(text)) hits.push(`  ${path.relative(process.cwd(), file)}:${index + 1}  ${text.trim()}`)
      })
    }
    assert.equal(hits.length, 0, `Legacy CSS variable names found; use the ADR-011 semantic names (no aliases):\n${hits.join('\n')}`)
  })

  it('html carries data-theme, dark is scoped by [data-theme], tokens version is 1', () => {
    const css = fs.readFileSync(path.join(WEB, 'style.css'), 'utf8')
    assert.match(fs.readFileSync(path.join(WEB, 'index.html'), 'utf8'), /<html[^>]*\sdata-theme="light"/)
    assert.doesNotMatch(css, /body\[data-theme/)
    assert.match(css, /--corum-tokens-version:\s*2;/)
    assert.match(css, /\[data-theme="dark"\]\s*\{[^}]*color-scheme:\s*dark/)
  })
})
