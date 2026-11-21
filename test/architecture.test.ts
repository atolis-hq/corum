/*
 * Architecture rules for the UI plugin boundary. These read source files only (no browser).
 * A failure names the offending file and line; fix the code, not the rule, unless the boundary itself is changing
 * (then update docs/plugins.md and ADR-010 too).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import semver from 'semver'
import { parsePluginManifest } from '../src/web/plugins/manifest.js'

const ROOT = process.cwd()
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')
const read = (file: string) => fs.readFileSync(file, 'utf8')

function walk(dir: string, accept: (file: string) => boolean = () => true): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, accept))
    else if (accept(full)) out.push(full)
  }
  return out
}

const isScript = (file: string) => /\.(js|jsx|mjs)$/.test(file)
const isSource = (file: string) => isScript(file) && !/\.test\.(js|jsx)$/.test(file)

const WEB = path.join(ROOT, 'web')
const BUILTIN = path.join(WEB, 'builtin')
const SDK = path.join(WEB, 'sdk')
const HOST_DIR = path.join(WEB, 'host')
const builtinIds = fs.readdirSync(BUILTIN, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name)
const builtinFiles = walk(BUILTIN, isSource)
const sdkFiles = walk(SDK, isSource)
const hostFiles = [path.join(WEB, 'app.jsx'), path.join(WEB, 'search.jsx'), ...walk(HOST_DIR, isSource)]

/** Lines of a file with comments blanked (line numbers preserved). */
function codeLines(file: string): string[] {
  const text = read(file).replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
  return text.split(/\r?\n/).map(line => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
}

interface Hit { file: string; line: number; text: string }
function scan(files: string[], pattern: RegExp): Hit[] {
  const hits: Hit[] = []
  for (const file of files) {
    codeLines(file).forEach((text, index) => {
      if (pattern.test(text)) hits.push({ file: rel(file), line: index + 1, text: text.trim() })
    })
  }
  return hits
}
const report = (hits: Hit[]) => hits.map(hit => `  ${hit.file}:${hit.line}  ${hit.text}`).join('\n')
function expectNone(hits: Hit[], rule: string) {
  assert.equal(hits.length, 0, `${rule}\n${report(hits)}`)
}

/** Module specifiers imported or re-exported by a file, with line numbers. */
function specifiers(file: string): { specifier: string; line: number }[] {
  const found: { specifier: string; line: number }[] = []
  const pattern = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
  codeLines(file).forEach((text, index) => {
    for (const match of text.matchAll(pattern)) found.push({ specifier: match[2], line: index + 1 })
  })
  return found
}

const ALLOWED_BUILTIN_SPECIFIERS = new Set([
  'corum:ui', 'corum:ui/react', 'react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'htm', 'reactflow', 'elkjs',
])

describe('architecture: plugin boundary', () => {
  it('shared UI builds node links only through the context resolver', () => {
    expectNone(scan(sdkFiles.filter(file => path.basename(file) !== 'resolve-node.js'), /['"`][^'"`]*\/node(?:[?'"`]|\$\{)/),
      'Shared UI must use ctx.hrefForNode instead of constructing node URLs:')
  })

  it('built-in plugins import only their own files and the host specifiers', () => {
    const problems: string[] = []
    for (const file of builtinFiles) {
      const own = path.join(BUILTIN, path.relative(BUILTIN, file).split(path.sep)[0])
      for (const { specifier, line } of specifiers(file)) {
        if (ALLOWED_BUILTIN_SPECIFIERS.has(specifier)) continue
        if (specifier.startsWith('./') || specifier.startsWith('../')) {
          const target = path.resolve(path.dirname(file), specifier)
          if (target === own || target.startsWith(own + path.sep)) continue
        }
        problems.push(`  ${rel(file)}:${line}  imports "${specifier}"`)
      }
    }
    assert.equal(problems.length, 0,
      `Built-in plugins may import only relative paths inside their own directory or ${[...ALLOWED_BUILTIN_SPECIFIERS].join(', ')}:\n${problems.join('\n')}`)
  })

  it('web/builtin and web/sdk do not read host globals', () => {
    expectNone(scan([...builtinFiles, ...sdkFiles], /\b(?:window|globalThis|self)\s*(?:\.|\[\s*['"])\s*Corum/),
      'Plugins and the SDK must not read window.Corum* host globals; use the corum:ui / corum:ui/react specifiers or ctx:')
  })

  it('built-in plugins use ctx.api instead of calling fetch directly', () => {
    expectNone(scan(builtinFiles, /(?<![.\w])fetch\s*\(/), 'Built-in plugins must fetch through ctx.api (or useApi), not fetch():')
  })

  it('host code never names a specific plugin', () => {
    assert.ok(builtinIds.length > 0)
    const ids = builtinIds.map(id => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
    const pattern = new RegExp(`['"\`][^'"\`]*/p/(?:${ids})\\b|\\b(?:findPage|isPageAvailable)\\(\\s*['"](?:${ids})['"]`)
    expectNone(scan(hostFiles, pattern),
      `Host code (web/app.jsx, web/host, web/search.jsx) must not hard-code built-in plugin ids (${builtinIds.join(', ')}); resolve pages through the registry:`)
  })

  it('dependency direction: sdk never imports host/builtin/app, host never imports builtin', () => {
    const problems: string[] = []
    const check = (files: string[], forbidden: string[], label: string) => {
      for (const file of files) {
        for (const { specifier, line } of specifiers(file)) {
          if (!specifier.startsWith('.')) continue
          const target = path.resolve(path.dirname(file), specifier)
          if (forbidden.some(dir => target === dir || target.startsWith(dir + path.sep))) {
            problems.push(`  ${rel(file)}:${line}  ${label} imports "${specifier}"`)
          }
        }
      }
    }
    check(sdkFiles, [HOST_DIR, BUILTIN, path.join(WEB, 'app.jsx')], 'web/sdk')
    check(walk(HOST_DIR, isSource), [BUILTIN], 'web/host')
    assert.equal(problems.length, 0, `Dependency direction is builtin -> sdk and host -> sdk only:\n${problems.join('\n')}`)
  })
})

describe('architecture: manifests and SDK surface', () => {
  const corumVersion = JSON.parse(read(path.join(ROOT, 'package.json'))).version as string

  /** Names exported by a module, read from its source. */
  function exportedNames(file: string): string[] {
    const text = read(file)
    assert.ok(!/export\s*\*/.test(text), `${rel(file)} uses "export *"; list exports explicitly so the surface stays reviewable`)
    const names = new Set<string>()
    for (const match of text.matchAll(/export\s*\{([^}]*)\}/g)) {
      for (const part of match[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()
        if (name) names.add(name)
      }
    }
    for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(match[1])
    return [...names].sort()
  }

  function pluginDirs(base: string): string[] {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && fs.existsSync(path.join(base, entry.name, 'plugin.yaml')))
      .map(entry => path.join(base, entry.name))
  }

  function checkPlugins(dirs: string[]): string[] {
    const problems: string[] = []
    const ids: string[] = []
    for (const dir of dirs) {
      const name = rel(dir)
      const { manifest, errors } = parsePluginManifest(read(path.join(dir, 'plugin.yaml')))
      if (!manifest) { problems.push(`${name}: manifest invalid: ${errors.join('; ')}`); continue }
      ids.push(manifest.id)
      if (manifest.id !== path.basename(dir)) problems.push(`${name}: id "${manifest.id}" must equal the directory name "${path.basename(dir)}"`)
      const range = manifest.engines.corum
      if (!semver.satisfies(corumVersion, range, { includePrerelease: true })) {
        problems.push(`${name}: engines.corum "${range}" is not satisfied by package.json version ${corumVersion}`)
      }
      const main = path.join(dir, manifest.main)
      if (!fs.existsSync(main)) {
        problems.push(`${name}: main "${manifest.main}" does not exist`)
        continue
      }
      const exported = new Set(exportedNames(main))
      for (const page of manifest.contributes?.pages ?? []) {
        if (!exported.has(page.mount)) problems.push(`${name}: page "${page.id}" mount "${page.mount}" is not exported by ${manifest.main}`)
      }
    }
    if (new Set(ids).size !== ids.length) problems.push(`plugin ids are not unique: ${ids.join(', ')}`)
    return problems
  }

  it('built-in plugin manifests are valid, unique, compatible and export their mounts', () => {
    const dirs = pluginDirs(BUILTIN)
    assert.deepEqual(dirs.map(dir => path.basename(dir)).sort(), [...builtinIds].sort(), 'every web/builtin directory needs a plugin.yaml')
    assert.deepEqual(checkPlugins(dirs), [])
  })

  it('fixture plugin manifests are valid, unique, compatible and export their mounts', () => {
    const dirs = pluginDirs(path.join(ROOT, 'test', 'fixtures', 'plugins'))
    assert.ok(dirs.length > 0)
    assert.deepEqual(checkPlugins(dirs), [])
  })

  // Adding or removing an SDK export is a compatibility promise to every plugin author.
  const SDK_UI_EXPORTS = [
    'BrandMark', 'Chip', 'Icon', 'PropertiesTable', 'PropertyValue', 'SchemaCard', 'StabilityTag', 'StateTag', 'TemplateBadge',
    'createRegistry', 'getDisplayName', 'hrefForAction', 'hrefForExplorerView', 'hrefForNode', 'html', 'isPageAvailable', 'kindColour', 'matchKeysFor',
    'navigate', 'owningRoot', 'resolveNodeTarget',
  ]
  const SDK_REACT_EXPORTS = ['CtxProvider', 'NodeLinks', 'OpenInMenu', 'QuickLinks', 'mountReact', 'useApi', 'useCtx']
  const UPDATE_HINT = 'Adding or removing an SDK export is a compatibility promise to plugin authors: update the snapshot in test/architecture.test.ts, '
    + 'document it in docs/plugins.md, and if the change is breaking, bump the supported `engines` range.'

  it('the corum:ui surface matches the reviewed snapshot', () => {
    assert.deepEqual(exportedNames(path.join(SDK, 'index.js')), SDK_UI_EXPORTS, `corum:ui exports changed. ${UPDATE_HINT}`)
  })

  it('the corum:ui/react surface matches the reviewed snapshot', () => {
    assert.deepEqual(exportedNames(path.join(SDK, 'react.js')), SDK_REACT_EXPORTS, `corum:ui/react exports changed. ${UPDATE_HINT}`)
  })

  it('every SDK export is documented in docs/plugins.md', () => {
    const docs = read(path.join(ROOT, 'docs', 'plugins.md'))
    const missing = [...SDK_UI_EXPORTS, ...SDK_REACT_EXPORTS].filter(name => !new RegExp(`\\b${name}\\b`).test(docs))
    assert.deepEqual(missing, [], `docs/plugins.md does not mention these SDK exports: ${missing.join(', ')}`)
  })
})

describe('architecture: ratchets', () => {
  // Hard-coded hex colour literals in JS/JSX under web/. The theming epic
  // (project/superpowers/plans/2026-11-21-theming-and-styling-epic-notes.md) should lower this; it may only go down.
  const HEX_COLOUR_BASELINE = 52
  const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/

  it('hard-coded hex colour literals in web scripts do not grow', () => {
    const files = walk(WEB, isSource)
    const count = files.reduce((total, file) => total + (read(file).match(new RegExp(HEX, 'g'))?.length ?? 0), 0)
    assert.ok(count <= HEX_COLOUR_BASELINE,
      `Found ${count} hex colour literals in web/ scripts (baseline ${HEX_COLOUR_BASELINE}). Use CSS variables / theme tokens instead of new hard-coded colours. `
      + `Lines:\n${report(scan(files, HEX).slice(0, 40))}`)
  })
})
