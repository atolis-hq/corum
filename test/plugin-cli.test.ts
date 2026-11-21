import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parsePluginManifest } from '../src/web/plugins/manifest.js'
import { createPluginRuntime } from '../src/web/plugins/runtime.js'
import { enginesRangeFor } from '../src/plugin/scaffold.js'
import { loadGraph } from '../src/loader/index.js'

const CLI = path.join(process.cwd(), 'dist', 'src', 'bin', 'corum.js')
const GRAPH = path.join(process.cwd(), 'fixtures', 'sample-graph')
const VERSION = (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as { version: string }).version

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'corum-plugin-cli-'))
}

function corum(args: string[], cwd?: string) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd })
  return { code: result.status, out: result.stdout, err: result.stderr }
}

function validate(dir: string) {
  return corum(['plugin', 'validate', dir, '--graph', GRAPH])
}

function withManifest(yaml: string, run: (dir: string) => void): void {
  const tmp = tmpDir()
  try {
    fs.writeFileSync(path.join(tmp, 'plugin.yaml'), yaml)
    fs.writeFileSync(path.join(tmp, 'index.js'), 'export {}\n')
    run(tmp)
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
}

const GOOD = 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n'

describe('corum plugin init', () => {
  it('scaffolds a plugin that validates and is enabled as a development plugin', async () => {
    const tmp = tmpDir()
    try {
      const init = corum(['plugin', 'init', 'my-plugin'], tmp)
      assert.equal(init.code, 0, init.err)
      const dir = path.join(tmp, 'my-plugin')
      assert.deepEqual(fs.readdirSync(dir).sort(), ['index.js', 'plugin.yaml'])
      assert.match(init.out, /--plugin-dir/)

      const result = validate(dir)
      assert.equal(result.code, 0, result.err)

      const graph = await loadGraph({ graphPath: GRAPH })
      const runtime = createPluginRuntime({ graph, graphDir: null, builtinDir: path.join(tmp, 'none'), corumVersion: VERSION, devPluginDirs: [dir] })
      const [status] = runtime.statuses()
      assert.equal(status.id, 'my-plugin')
      assert.equal(status.origin, 'dev')
      assert.equal(status.status, 'enabled')
      assert.equal(runtime.enabledDir('my-plugin'), dir)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('renders its sample page into the mount element', async () => {
    const tmp = tmpDir()
    try {
      assert.equal(corum(['plugin', 'init', 'demo', '--dir', path.join(tmp, 'out')]).code, 0)
      const source = fs.readFileSync(path.join(tmp, 'out', 'index.js'), 'utf8')
      const { mountHome } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')) as { mountHome: (el: unknown, ctx: unknown) => () => void }
      const make = (tag: string) => {
        const node: any = { tag, children: [] as any[], attrs: {} as Record<string, string>, textContent: '' }
        node.append = (...items: any[]) => { node.children.push(...items) }
        node.replaceChildren = (...items: any[]) => { node.children = items }
        node.setAttribute = (name: string, value: string) => { node.attrs[name] = value }
        return node
      }
      ;(globalThis as any).document = { createElement: make }
      const el = make('div')
      const dispose = mountHome(el, {
        params: new URLSearchParams(),
        api: { get: async () => [{ id: 'a.b' }] },
        hrefForNode: (id: string) => `#/node?id=${id}`,
        subscribe: () => () => {},
        onError: () => {},
      })
      const section = el.children[0]
      assert.equal(section.attrs['data-testid'], 'plugin-demo')
      assert.equal(section.children[0].textContent, 'demo')
      await new Promise(resolve => setImmediate(resolve))
      assert.equal(section.children[2].children[0].children[0].textContent, 'a.b')
      dispose()
      assert.equal(el.children.length, 0)
    } finally {
      delete (globalThis as any).document
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('scaffolds ids that YAML would read as another type', () => {
    for (const id of ['2024', '1e5', 'true', 'null']) {
      const tmp = tmpDir()
      try {
        const init = corum(['plugin', 'init', id, '--dir', path.join(tmp, 'p')])
        assert.equal(init.code, 0, `${id}: ${init.err}`)
        assert.equal(validate(path.join(tmp, 'p')).code, 0, id)
      } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    }
  })

  it('refuses a built-in plugin id and writes nothing', () => {
    const tmp = tmpDir()
    try {
      const result = corum(['plugin', 'init', 'graph'], tmp)
      assert.notEqual(result.code, 0)
      assert.deepEqual(fs.readdirSync(tmp), [])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('refuses a non-empty target and writes nothing', () => {
    const tmp = tmpDir()
    try {
      fs.writeFileSync(path.join(tmp, 'keep.txt'), 'x')
      const result = corum(['plugin', 'init', 'demo', '--dir', tmp])
      assert.notEqual(result.code, 0)
      assert.deepEqual(fs.readdirSync(tmp), ['keep.txt'])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('rejects an invalid id before writing anything', () => {
    const tmp = tmpDir()
    try {
      const result = corum(['plugin', 'init', 'Bad_Id'], tmp)
      assert.notEqual(result.code, 0)
      assert.deepEqual(fs.readdirSync(tmp), [])
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('targets the running minor version', () => {
    assert.equal(enginesRangeFor('0.1.7'), '>=0.1.0 <0.2.0')
    assert.equal(enginesRangeFor('1.4.0-beta.1'), '>=1.4.0 <1.5.0')
  })
})

describe('corum plugin validate', () => {
  const rejected: [string, string][] = [
    ['missing id', 'version: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n'],
    ['bad id pattern', 'id: Bad_Id\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n'],
    ['missing version', 'id: demo\nengines: { corum: "*" }\nmain: ./index.js\n'],
    ['missing engines', 'id: demo\nversion: 1.0.0\nmain: ./index.js\n'],
    ['missing main', 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\n'],
    ['unsafe main', 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ../index.js\n'],
    ['bad main extension', 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.ts\n'],
    ['non-list templates', GOOD + 'requires: { templates: nope }\n'],
    ['bad pages', GOOD + 'contributes: { pages: nope }\n'],
    ['bad node actions', GOOD + 'contributes: { nodeActions: nope }\n'],
    ['not a mapping', '- a\n- b\n'],
    ['invalid YAML', 'id: [\n'],
  ]
  for (const [name, yaml] of rejected) {
    it(`reports the server's manifest error: ${name}`, () => {
      withManifest(yaml, dir => {
        const expected = parsePluginManifest(yaml).errors
        assert.ok(expected.length > 0)
        const result = validate(dir)
        assert.equal(result.code, 1)
        for (const message of expected) assert.ok(result.err.includes(message), `${message} not in ${result.err}`)
      })
    })
  }

  const PAGE = '    - { id: a, title: A, mount: m }\n'
  const manifestCases: [string, string][] = [
    ['duplicate page ids', GOOD + 'contributes:\n  pages:\n' + PAGE + PAGE],
    ['action pointing at an undeclared page', GOOD + 'contributes:\n  pages:\n' + PAGE + '  nodeActions:\n    - { id: x, label: X, appliesTo: ["*"], page: nope }\n'],
    ['illegal legacyPaths', GOOD + 'contributes:\n  pages:\n    - { id: a, title: A, mount: m, legacyPaths: ["/node"] }\n'],
    ['non-boolean nav', GOOD + 'contributes:\n  pages:\n    - { id: a, title: A, mount: m, nav: "yes" }\n'],
    ['non-boolean nodeSidebar', GOOD + 'contributes:\n  pages:\n    - { id: a, title: A, mount: m, nodeSidebar: 1 }\n'],
    ['non-boolean detail', GOOD + 'contributes:\n  pages:\n    - { id: a, title: A, mount: m, detail: "no" }\n'],
  ]
  for (const [name, yaml] of manifestCases) {
    it(`reports the server's manifest error: ${name}`, () => {
      withManifest(yaml, dir => {
        const expected = parsePluginManifest(yaml).errors
        assert.ok(expected.length > 0)
        const result = validate(dir)
        assert.equal(result.code, 1)
        for (const message of expected) assert.ok(result.err.includes(message), `${message} not in ${result.err}`)
      })
    })
  }

  it('rejects a plugin id that a built-in plugin owns, as the server does', () => {
    withManifest(GOOD.replace('id: demo', 'id: graph'), dir => {
      const result = validate(dir)
      assert.equal(result.code, 1)
      assert.ok(result.err.includes('cannot replace the built-in plugin "graph"'), result.err)
    })
  })

  it('says the directory was not found when it does not exist', () => {
    const result = validate(path.join(os.tmpdir(), 'corum-no-such-plugin-dir'))
    assert.equal(result.code, 2)
    assert.ok(result.err.includes('directory not found'))
  })

  it('reports an unsatisfied engine range with the server reason', () => {
    withManifest(GOOD.replace('"*"', '">=99.0.0"'), dir => {
      const result = validate(dir)
      assert.equal(result.code, 1)
      assert.ok(result.err.includes(`requires Corum >=99.0.0; running ${VERSION}`))
    })
  })

  it('reports an invalid semver range with the server reason', () => {
    withManifest(GOOD.replace('"*"', '"not a range"'), dir => {
      const result = validate(dir)
      assert.equal(result.code, 1)
      assert.ok(result.err.includes('engines.corum "not a range" is not a valid semver range'))
    })
  })

  it('reports missing required templates', () => {
    withManifest(GOOD + 'requires: { templates: [NoSuchTemplate] }\n', dir => {
      const result = validate(dir)
      assert.equal(result.code, 1)
      assert.ok(result.err.includes('missing templates: NoSuchTemplate'))
    })
  })

  it('warns, without failing, when main does not exist', () => {
    withManifest(GOOD.replace('./index.js', './missing.js'), dir => {
      const result = validate(dir)
      assert.equal(result.code, 0)
      assert.ok(result.err.includes('does not exist'))
    })
  })

  it('exits 2 for a missing directory, a missing plugin.yaml and an unloadable graph', () => {
    const tmp = tmpDir()
    try {
      assert.equal(validate(path.join(tmp, 'nope')).code, 2)
      assert.equal(validate(tmp).code, 2)
      fs.writeFileSync(path.join(tmp, 'plugin.yaml'), GOOD)
      const badGraph = path.join(tmp, 'bad-graph')
      fs.mkdirSync(badGraph)
      fs.writeFileSync(path.join(badGraph, 'graph.yaml'), 'name: [\n')
      assert.equal(corum(['plugin', 'validate', tmp, '--graph', badGraph]).code, 2)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})
