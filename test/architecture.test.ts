/*
 * Architecture rules for the UI plugin boundary. These read source files only (no browser).
 * A failure names the offending file and line; fix the code, not the rule, unless the boundary itself is changing
 * (then update docs/plugins.md and ADR-010 too).
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import semver from 'semver'
import ts from 'typescript'
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
    'BrandMark', 'Chip', 'EmptyState', 'ErrorPanel', 'Icon', 'LoadingPanel', 'PropertiesTable', 'PropertyValue', 'SchemaCard', 'StabilityTag', 'StateTag', 'TemplateBadge',
    'createRegistry', 'edgeTypeStyle', 'getDisplayName', 'hrefForAction', 'hrefForExplorerView', 'hrefForNode', 'html', 'isPageAvailable', 'kindColour', 'matchKeysFor',
    'navigate', 'owningRoot', 'resolveNodeTarget', 'templateColourStyle',
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

  describe('shipped type declarations', () => {
    const TYPES = path.join(SDK, 'types')
    const UI_DTS = path.join(TYPES, 'corum-ui.d.ts')
    const REACT_DTS = path.join(TYPES, 'corum-ui-react.d.ts')
    const FIXTURES = path.join(ROOT, 'test', 'fixtures', 'sdk-types')

    type Declared = { values: string[]; types: string[]; members: Map<string, string[]> }

    /** Parse an ambient `declare module '<specifier>'` block and list its exported values, types and interface members. */
    function declared(file: string, specifier: string): Declared {
      const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.ES2022, true)
      const block = source.statements.find((node): node is ts.ModuleDeclaration =>
        ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name) && node.name.text === specifier)
      assert.ok(block?.body && ts.isModuleBlock(block.body), `${rel(file)} must declare module '${specifier}'`)
      const out: Declared = { values: [], types: [], members: new Map() }
      for (const node of block.body.statements) {
        const exported = ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
        if (!exported) continue
        if (ts.isFunctionDeclaration(node) && node.name) out.values.push(node.name.text)
        else if (ts.isVariableStatement(node)) {
          for (const decl of node.declarationList.declarations) if (ts.isIdentifier(decl.name)) out.values.push(decl.name.text)
        } else if (ts.isInterfaceDeclaration(node)) {
          out.types.push(node.name.text)
          out.members.set(node.name.text, node.members.flatMap(m => (m.name && ts.isIdentifier(m.name) ? [m.name.text] : [])))
        } else if (ts.isTypeAliasDeclaration(node)) out.types.push(node.name.text)
      }
      return { values: out.values.sort(), types: out.types.sort(), members: out.members }
    }

    const runtimeSurface = (file: string) => [...exportedNames(path.join(SDK, file))].sort()
    const SNAPSHOT_HINT = 'Update web/sdk/types/*.d.ts, the snapshot above and docs/plugins.md together.'

    it('declared corum:ui value exports match the runtime snapshot and source', () => {
      assert.deepEqual(declared(UI_DTS, 'corum:ui').values, [...SDK_UI_EXPORTS].sort(), `corum:ui declarations drifted from the snapshot. ${SNAPSHOT_HINT}`)
      assert.deepEqual(declared(UI_DTS, 'corum:ui').values, runtimeSurface('index.js'), `corum:ui declarations drifted from web/sdk/index.js. ${SNAPSHOT_HINT}`)
    })

    it('declared corum:ui/react value exports match the runtime snapshot and source', () => {
      assert.deepEqual(declared(REACT_DTS, 'corum:ui/react').values, [...SDK_REACT_EXPORTS].sort(), `corum:ui/react declarations drifted from the snapshot. ${SNAPSHOT_HINT}`)
      assert.deepEqual(declared(REACT_DTS, 'corum:ui/react').values, runtimeSurface('react.js'), `corum:ui/react declarations drifted from web/sdk/react.js. ${SNAPSHOT_HINT}`)
    })

    it('declared PluginContext members match the real ctx object', async () => {
      const { createPluginContext } = await import(pathToFileURL(path.join(ROOT, 'web', 'host', 'context.js')).href)
      const env = { registry: {}, owningRoot: () => null, hrefForNode: () => '', navigate: () => {}, buildRoute: () => '', pluginId: 'p', pageId: 'g' }
      const { ctx } = createPluginContext(env, { route: { params: new URLSearchParams() }, viewingRef: null, templates: [] }, () => {})
      const members = declared(UI_DTS, 'corum:ui').members.get('PluginContext') ?? []
      assert.deepEqual([...members].sort(), Object.keys(ctx).sort(), `PluginContext drifted from createPluginContext (web/host/context.js). ${SNAPSHOT_HINT}`)
      assert.deepEqual(Object.keys(ctx.api).sort(), ['get'])
    })

    it('declared manifest members cover the documented manifest fields', () => {
      const members = declared(UI_DTS, 'corum:ui').members
      assert.deepEqual([...(members.get('PluginManifest') ?? [])].sort(), ['contributes', 'engines', 'id', 'main', 'requires', 'version'])
      const docs = read(path.join(ROOT, 'docs', 'plugins.md'))
      const missing = [...(members.get('PluginPage') ?? []), ...(members.get('PluginNodeAction') ?? [])].filter(name => !docs.includes(name))
      assert.deepEqual(missing, [], `docs/plugins.md does not mention manifest fields: ${missing.join(', ')}`)
    })

    it('every declared export, type and ctx member is documented in docs/plugins.md', () => {
      const docs = read(path.join(ROOT, 'docs', 'plugins.md'))
      const ui = declared(UI_DTS, 'corum:ui')
      const react = declared(REACT_DTS, 'corum:ui/react')
      const names = [...ui.values, ...ui.types, ...react.values, ...(ui.members.get('PluginContext') ?? []).map(member => `ctx.${member}`)]
      const missing = names.filter(name => !new RegExp(`(?<![\\w.])${name.replace('.', '\\.')}\\b`).test(docs))
      assert.deepEqual(missing, [], `docs/plugins.md does not mention: ${missing.join(', ')}`)
    })

    function typecheck(configName: string): readonly ts.Diagnostic[] {
      const configPath = path.join(FIXTURES, configName)
      const config = ts.readConfigFile(configPath, ts.sys.readFile)
      const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, FIXTURES)
      assert.ok(parsed.options.strict && parsed.options.skipLibCheck === false && parsed.options.noEmit, 'fixtures must check strictly without emitting')
      const program = ts.createProgram(parsed.fileNames, parsed.options)
      return ts.getPreEmitDiagnostics(program)
    }

    const format = (diagnostics: readonly ts.Diagnostic[]) => diagnostics.map(d => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')

    it('the sample plugin type-checks against the shipped declarations', () => {
      assert.deepEqual(format(typecheck('tsconfig.json')), '')
    })

    it('the negative fixture fails the type check, so the check is not vacuous', () => {
      const diagnostics = typecheck('tsconfig.bad.json')
      assert.ok(diagnostics.length >= 2, 'expected the bad fixture to produce type errors')
      assert.match(format(diagnostics), /notAMember/)
    })

    it('declarations are included in the published package', () => {
      const files: string[] = JSON.parse(read(path.join(ROOT, 'package.json'))).files
      assert.ok(files.some(entry => /^web\/?$/.test(entry)), 'package.json files must include web/')
      assert.ok(fs.existsSync(UI_DTS) && fs.existsSync(REACT_DTS))
    })
  })
})

