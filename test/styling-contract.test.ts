/*
 * The styling contract (ADR-011 sections 1, 2 and 9): web/sdk/tokens.json (DTCG) and web/sdk/classes.json are the
 * documented, versioned surface. These tests keep the generated CSS, the snapshot, the docs and the static checks in
 * agreement with them. They read source files only (no browser).
 *
 * Intentional contract change: edit tokens.json / classes.json (bump `version` for a removal or rename), run
 * `npm run tokens`, then `npm run styling:snapshot` to rewrite the snapshot, and update docs/styling.md.
 */
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { lintPluginStyles } from '../src/plugin/style-lints.js'
import { validatePluginDir } from '../src/plugin/validate.js'

const ROOT = process.cwd()
const WEB = path.join(ROOT, 'web')
const read = (file: string) => fs.readFileSync(file, 'utf8')
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')
const lib = (name: string) => import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', name)).href)

function walk(dir: string, accept: (file: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { if (entry.name !== 'vendor') out.push(...walk(full, accept)) } else if (accept(full)) out.push(full)
  }
  return out
}

interface Token { name: string; path: string; type?: string; value: unknown; description?: string; since?: number; origin?: string; scope: string }
interface Contract {
  tokensDoc: Record<string, any>
  classesDoc: { version: number; classes: Record<string, { since: number; description: string }> }
  tokens: Token[]
  documentedTokens: Set<string>
  documentedClasses: Set<string>
  snapshot: { version: number; tokens: Record<string, number>; classes: Record<string, number> }
}

let tokensLib: any
let snapshotLib: any
let classLib: any
let contract: Contract
const SNAPSHOT_FILE = path.join(ROOT, 'test', 'fixtures', 'styling-contract.snapshot.json')

before(async () => {
  tokensLib = await lib('tokens-css.mjs')
  snapshotLib = await lib('contract-snapshot.mjs')
  classLib = await lib('class-literals.mjs')
  const tokensDoc = JSON.parse(read(path.join(ROOT, 'web', 'sdk', 'tokens.json')))
  const classesDoc = JSON.parse(read(path.join(ROOT, 'web', 'sdk', 'classes.json')))
  const tokens: Token[] = tokensLib.readTokens(tokensDoc)
  contract = {
    tokensDoc,
    classesDoc,
    tokens,
    documentedTokens: new Set(tokens.map(t => t.name)),
    documentedClasses: new Set(Object.keys(classesDoc.classes)),
    snapshot: JSON.parse(read(SNAPSHOT_FILE)),
  }
})

