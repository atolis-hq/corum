// Pure helpers for scripts/publish-screenshots.mjs.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const MAX_BYTES = 600 * 1024
export const SECTION_HEADING = '## Screenshots'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const NAME_RE = /^([A-Za-z0-9][A-Za-z0-9._-]*)-(before|after)\.png$/

/** Parse `<stem>-<before|after>.png`. Returns null when the name is not acceptable. */
export function parseName(name) {
  const m = NAME_RE.exec(name)
  return m ? { stem: m[1], side: m[2] } : null
}

export function isPng(buf) {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)
}

/** Validate one file; returns an array of problem strings (empty when fine). */
export function validateFile(name, buf) {
  const problems = []
  if (!parseName(name)) {
    problems.push(
      `${name}: name must be <subject>-<variant>-before.png or -after.png (letters, digits, ., _, - only)`,
    )
  }
  if (!isPng(buf)) problems.push(`${name}: not a PNG (bad signature)`)
  if (buf.length > MAX_BYTES) {
    problems.push(`${name}: ${buf.length} bytes exceeds the ${MAX_BYTES} byte (600 KB) limit`)
  }
  return problems
}

/** Read and validate a directory. Throws one Error listing every problem. */
export function readScreenshotDir(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    throw new Error(`Screenshot directory not found: ${dir}`)
  }
  if (entries.length === 0) throw new Error(`Screenshot directory is empty: ${dir}`)
  const files = []
  const problems = []
  for (const name of entries.sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      problems.push(`${name}: subdirectories are not allowed`)
      continue
    }
    problems.push(...validateFile(name, readFileSync(p)))
    files.push({ name, path: p })
  }
  if (problems.length) throw new Error(`Refusing to publish:\n  ${problems.join('\n  ')}`)
  return files
}

export function groupByStem(names) {
  const map = new Map()
  for (const name of [...names].sort()) {
    const parsed = parseName(name)
    if (!parsed) continue
    const row = map.get(parsed.stem) ?? { stem: parsed.stem }
    row[parsed.side] = name
    map.set(parsed.stem, row)
  }
  return [...map.values()]
}

export function rawUrl({ repo, sha, pr, name }) {
  return `https://raw.githubusercontent.com/${repo}/${sha}/pr-${pr}/${name}`
}

/** Build the "## Screenshots" section. */
export function buildMarkdown({ repo, sha, pr, names }) {
  const cell = (row, side) =>
    row[side]
      ? `![${row.stem.replace(/-/g, ' ')} ${side}](${rawUrl({ repo, sha, pr, name: row[side] })})`
      : '—'
  const lines = [SECTION_HEADING, '', '| Page | Before | After |', '| --- | --- | --- |']
  for (const row of groupByStem(names)) {
    lines.push(`| ${row.stem} | ${cell(row, 'before')} | ${cell(row, 'after')} |`)
  }
  return lines.join('\n') + '\n'
}

export function unpairedStems(names) {
  return groupByStem(names).filter((r) => !r.before || !r.after)
}

/** Replace the "## Screenshots" section (ignoring code fences) or append it. */
export function replaceSection(body, section) {
  const lines = (body ?? '').split('\n')
  let fence = null
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (fence === null) fence = f[1][0]
      else if (f[1][0] === fence) fence = null
      continue
    }
    if (fence) continue
    if (start < 0) {
      if (/^## Screenshots\s*$/.test(line)) start = i
    } else if (/^#{1,2}\s/.test(line)) {
      end = i
      break
    }
  }
  const sectionText = section.replace(/\n+$/, '')
  if (start < 0) {
    const base = (body ?? '').replace(/\s+$/, '')
    return (base ? base + '\n\n' : '') + sectionText + '\n'
  }
  const before = lines.slice(0, start).join('\n')
  const after = lines.slice(end).join('\n').replace(/^\n+/, '')
  return (before ? before + '\n' : '') + sectionText + '\n' + (after ? '\n' + after : '')
}

/** Derive owner/name from a GitHub remote URL (https or ssh). */
export function repoFromUrl(url) {
  const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim())
  return m ? `${m[1]}/${m[2]}` : null
}
