import { it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { GitGraphSource } from '../src/source/git-source.js'
import { loadGraph } from '../src/loader/index.js'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import { createGitPluginState, gitPluginRequest } from '../src/web/plugins/git-runtime.js'
import type { PluginStatus } from '../src/web/plugins/status.js'

it('serves Git plugins from a pinned default commit with secure assets and current declarations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-plugins-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const manifest = (id: string, templates: string[] = []) => JSON.stringify({
    id, version: '1.0.0', engines: { corum: '*' }, main: './index.js',
    requires: { templates }, contributes: { pages: [], nodeActions: [], themes: [], layouts: [] },
  })
  const commit = () => { git('add', '-A'); git('commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD') }
  let server: WebServerHandle | undefined
  const messages: string[] = []
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    write('graph/graph.yaml', JSON.stringify({
      templatePacks: [{ path: '../pack' }],
      plugins: [{ path: '../custom' }, { path: '../missing' }, { id: 'disabled', enabled: false }],
    }))
    write('pack/pack.yaml', 'name: fixture\nversion: 1.0.0\nplugins: [ui, absent, disabled]\n')
    write('pack/templates/Thing.yaml', 'name: Thing\ninfo: { version: "1", core: false }\n')
    write('pack/ui/plugin.yaml', manifest('packed', ['Thing']))
    write('pack/ui/index.js', 'export const packed = true')
    write('pack/disabled/plugin.yaml', manifest('disabled'))
    write('pack/disabled/index.js', 'disabled')
    write('custom/plugin.yaml', manifest('custom'))
    write('custom/index.js', 'export const value = 1')
    write('custom/secret.yml', 'secret')
    write('outside.js', 'outside')
    fs.symlinkSync('../outside.js', path.join(dir, 'custom/link.js'))
    fs.symlinkSync('../pack', path.join(dir, 'custom/linkdir'))
    const first = commit()
    git('checkout', '-qb', 'feature')
    write('graph/graph.yaml', 'plugins: []\n')
    write('custom/index.js', 'feature')
    commit()
    const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
    // Even an app rendering a branch graph must evaluate plugins against main.
    const graph = await loadGraph({ source, ref: 'feature' })
    graph.templates.clear()
    server = await startWebServer(graph, {
      port: 0, host: '127.0.0.1', source, gitPollSeconds: 0.02,
      logger: message => messages.push(message),
    })
    const base = `http://127.0.0.1:${server.port}`
    // Let the poller establish its initial signature before advancing main.
    await new Promise(resolve => setTimeout(resolve, 100))
    const statuses = async () => await (await fetch(base + '/api/plugins?branch=feature&overlay=true')).json() as PluginStatus[]
    const entries = await statuses()
    assert.equal(entries.find(entry => entry.id === 'packed')?.status, 'enabled')
    for (const declared of ['../missing', 'absent']) {
      const missing = entries.find(entry => entry.id === declared)
      assert.equal(missing?.status, 'unavailable')
      assert.equal(missing?.name, declared)
      assert.ok(missing?.reason?.includes(declared))
      assert.ok(missing?.reason?.includes(first.slice(0, 7)))
    }
    const asset = await fetch(base + '/plugins/custom/index.js')
    assert.equal(asset.status, 200)
    assert.equal(await asset.text(), 'export const value = 1')
    assert.equal(asset.headers.get('cache-control'), 'no-cache')
    assert.equal(asset.headers.get('x-content-type-options'), 'nosniff')
    const etag = asset.headers.get('etag')!
    assert.equal((await fetch(base + '/plugins/custom/index.js', { headers: { 'If-None-Match': 'W/' + etag } })).status, 304)
    for (const file of ['plugin.yaml', 'secret.yml', 'link.js', 'linkdir/ui/index.js', '%252e%252e/outside.js', 'index.js%00.png', 'missing.js']) {
      assert.equal((await fetch(base + '/plugins/custom/' + file)).status, 404, file)
    }
    assert.equal((await fetch(base + '/plugins/disabled/index.js')).status, 404)
    assert.equal((await fetch(base + '/plugins/packed/index.js')).status, 200)
    const pinned = await gitPluginRequest(source, path.join(dir, 'no-builtins'), '0.1.0')
    const plugin = pinned.enabledPlugin('custom')!
    for (const file of ['../outside.js', '%2e%2e/outside.js', '..\\outside.js', '/outside.js']) {
      assert.equal(await pinned.asset(plugin, file), null, file)
    }
    git('checkout', 'main')
    write('custom/index.js', 'export const value = 2')
    write('missing/plugin.yaml', manifest('restored'))
    write('missing/index.js', 'restored')
    fs.rmSync(path.join(dir, 'pack/ui/plugin.yaml'))
    commit()
    // A request already in flight continues to use the old commit after the ref moves.
    assert.equal((await pinned.asset(plugin, 'index.js'))?.bytes.toString(), 'export const value = 1')
    const deadline = Date.now() + 5000
    while (!messages.some(message => message.includes('graph reloaded after git poll')) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(messages.some(message => message.includes('graph reloaded after git poll')), messages.join('\n'))
    const changed = await fetch(base + '/plugins/custom/index.js', { headers: { 'If-None-Match': etag } })
    assert.equal(changed.status, 200)
    assert.notEqual(changed.headers.get('etag'), etag)
    assert.equal(await changed.text(), 'export const value = 2')
    const next = await statuses()
    assert.ok(next.some(entry => entry.id === 'restored' && entry.status === 'enabled'))
    assert.ok(!next.some(entry => entry.id === '../missing'))
    assert.ok(next.some(entry => entry.id === 'ui' && entry.status === 'unavailable'))
    assert.equal((await fetch(base + '/plugins/packed/index.js')).status, 404)
  } finally {
    await server?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('keeps built-ins working and shares state per commit when the default branch graph is broken', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-plugins-broken-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const manifest = (id: string, templates: string[] = []) => JSON.stringify({
    id, version: '1.0.0', engines: { corum: '*' }, main: './index.js',
    requires: { templates }, contributes: { pages: [], nodeActions: [], themes: [], layouts: [] },
  })
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    write('graph/graph.yaml', JSON.stringify({
      templatePacks: [{ path: '../pack' }],
      plugins: [{ path: '../plain' }, { path: '../needy' }],
    }))
    write('pack/pack.yaml', 'name: fixture\nversion: 1.0.0\n')
    write('pack/templates/Thing.yaml', 'name: Thing\ninfo: { version: "1", core: false }\n')
    write('plain/plugin.yaml', manifest('plain'))
    write('needy/plugin.yaml', manifest('needy', ['Thing']))
    write('graph/nodes/bad.yaml', 'not: a cluster\n')
    write('builtins/core/plugin.yaml', manifest('core'))
    write('builtins/core/index.js', 'core')
    git('add', '-A')
    git('commit', '-qm', 'broken')
    const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
    const builtins = path.join(dir, 'builtins')
    const request = await gitPluginRequest(source, builtins, '0.1.0')
    const status = (id: string) => request.statuses.find(entry => entry.id === id)?.status
    assert.equal(status('core'), 'enabled')
    assert.equal(status('plain'), 'enabled')
    // Templates still load from the broken commit, so template checks still work.
    assert.equal(status('needy'), 'enabled')
    await assert.rejects(loadGraph({ source }), 'fixture must be a strict-load failure')
    // The holder resolves the commit once, then serves every request from it.
    let snapshots = 0
    const original = source.pluginSnapshot.bind(source)
    source.pluginSnapshot = async () => { snapshots++; return original() }
    const logs: string[] = []
    const state = createGitPluginState(source, builtins, '0.1.0', message => logs.push(message))
    const first = await state.current()
    for (let index = 0; index < 5; index++) assert.equal(await state.current(), first)
    assert.equal(snapshots, 1)
    assert.equal(first.statuses.find(entry => entry.id === 'core')?.status, 'enabled')
    state.install(await state.prepare())
    assert.equal(snapshots, 2)
    assert.notEqual(await state.current(), first)
    assert.equal(snapshots, 2)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('logs plugin errors once per commit and falls back to built-ins when the source is unreachable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-plugins-logs-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    write('graph/graph.yaml', JSON.stringify({ plugins: [{ path: '../bad' }] }))
    write('bad/plugin.yaml', 'not: [valid')
    write('builtins/core/plugin.yaml', JSON.stringify({
      id: 'core', version: '1.0.0', engines: { corum: '*' }, main: './index.js',
      requires: { templates: [] }, contributes: { pages: [], nodeActions: [], themes: [], layouts: [] },
    }))
    git('add', '-A')
    git('commit', '-qm', 'fixture')
    const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
    const logs: string[] = []
    const state = createGitPluginState(source, path.join(dir, 'builtins'), '0.1.0', message => logs.push(message))
    await state.current()
    state.install(await state.prepare())
    state.install(await state.prepare())
    assert.equal(logs.filter(message => message.includes('bad')).length, 1, logs.join('\n'))
    const broken = new GitGraphSource({ localPath: path.join(dir, 'nowhere'), graphDir: 'graph', defaultBranch: 'main' })
    const fallbackLogs: string[] = []
    const fallback = await createGitPluginState(broken, path.join(dir, 'builtins'), '0.1.0', message => fallbackLogs.push(message)).current()
    assert.equal(fallback.statuses.find(entry => entry.id === 'core')?.status, 'enabled')
    assert.ok(fallbackLogs.some(message => message.includes('built-ins only')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('recovers from a failed first build and retries a failed poll reload without a new commit', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-plugins-retry-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const manifest = (id: string) => JSON.stringify({
    id, version: '1.0.0', engines: { corum: '*' }, main: './index.js',
    requires: { templates: [] }, contributes: { pages: [], nodeActions: [], themes: [], layouts: [] },
  })
  let server: WebServerHandle | undefined
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    write('graph/graph.yaml', JSON.stringify({ plugins: [{ path: '../one' }] }))
    write('one/plugin.yaml', manifest('one'))
    write('one/index.js', 'one')
    git('add', '-A')
    git('commit', '-qm', 'one')
    const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
    const original = source.pluginSnapshot.bind(source)

    // A failed first build serves built-ins, then recovers on a later call.
    let failures = 1
    source.pluginSnapshot = async () => { if (failures-- > 0) throw new Error('remote down'); return original() }
    const state = createGitPluginState(source, path.join(dir, 'no-builtins'), '0.1.0', () => {}, 0)
    assert.equal((await state.current()).statuses.some(entry => entry.id === 'one'), false)
    assert.equal((await state.current()).statuses.find(entry => entry.id === 'one')?.status, 'enabled')
    await assert.rejects((async () => { failures = 1; await state.prepare() })())

    // A plugin refresh failing during a poll reload fails that reload; the poller retries.
    failures = 0
    const messages: string[] = []
    server = await startWebServer(await loadGraph({ source }), {
      port: 0, host: '127.0.0.1', source, gitPollSeconds: 0.02, logger: message => messages.push(message),
    })
    const base = `http://127.0.0.1:${server.port}`
    const ids = async () => (await (await fetch(base + '/api/plugins')).json() as PluginStatus[]).map(entry => entry.id)
    assert.ok((await ids()).includes('one'))
    write('two/plugin.yaml', manifest('two'))
    write('two/index.js', 'two')
    write('graph/graph.yaml', JSON.stringify({ plugins: [{ path: '../one' }, { path: '../two' }] }))
    failures = 1
    git('add', '-A')
    git('commit', '-qm', 'two')
    const deadline = Date.now() + 5000
    while (!(await ids()).includes('two') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 30))
    assert.ok((await ids()).includes('two'), messages.join('\n'))
    assert.equal((await fetch(base + '/plugins/two/index.js')).status, 200)
  } finally {
    await server?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

it('keeps missing declaration paths separate from manifest IDs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-plugins-collide-'))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim()
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
    fs.writeFileSync(path.join(dir, file), text)
  }
  const manifest = (id: string) => JSON.stringify({
    id, version: '1.0.0', engines: { corum: '*' }, main: './index.js',
    requires: { templates: [] }, contributes: { pages: [], nodeActions: [], themes: [], layouts: [] },
  })
  try {
    git('init', '-b', 'main')
    git('config', 'user.name', 'Fixture')
    git('config', 'user.email', 'fixture@example.com')
    // Pack declares missing "ui" while a standalone plugin has manifest ID "ui";
    // a standalone plugin "real" precedes a missing declared path "real".
    write('graph/graph.yaml', JSON.stringify({
      templatePacks: [{ path: '../pack' }],
      plugins: [{ path: '../standalone' }, { path: '../real-dir' }, { path: 'real' }],
    }))
    write('pack/pack.yaml', 'name: fixture\nversion: 1.0.0\nplugins: [ui]\n')
    write('standalone/plugin.yaml', manifest('ui'))
    write('standalone/index.js', 'ui')
    write('real-dir/plugin.yaml', manifest('real'))
    write('real-dir/index.js', 'real')
    git('add', '-A')
    git('commit', '-qm', 'fixture')
    const source = new GitGraphSource({ localPath: dir, graphDir: 'graph', defaultBranch: 'main' })
    const request = await gitPluginRequest(source, path.join(dir, 'no-builtins'), '0.1.0')
    const byId = (id: string) => request.statuses.filter(entry => entry.id === id).map(entry => entry.status).sort()
    assert.deepEqual(byId('ui'), ['enabled', 'unavailable'])
    assert.deepEqual(byId('real'), ['enabled', 'unavailable'])
    assert.ok(request.enabledPlugin('ui'))
    assert.ok(request.enabledPlugin('real'))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