describe('styling contract: tokens.json (DTCG)', () => {
  const DTCG_TYPES = new Set(['color', 'dimension', 'shadow', 'fontFamily', 'strokeStyle', 'number'])
  const ORIGINS = new Set(['shadcn', 'material', 'corum'])
  const SCOPES = new Set(['theme', 'input', 'derived', 'optional', 'layout'])

  it('every token has $value, $type, $description and $extensions.corum since/origin', () => {
    const problems: string[] = []
    for (const token of contract.tokens) {
      if (token.value === undefined) problems.push(`${token.path}: missing $value`)
      if (!token.type || !DTCG_TYPES.has(token.type)) problems.push(`${token.path}: $type "${token.type}" is not one of ${[...DTCG_TYPES].join(', ')}`)
      if (!token.description?.trim()) problems.push(`${token.path}: missing $description`)
      if (!Number.isInteger(token.since) || token.since! < 1 || token.since! > contract.tokensDoc.$extensions.corum.version) problems.push(`${token.path}: $extensions.corum.since must be an integer between 1 and the contract version`)
      if (!ORIGINS.has(token.origin ?? '')) problems.push(`${token.path}: $extensions.corum.origin must be shadcn, material or corum`)
      if (!SCOPES.has(token.scope)) problems.push(`${token.path}: $extensions.corum.scope must be one of ${[...SCOPES].join(', ')}`)
      if (token.name !== `--${token.path.split('.').pop()}`) problems.push(`${token.path}: name mismatch`)
    }
    assert.deepEqual(problems, [])
  })

  it('token names are unique and aliases resolve', () => {
    const names = contract.tokens.map(t => t.name)
    assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), [], 'duplicate token names')
    const paths = new Set(contract.tokens.map(t => t.path))
    for (const token of contract.tokens) {
      const alias = typeof token.value === 'string' ? /^\{([^}]+)\}$/.exec(token.value) : null
      if (alias) assert.ok(paths.has(alias[1]), `${token.path}: alias ${token.value} does not resolve`)
    }
  })

  it('the contract version is a positive integer shared by tokens.json and classes.json', () => {
    const version = contract.tokensDoc.$extensions.corum.version
    assert.ok(Number.isInteger(version) && version >= 1)
    assert.equal(contract.classesDoc.version, version, 'classes.json version must equal tokens.json $extensions.corum.version')
  })

  it('every standard class has a since and a description, and is styled by web/style.css', () => {
    const css = read(path.join(WEB, 'style.css'))
    const problems: string[] = []
    for (const [name, def] of Object.entries(contract.classesDoc.classes)) {
      if (!Number.isInteger(def.since) || def.since < 1 || def.since > contract.classesDoc.version) problems.push(`${name}: since`)
      if (!def.description?.trim()) problems.push(`${name}: description`)
      if (!new RegExp(`\\.${name.replace(/-/g, '\\-')}(?![\\w-])`).test(css)) problems.push(`${name}: no selector in web/style.css`)
    }
    assert.deepEqual(problems, [])
  })
})

describe('styling contract: generated default theme', () => {
  it('web/tokens.css is up to date with tokens.json', () => {
    const expected = tokensLib.generateTokensCss(contract.tokensDoc)
    assert.equal(read(path.join(WEB, 'tokens.css')), expected, 'web/tokens.css is stale: run `npm run tokens` and commit the result')
  })

  it('--corum-tokens-version is the tokens.json version', () => {
    assert.match(read(path.join(WEB, 'tokens.css')), new RegExp(`--corum-tokens-version:\\s*${contract.tokensDoc.$extensions.corum.version};`))
  })
})

describe('styling contract: snapshot', () => {
  const current = () => snapshotLib.snapshotOf(contract.tokensDoc, contract.classesDoc)

  it('no documented token or class is removed or renamed without a version bump, and additions carry since', () => {
    assert.deepEqual(snapshotLib.compareContract(contract.snapshot, current()), [],
      'Contract changed. A removal or rename needs a higher version in tokens.json and classes.json; an addition needs since equal to the current version.')
  })

  it('the committed snapshot matches the contract', () => {
    assert.deepEqual(contract.snapshot, current(), 'Snapshot out of date: run `npm run styling:snapshot` and commit test/fixtures/styling-contract.snapshot.json')
  })

  describe('compareContract', () => {
    const base = { version: 2, tokens: { '--a': 1, '--b': 2 }, classes: { card: 1 } }
    const compare = (after: object) => snapshotLib.compareContract(base, after)

    it('accepts an identical contract and a new name with the current since', () => {
      assert.deepEqual(compare(base), [])
      assert.deepEqual(compare({ ...base, tokens: { ...base.tokens, '--c': 2 } }), [])
    })

    it('rejects a removed token or class without a bump', () => {
      assert.match(compare({ ...base, tokens: { '--a': 1 } }).join('\n'), /--b was removed or renamed without a contract version bump/)
      assert.match(compare({ ...base, classes: {} }).join('\n'), /class card was removed/)
    })

    it('rejects a rename without a bump and accepts it with one', () => {
      const renamed = { ...base, tokens: { '--a': 1, '--b2': 2 } }
      assert.ok(compare(renamed).some((p: string) => p.includes('--b was removed')))
      assert.deepEqual(compare({ ...renamed, version: 3, tokens: { '--a': 1, '--b2': 3 } }), [])
    })

    it('rejects an addition without since or with the wrong since', () => {
      assert.match(compare({ ...base, tokens: { ...base.tokens, '--c': undefined } }).join('\n'), /--c was added without a "since"/)
      assert.match(compare({ ...base, classes: { ...base.classes, extra: 1 } }).join('\n'), /extra was added with since 1/)
    })

    it('rejects a changed since and a lowered version', () => {
      assert.match(compare({ ...base, tokens: { '--a': 2, '--b': 2 } }).join('\n'), /--a: since changed/)
      assert.match(compare({ ...base, version: 1 }).join('\n'), /version went down/)
    })
  })
})