describe('architecture: script colours and inline styles', () => {
  // ADR-011 section 5: scripts never carry colour values. Pack colours are data injected as custom properties, and
  // every other colour is a theme token. Hard zero (the former ratchet is gone).
  const HEX = /#(?:[0-9a-fA-F]{3}){1,2}\b/
  const files = walk(WEB, isSource)

  it('there are no hex colour literals in web scripts', () => {
    const hits = files.flatMap(file => read(file).split(/\r?\n/).flatMap((text, index) =>
      HEX.test(text) ? [{ file: rel(file), line: index + 1, text: text.trim() }] : []))
    expectNone(hits, 'Use a semantic token (var(--...)) or a pack colour custom property instead of a colour literal (ADR-011).')
  })

  // Visual properties may not be set inline. Layout-dynamic properties (width, transform, offsets, grid templates, gap,
  // padding, margin, cursor, ...) and custom-property assignment (`--x`) are allowed.
  const VISUAL_PROP = /^(?:color|background\w*|border\w*|font\w*|boxShadow|textShadow|opacity|outline\w*|fill\w*|stroke\w*|textDecoration\w*)$/
  const VISUAL_CSS = /^(?:color|background[\w-]*|border[\w-]*|font[\w-]*|box-shadow|text-shadow|opacity|outline[\w-]*|fill[\w-]*|stroke[\w-]*|text-decoration[\w-]*)$/

  function visualInlineStyles(file: string): Hit[] {
    const text = codeLines(file).join('\n')
    const hits: Hit[] = []
    const lineAt = (index: number) => text.slice(0, index).split('\n').length
    const add = (index: number, what: string) => hits.push({ file: rel(file), line: lineAt(index), text: what })

    for (const match of text.matchAll(/\b(?:style|labelStyle|labelBgStyle|innerStyle)\s*[=:]\s*\$?\{/g)) {
      const open = match.index! + match[0].length - 1
      let depth = 0
      let end = open
      for (; end < text.length; end++) {
        if (text[end] === '{') depth++
        else if (text[end] === '}' && --depth === 0) break
      }
      const body = text.slice(open + 1, end)
      for (const key of body.matchAll(/(?:^|[{,\s])(['"]?)([A-Za-z-][\w-]*)\1\s*:(?!:)/g)) {
        if (!key[2].startsWith('--') && VISUAL_PROP.test(key[2])) add(match.index! + match[0].length + (key.index ?? 0), `style sets ${key[2]}`)
      }
    }
    for (const match of text.matchAll(/\.style\.(\w+)\s*=/g)) {
      if (match[1] === 'cssText' || VISUAL_PROP.test(match[1])) add(match.index!, `element.style.${match[1]}`)
    }
    for (const match of text.matchAll(/\.style\.setProperty\(\s*['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('--') && VISUAL_CSS.test(match[1])) add(match.index!, `style.setProperty(${match[1]})`)
    }
    return hits
  }

  it('no inline style or element.style assignment sets a visual property', () => {
    expectNone(files.flatMap(visualInlineStyles),
      'Move visual styling into web/style.css (a class) or pass a custom property (e.g. --node-colour) instead of an inline visual property.')
  })

  it('the inline-style check is not vacuous', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-inline-style-'))
    const probe = path.join(dir, 'probe.js')
    fs.writeFileSync(probe, "html`<span style=${{ color: 'red', '--x': 1, padding: 4 }}></span>`; el.style.background = 'x'; el.style.cssText = 'a'")
    try {
      assert.deepEqual(visualInlineStyles(probe).map(hit => hit.text).sort(), ['element.style.background', 'element.style.cssText', 'style sets color'])
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})

describe('architecture: stylesheet tokens', () => {
  // ADR-011: every colour in web/ stylesheets comes from a semantic token. Hard zero (not a ratchet).
  // Theme blocks (selectors containing `data-theme`) are where token values are defined, so they are exempt from the
  // literal rules but are checked for light/dark parity and against the documented list below.
  const cssFiles = walk(WEB, file => file.endsWith('.css') && !file.split(path.sep).includes('vendor'))

  // Plain list of the documented tokens (web/sdk/tokens.json does not exist yet). Adding a token requires updating it.
  const DOCUMENTED_TOKENS = [
    '--background', '--card', '--muted', '--foreground', '--secondary-foreground', '--muted-foreground',
    '--subtle-foreground', '--border', '--border-strong', '--accent', '--accent-soft', '--accent-text',
    '--success', '--warning', '--ring', '--destructive', '--info',
    '--on-accent', '--on-solid', '--scrim', '--shadow-sm', '--shadow-md', '--shadow-lg', '--shadow-xl', '--overlay-secondary',
    '--edge-default', '--kind-1', '--kind-2', '--kind-3', '--kind-4', '--kind-5', '--kind-6', '--kind-7', '--kind-8',
    '--radius-sm', '--radius', '--radius-lg',
  ]
  const HOST_OWNED = new Set(['--corum-tokens-version'])

  const COLOUR_LITERAL = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgba?|hsla?)\(/
  const NAMED_COLOURS = new Set(('aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown '
    + 'burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray '
    + 'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue '
    + 'darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite '
    + 'forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory '
    + 'khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen '
    + 'lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime '
    + 'limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue '
    + 'mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive '
    + 'olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum '
    + 'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue '
    + 'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke '
    + 'yellow yellowgreen').split(' '))

  interface Rule { file: string; selector: string; decls: { line: number; prop: string; value: string }[] }

  /** Minimal CSS reader: yields flat rule blocks with their selector (nested at-rules are descended into). */
  function parseRules(file: string): Rule[] {
    const text = read(file).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    const rules: Rule[] = []
    const stack: { selector: string; rule?: Rule }[] = []
    let buf = ''
    let line = 1
    let bufLine = 1
    for (const ch of text) {
      if (ch === '{') {
        const selector = buf.trim()
        const isAt = selector.startsWith('@') && /^@(media|supports|layer|container)\b/.test(selector)
        const entry: { selector: string; rule?: Rule } = { selector }
        if (!isAt) { entry.rule = { file: rel(file), selector, decls: [] }; rules.push(entry.rule) }
        stack.push(entry)
        buf = ''
      } else if (ch === '}') {
        const top = stack.pop()
        if (top?.rule && buf.trim()) addDecl(top.rule, buf, bufLine)
        buf = ''
      } else if (ch === ';') {
        const top = stack[stack.length - 1]
        if (top?.rule) addDecl(top.rule, buf, bufLine)
        buf = ''
      } else {
        if (!buf.trim()) bufLine = line
        buf += ch
      }
      if (ch === '\n') line++
    }
    return rules
  }
  function addDecl(rule: Rule, raw: string, line: number) {
    const idx = raw.indexOf(':')
    if (idx < 0) return
    rule.decls.push({ line, prop: raw.slice(0, idx).trim(), value: raw.slice(idx + 1).trim() })
  }

  const allRules = cssFiles.flatMap(parseRules)
  const isTheme = (rule: Rule) => rule.selector.includes('data-theme')
  const nonTheme = allRules.filter(rule => !isTheme(rule))
  const decls = nonTheme.flatMap(rule => rule.decls.map(d => ({ ...d, file: rule.file })))
  const fmt = (items: { file: string; line: number; prop: string; value: string }[]) =>
    items.map(d => `${d.file}:${d.line}  ${d.prop}: ${d.value}`).join('\n')

  it('finds the stylesheet(s) to check', () => {
    assert.ok(cssFiles.length > 0)
    assert.ok(nonTheme.length > 100)
  })

  it('no colour literals (hex, rgb(), hsl()) outside theme definitions', () => {
    const bad = decls.filter(d => COLOUR_LITERAL.test(d.value))
    assert.equal(bad.length, 0, `Colour literals must come from semantic tokens (ADR-011):\n${fmt(bad)}`)
  })

  it('no named colour keywords outside theme definitions', () => {
    const bad = decls.filter(d => !d.prop.startsWith('--') && d.value.split(/[^a-zA-Z-]+/).some(word => NAMED_COLOURS.has(word.toLowerCase())))
    assert.equal(bad.length, 0, `Named colours must come from semantic tokens (ADR-011):\n${fmt(bad)}`)
  })

  it('no literal 4px/6px/10px radii where a radius token exists', () => {
    const bad = decls.filter(d => d.prop.startsWith('border') && d.prop.endsWith('radius') && /(^|[\s(])(4|6|10)px\b/.test(d.value))
    assert.equal(bad.length, 0, `Use var(--radius-sm|--radius|--radius-lg):\n${fmt(bad)}`)
  })

  const themeTokens = (selectorTest: (selector: string) => boolean) => {
    const tokens = new Set<string>()
    for (const rule of allRules.filter(r => isTheme(r) && selectorTest(r.selector))) {
      for (const d of rule.decls) if (d.prop.startsWith('--') && !HOST_OWNED.has(d.prop)) tokens.add(d.prop)
    }
    return tokens
  }
  const light = themeTokens(s => !s.includes('dark'))
  const dark = themeTokens(s => s.includes('dark'))

  it('every token has a value in both light and dark', () => {
    assert.deepEqual([...light].filter(t => !dark.has(t)), [], 'tokens missing from the dark theme')
    assert.deepEqual([...dark].filter(t => !light.has(t)), [], 'tokens missing from the light theme')
  })

  it('theme tokens match the documented token list', () => {
    assert.deepEqual([...light].sort(), [...DOCUMENTED_TOKENS].sort(),
      'Update DOCUMENTED_TOKENS (and the contract docs) in the same change that adds or removes a token')
  })
})
