import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { GitGraphSource } from '../src/source/git-source.js'
import { discoverPlugins, directoryRevision } from '../src/web/plugins/discover.js'
import { resolvePluginStatuses } from '../src/web/plugins/status.js'
import { createPluginRuntime } from '../src/web/plugins/runtime.js'
import { createGitPluginState } from '../src/web/plugins/git-runtime.js'
import type { Graph } from '../src/schema/index.js'

const { pluginsChanged } = await import(pathToFileURL(path.join(process.cwd(), 'web', 'host', 'plugin-loader.js')).href)

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'corum-dev-plugins-'))
}

function writePlugin(parent: string, name: string, id = name): string {
  const dir = path.join(parent, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'plugin.yaml'), `id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n`)
  fs.writeFileSync(path.join(dir, 'index.js'), 'export {}\n')
  return dir
}

const statusContext = { graphTemplates: new Set<string>(), corumVersion: '0.1.0', overrides: [] }

describe('development plugin discovery', () => {
  it('replaces a registered plugin of the same id, reports it shadowed and warns naming both', () => {
    const tmp = tmpDir()
    try {
      const registered = writePlugin(tmp, 'registered', 'demo')
      const dev = writePlugin(tmp, 'dev', 'demo')
      const { plugins, errors } = discoverPlugins({
        builtinDir: path.join(tmp, 'none'), graphDir: tmp, graphYaml: { plugins: [{ path: 'registered' }] },
        packPluginDirs: [], devPluginDirs: [dev],
      })
      const statuses = resolvePluginStatuses(plugins, statusContext)
      const enabled = statuses.filter(entry => entry.status === 'enabled')
      assert.deepEqual(enabled.map(entry => [entry.id, entry.origin]), [['demo', 'dev']])
      const shadowed = statuses.find(entry => entry.status === 'unavailable')
      assert.equal(shadowed?.origin, 'standalone')
      assert.ok(shadowed?.reason?.includes('shadowed by development plugin'))
      assert.ok(shadowed?.reason?.includes(dev))
      assert.ok(errors.some(error => error.includes(dev) && error.includes(registered)))
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('replaces a pack plugin of the same id', () => {
    const tmp = tmpDir()
    try {
      const pack = writePlugin(tmp, 'packplugin', 'demo')
      const dev = writePlugin(tmp, 'dev', 'demo')
      const { plugins } = discoverPlugins({
        builtinDir: path.join(tmp, 'none'), graphDir: null, graphYaml: null, packPluginDirs: [pack], devPluginDirs: [dev],
      })
      const statuses = resolvePluginStatuses(plugins, statusContext)
      assert.equal(statuses.find(entry => entry.origin === 'pack')?.status, 'unavailable')
      assert.equal(statuses.find(entry => entry.origin === 'dev')?.status, 'enabled')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('does not let a development plugin replace a built-in', () => {
    const tmp = tmpDir()
    try {
      writePlugin(path.join(tmp, 'builtins'), 'core')
      const dev = writePlugin(tmp, 'dev', 'core')
      const { plugins, errors } = discoverPlugins({
        builtinDir: path.join(tmp, 'builtins'), graphDir: null, graphYaml: null, packPluginDirs: [], devPluginDirs: [dev],
      })
      const statuses = resolvePluginStatuses(plugins, statusContext)
      assert.equal(statuses.find(entry => entry.origin === 'builtin')?.status, 'enabled')
      const devStatus = statuses.find(entry => entry.origin === 'dev')
      assert.equal(devStatus?.status, 'unavailable')
      assert.ok(devStatus?.reason?.includes('built-in'))
      assert.ok(errors.some(error => error.includes('built-in')))
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('keeps the first of two development plugins with the same id', () => {
    const tmp = tmpDir()
    try {
      const first = writePlugin(tmp, 'a', 'demo')
      const second = writePlugin(tmp, 'b', 'demo')
      const { plugins } = discoverPlugins({
        builtinDir: path.join(tmp, 'none'), graphDir: null, graphYaml: null, packPluginDirs: [], devPluginDirs: [first, second],
      })
      const statuses = resolvePluginStatuses(plugins, statusContext)
      assert.equal(statuses.length, 2)
      assert.equal(statuses[0].status, 'enabled')
      assert.equal(statuses[1].status, 'unavailable')
      assert.ok(statuses[1].reason?.includes('duplicate'))
      assert.ok(statuses[1].reason?.includes(first))
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('applies graph.yaml enabled:false overrides to a development plugin', () => {
    const tmp = tmpDir()
    try {
      const dev = writePlugin(tmp, 'dev', 'demo')
      const { plugins } = discoverPlugins({
        builtinDir: path.join(tmp, 'none'), graphDir: null, graphYaml: null, packPluginDirs: [], devPluginDirs: [dev],
      })
      const statuses = resolvePluginStatuses(plugins, { ...statusContext, overrides: [{ id: 'demo', enabled: false }] })
      assert.equal(statuses[0].status, 'disabled')
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('changes the revision when any file changes, which the browser treats as a plugin change', async () => {
    const tmp = tmpDir()
    try {
      const dev = writePlugin(tmp, 'dev', 'demo')
      const before = directoryRevision(dev)
      assert.equal(directoryRevision(dev), before)
      await new Promise(resolve => setTimeout(resolve, 20))
      fs.appendFileSync(path.join(dev, 'index.js'), '// edit\n')
      const after = directoryRevision(dev)
      assert.notEqual(after, before)
      const entry = (revision: string) => ({ id: 'demo', status: 'enabled', version: '1.0.0', revision })
      assert.equal(pluginsChanged([entry(before)], [entry(before)]), false)
      assert.equal(pluginsChanged([entry(before)], [entry(after)]), true)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })

  it('keeps running when a manifest becomes invalid and recovers when it is fixed', () => {
    const tmp = tmpDir()
    try {
      const dev = writePlugin(tmp, 'dev', 'demo')
      const logs: string[] = []
      const runtime = createPluginRuntime({
        graph: { templates: new Map() } as unknown as Graph, graphDir: null, builtinDir: path.join(tmp, 'none'),
        corumVersion: '0.1.0', devPluginDirs: [dev], logger: message => logs.push(message),
      })
      assert.equal(runtime.enabledDir('demo'), dev)
      fs.writeFileSync(path.join(dev, 'plugin.yaml'), 'id: [broken\n')
      runtime.refresh()
      assert.equal(runtime.enabledDir('demo'), null)
      assert.ok(logs.some(message => message.includes('development plugin')))
      fs.writeFileSync(path.join(dev, 'plugin.yaml'), 'id: demo\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n')
      runtime.refresh()
      assert.equal(runtime.enabledDir('demo'), dev)
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('corum web --plugin-dir', () => {
  it('exits non-zero for a missing directory or plugin.yaml before serving', () => {
    const tmp = tmpDir()
    try {
      const empty = path.join(tmp, 'empty')
      fs.mkdirSync(empty)
      for (const dir of [path.join(tmp, 'missing'), empty]) {
        const result = spawnSync(process.execPath, [path.join(process.cwd(), 'dist/src/bin/corum.js'), 'web', '--plugin-dir', dir, '--port', '0'], {
          encoding: 'utf8', timeout: 20000,
        })
        assert.equal(result.status, 2, dir)
        assert.ok(result.stderr.includes('plugin.yaml'), result.stderr)
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  })
})

describe('development plugins on git sources', () => {
  it('overlays development plugins on the pinned commit with overrides, shadowing and a warning', async () => {
    const dir = tmpDir()
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
    const write = (file: string, text: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      fs.writeFileSync(path.join(dir, file), text)
    }
    const manifest = (id: string) => `id: ${id}\nversion: 1.0.0\nengines: { corum: "*" }\nmain: ./index.js\n`
    try {
      git('init', '-b', 'main')
      git('config', 'user.name', 'Fixture')
      git('config', 'user.email', 'fixture@example.com')
      write('graph/graph.yaml', 'plugins:\n  - path: ../custom\n  - { id: off, enabled: false }\n')
      write('custom/plugin.yaml', manifest('custom'))
      write('custom/index.js', 'git version')
      git('add', '-A')
      git('commit', '-qm', 'fixture')
      const devParent = path.join(dir, '..', path.basename(dir) + '-dev')
      const shadowing = writePlugin(devParent, 'shadow', 'custom')
      const disabled = writePlugin(devParent, 'off', 'off')
      const fresh = writePlugin(devParent, 'fresh', 'fresh')
      const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
      const logs: string[] = []
      const state = createGitPluginState(source, path.join(dir, 'no-builtins'), '0.1.0', message => logs.push(message), 5000, [shadowing, disabled, fresh])
      const request = await state.current()
      const byOrigin = (origin: string) => request.statuses.find(entry => entry.origin === origin && entry.id === 'custom')
      assert.equal(byOrigin('dev')?.status, 'enabled')
      assert.equal(byOrigin('standalone')?.status, 'unavailable')
      assert.ok(byOrigin('standalone')?.reason?.includes(shadowing))
      assert.equal(request.statuses.find(entry => entry.id === 'off')?.status, 'disabled')
      assert.equal(request.statuses.find(entry => entry.id === 'fresh')?.status, 'enabled')
      assert.equal(request.enabledPlugin('custom')?.origin, 'dev')
      assert.equal(request.enabledPlugin('custom')?.dir, shadowing)
      assert.ok(logs.some(message => message.includes(shadowing) && message.includes('custom')), logs.join('\n'))

      // Editing a file changes the revision after refreshDev, without re-resolving the commit.
      const before = request.statuses.find(entry => entry.id === 'fresh')?.revision
      await new Promise(resolve => setTimeout(resolve, 20))
      fs.appendFileSync(path.join(fresh, 'index.js'), '// edit\n')
      state.refreshDev()
      const after = (await state.current()).statuses.find(entry => entry.id === 'fresh')?.revision
      assert.ok(before && after && before !== after)
      fs.rmSync(devParent, { recursive: true, force: true })
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