describe('styling contract: docs', () => {
  const docs = () => read(path.join(ROOT, 'docs', 'styling.md'))

  it('docs/styling.md documents every token and standard class', () => {
    const text = docs()
    const missing = [
      ...[...contract.documentedTokens].filter(name => !text.includes(`\`${name}\``) && !(/^--kind-\d$/.test(name) && text.includes('`--kind-1`')) ),
      ...[...contract.documentedClasses].filter(name => !text.includes(`\`${name}\``)),
    ]
    assert.deepEqual(missing, [], 'docs/styling.md does not mention these tokens/classes (in backticks)')
  })

  it('docs/plugins.md links to docs/styling.md', () => {
    assert.match(read(path.join(ROOT, 'docs', 'plugins.md')), /\]\(styling\.md\)/)
  })
})

describe('styling contract: static checks', () => {
  // Custom properties that components set inline and read in the stylesheet. Not tokens: never theme-set.
  const COMPONENT_PROPERTIES = new Set(['--prop-depth', '--field-depth', '--icon-size', '--swatch', '--sample'])
  const HOST_OWNED = new Set(['--corum-tokens-version'])
  // Template-literal class names are checked by static prefix: namespaces plus the vendored Font Awesome icon classes.
  const DYNAMIC_PREFIXES = ['graph-', 'explorer-', 'fa-']

  const sources = walk(WEB, file => /\.(css|js|jsx|mjs|html)$/.test(file))

  function stripComments(file: string): string {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    return file.endsWith('.css') ? text : text.split('\n').map(line => line.replace(/(^|[^:'"`])\/\/.*$/, '$1')).join('\n')
  }

  it('every var(--x) in web/ is a documented token or declared in the same file', () => {
    const problems: string[] = []
    for (const file of sources) {
      const text = stripComments(file)
      const declared = new Set([...text.matchAll(/(--[\w-]+)['"]?\s*:/g)].map(m => m[1]))
      text.split('\n').forEach((line, index) => {
        for (const match of line.matchAll(/var\(\s*(--[\w-]+)\s*[,)]/g)) {
          const name = match[1]
          if (contract.documentedTokens.has(name) || HOST_OWNED.has(name) || COMPONENT_PROPERTIES.has(name) || declared.has(name)) continue
          problems.push(`  ${rel(file)}:${index + 1}  var(${name})`)
        }
      })
    }
    assert.deepEqual(problems, [], 'Undocumented custom property. Add it to web/sdk/tokens.json (with since/origin), or declare it in the same file:')
  })

  it('every class in web/builtin className literals is a standard class or plugin-namespaced', () => {
    const problems: string[] = []
    const allowed = (name: string, plugin: string) => contract.documentedClasses.has(name) || name.startsWith(plugin + '-') || /^fa-/.test(name)
    for (const file of walk(path.join(WEB, 'builtin'), f => /\.(js|jsx)$/.test(f))) {
      const plugin = path.relative(path.join(WEB, 'builtin'), file).split(path.sep)[0]
      const { classes, dynamic } = classLib.classLiterals(stripComments(file))
      for (const [name, lines] of classes as Map<string, number[]>) {
        if (!allowed(name, plugin)) problems.push(`  ${rel(file)}:${lines[0]}  class "${name}" is neither a documented standard class nor ${plugin}-*`)
      }
      for (const [prefix, lines] of dynamic as Map<string, number[]>) {
        if (!DYNAMIC_PREFIXES.some(allowedPrefix => prefix.startsWith(allowedPrefix))) {
          problems.push(`  ${rel(file)}:${lines[0]}  template-literal class "${prefix}\${...}" needs a static prefix of ${DYNAMIC_PREFIXES.join(', ')}`)
        }
      }
    }
    assert.deepEqual(problems, [], 'Built-in plugins use only documented standard classes (web/sdk/classes.json) or their own namespace:')
  })

  it('the class check is not vacuous', () => {
    const { classes, dynamic } = classLib.classLiterals(
      'html`<div className="card odd-one" /><i className=${`fa-solid fa-${x} pre-${y}${on ? \' active\' : \'\'}`} /><b className=${a === \'flat\' ? \'b\' : \'\'} />`')
    assert.deepEqual([...classes.keys()].sort(), ['active', 'b', 'card', 'fa-solid', 'odd-one'])
    assert.deepEqual([...dynamic.keys()].sort(), ['fa-', 'pre-'])
  })
})

describe('styling contract: style guide plugin', () => {
  const GUIDE = path.join(WEB, 'builtin', 'styleguide')

  it('contract.js is up to date with tokens.json and classes.json', () => {
    assert.equal(read(path.join(GUIDE, 'contract.js')), tokensLib.generateStyleguideContractJs(contract.tokensDoc, contract.classesDoc),
      'web/builtin/styleguide/contract.js is stale: run `npm run tokens` and commit the result')
  })

  it('page.js uses every standard class as a literal, so the guide cannot miss one', () => {
    const text = read(path.join(GUIDE, 'page.js')).replace(/\/\*[\s\S]*?\*\//g, block => block.replace(/[^\n]/g, ' '))
    const { classes } = classLib.classLiterals(text)
    const missing = [...contract.documentedClasses].filter(name => !classes.has(name))
    assert.deepEqual(missing, [], 'Add a sample of each class to web/builtin/styleguide/page.js:')
  })

  it('declares a hidden page that is linked from the Settings menu', () => {
    const manifest = read(path.join(GUIDE, 'plugin.yaml'))
    assert.match(manifest, /nav: false/)
    assert.match(manifest, /settings: \{ label: Style guide, debugOnly: true \}/)
  })
})

describe('styling contract: corum plugin validate advisory lints', () => {
  function withPlugin(files: Record<string, string>, run: (dir: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-style-lint-'))
    try {
      fs.writeFileSync(path.join(dir, 'plugin.yaml'), 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n')
      for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
      run(dir)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  }

  it('warns about colour literals and visual inline styles, and stays quiet for clean sources', () => {
    withPlugin({
      'index.js': "export const a = html`<div style=${{ color: 'red', '--x': 1, padding: 4 }}></div>`\nel.style.background = 'x'\n// #fff in a comment is ignored\n",
      'style.css': '.a { color: #ff0000; background: rgba(0, 0, 0, 0.5); border-color: var(--border); }\n',
    }, dir => {
      const warnings = lintPluginStyles(dir)
      assert.equal(warnings.filter(w => w.includes('colour literal')).length, 2, warnings.join('\n'))
      assert.ok(warnings.some(w => w.includes('inline style sets color')))
      assert.ok(warnings.some(w => w.includes('element.style.background')))
      assert.ok(!warnings.some(w => w.includes('#fff')))
    })
    withPlugin({ 'index.js': 'export const a = html`<div class="card" style=${{ width: 4, \'--node-colour\': c }}></div>`\n' }, dir => {
      assert.deepEqual(lintPluginStyles(dir), [])
    })
  })

  it('reports them as warnings through validatePluginDir without changing the exit code', () => {
    withPlugin({ 'index.js': "export const c = '#e8614a'\n" }, dir => {
      const result = validatePluginDir(dir, new Set(), '0.1.0')
      assert.equal(result.exitCode, 0)
      assert.ok(result.warnings.some(w => w.includes('colour literal "#e8614a"')), result.warnings.join('\n'))
    })
  })
})
