import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { discoverPlugins, resolvePackPluginDirs, readPluginOverrides } from '../src/web/plugins/discover.js'

function writePlugin(dir: string, id: string): string {
  const pluginDir = path.join(dir, id)
  fs.mkdirSync(pluginDir, { recursive: true })
  fs.writeFileSync(
    path.join(pluginDir, 'plugin.yaml'),
    `id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n`,
  )
  fs.writeFileSync(path.join(pluginDir, 'index.js'), 'export {}\n')
  return pluginDir
}

describe('discoverPlugins', () => {
  let tmp: string
  let savedEnv: string | undefined

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-discover-'))
    savedEnv = process.env.CORUM_BUILTIN_PLUGIN_DIRS
    delete process.env.CORUM_BUILTIN_PLUGIN_DIRS
  })

  afterEach(() => {
    if (savedEnv === undefined) delete process.env.CORUM_BUILTIN_PLUGIN_DIRS
    else process.env.CORUM_BUILTIN_PLUGIN_DIRS = savedEnv
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('discovers built-in and standalone plugins', () => {
    const builtin = path.join(tmp, 'builtin')
    writePlugin(builtin, 'graph')
    fs.writeFileSync(path.join(builtin, '.gitkeep'), '')
    const graphDir = path.join(tmp, 'graph')
    writePlugin(path.join(graphDir, 'plugins'), 'journeys')

    const { plugins, errors } = discoverPlugins({
      builtinDir: builtin,
      graphDir,
      graphYaml: { plugins: [{ path: 'plugins/journeys' }, { id: 'graph', enabled: false }] },
      packPluginDirs: [],
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(plugins.map(p => [p.manifest.id, p.origin]), [['graph', 'builtin'], ['journeys', 'standalone']])
  })

  it('returns built-ins only when graphDir is null (git sources)', () => {
    const builtin = path.join(tmp, 'builtin')
    writePlugin(builtin, 'graph')
    const { plugins } = discoverPlugins({
      builtinDir: builtin,
      graphDir: null,
      graphYaml: { plugins: [{ path: 'plugins/journeys' }] },
      packPluginDirs: [],
    })
    assert.deepEqual(plugins.map(p => p.manifest.id), ['graph'])
  })

  it('tolerates a missing built-in dir', () => {
    const { plugins, errors } = discoverPlugins({ builtinDir: path.join(tmp, 'nope'), graphDir: null, graphYaml: null, packPluginDirs: [] })
    assert.deepEqual(plugins, [])
    assert.deepEqual(errors, [])
  })

  it('honours CORUM_BUILTIN_PLUGIN_DIRS', () => {
    const extra = path.join(tmp, 'extra')
    writePlugin(extra, 'fixture')
    process.env.CORUM_BUILTIN_PLUGIN_DIRS = extra
    const { plugins } = discoverPlugins({ builtinDir: path.join(tmp, 'nope'), graphDir: null, graphYaml: null, packPluginDirs: [] })
    assert.deepEqual(plugins.map(p => [p.manifest.id, p.origin]), [['fixture', 'builtin']])
  })

  it('reports a duplicate id and keeps the built-in', () => {
    const builtin = path.join(tmp, 'builtin')
    const builtinDir = writePlugin(builtin, 'graph')
    const graphDir = path.join(tmp, 'g')
    writePlugin(path.join(graphDir, 'p'), 'graph')

    const { plugins, errors } = discoverPlugins({
      builtinDir: builtin,
      graphDir,
      graphYaml: { plugins: [{ path: 'p/graph' }] },
      packPluginDirs: [],
    })
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0].dir, builtinDir)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /duplicate plugin id "graph"/)
  })

  it('reports malformed manifests, missing plugin.yaml and bad plugins entries', () => {
    const graphDir = path.join(tmp, 'g')
    fs.mkdirSync(path.join(graphDir, 'bad'), { recursive: true })
    fs.writeFileSync(path.join(graphDir, 'bad', 'plugin.yaml'), 'id: Nope\n')
    fs.mkdirSync(path.join(graphDir, 'empty'), { recursive: true })

    const { plugins, errors } = discoverPlugins({
      builtinDir: path.join(tmp, 'nope'),
      graphDir,
      graphYaml: { plugins: [{ path: 'bad' }, { path: 'empty' }, { id: 'x' }, 'str'] },
      packPluginDirs: [],
    })
    assert.deepEqual(plugins, [])
    assert.ok(errors.some(e => /bad/.test(e) && /id "Nope"/.test(e)))
    assert.ok(errors.some(e => /no plugin\.yaml/.test(e)))
    assert.ok(errors.some(e => /plugins\[2\]/.test(e)))
    assert.ok(errors.some(e => /plugins\[3\]/.test(e)))
  })

  it('resolves pack-bundled plugins from pack.yaml', () => {
    const graphDir = path.join(tmp, 'graph')
    const packDir = path.join(tmp, 'packs', 'ui')
    fs.mkdirSync(graphDir, { recursive: true })
    writePlugin(path.join(packDir, 'ui'), 'journeys')
    fs.writeFileSync(path.join(packDir, 'pack.yaml'), 'name: ui\ntemplates: []\nplugins:\n  - ui/journeys\n  - ../escape\n')
    const graphYaml = { templatePacks: [{ name: 'ui', path: '../packs/ui' }] }

    const packErrors: string[] = []
    const dirs = resolvePackPluginDirs(graphDir, graphYaml, packErrors)
    assert.deepEqual(dirs, [path.join(packDir, 'ui', 'journeys')])
    assert.equal(packErrors.length, 1)

    const { plugins } = discoverPlugins({ builtinDir: path.join(tmp, 'nope'), graphDir, graphYaml, packPluginDirs: dirs })
    assert.deepEqual(plugins.map(p => [p.manifest.id, p.origin]), [['journeys', 'pack']])
  })

  it('reads overrides', () => {
    assert.deepEqual(
      readPluginOverrides({ plugins: [{ path: 'x' }, { id: 'a', enabled: false }, { id: 'b' }] }),
      [{ id: 'a', enabled: false }],
    )
  })
})
