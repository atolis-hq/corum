import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePluginStatuses } from '../src/web/plugins/status.js'
import { createPluginRuntime } from '../src/web/plugins/runtime.js'
import type { DiscoveredPlugin } from '../src/web/plugins/discover.js'
import type { PluginManifest } from '../src/web/plugins/manifest.js'
import type { Graph } from '../src/schema/index.js'

function plugin(id: string, opts: { corum?: string; templates?: string[] } = {}): DiscoveredPlugin {
  const manifest: PluginManifest = {
    id,
    version: '1.0.0',
    engines: { corum: opts.corum ?? '*' },
    requires: { templates: opts.templates ?? [] },
    main: './index.js',
    contributes: { pages: [], nodeActions: [] },
  }
  return { manifest, dir: `/x/${id}`, origin: 'builtin' }
}

const ctx = { graphTemplates: new Set(['Journey']), corumVersion: '0.5.0', overrides: [] as { id: string; enabled: boolean }[] }

describe('resolvePluginStatuses', () => {
  it('marks a satisfied plugin enabled', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: '>=0.4', templates: ['Journey'] })], ctx)
    assert.equal(status.status, 'enabled')
    assert.equal(status.reason, undefined)
    assert.equal(status.origin, 'builtin')
    assert.equal(status.version, '1.0.0')
    assert.equal(status.manifest.id, 'a')
  })

  it('override disabled wins over everything', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: '>=99' })], { ...ctx, overrides: [{ id: 'a', enabled: false }] })
    assert.equal(status.status, 'disabled')
  })

  it('an explicit enabled override does not bypass availability checks', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: '>=99' })], { ...ctx, overrides: [{ id: 'a', enabled: true }] })
    assert.equal(status.status, 'unavailable')
  })

  it('engines mismatch is unavailable with a reason', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: '>=99' })], ctx)
    assert.equal(status.status, 'unavailable')
    assert.match(status.reason ?? '', />=99/)
    assert.match(status.reason ?? '', /0\.5\.0/)
  })

  it('is prerelease inclusive', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: '>=0.4' })], { ...ctx, corumVersion: '0.5.0-beta.1' })
    assert.equal(status.status, 'enabled')
  })

  it('prerelease versions follow semver range semantics', () => {
    const status = (range: string, version: string) =>
      resolvePluginStatuses([plugin('a', { corum: range })], { ...ctx, corumVersion: version })[0].status
    assert.equal(status('>=0.5.0', '0.5.0-beta.1'), 'unavailable')
    assert.equal(status('>=0.4', '0.6.0-rc.1'), 'enabled')
    assert.equal(status('>=0.4 <0.5.0', '0.5.0-beta.1'), 'enabled')
    assert.equal(status('>=0.4 <0.5.0', '0.5.0'), 'unavailable')
    assert.equal(status('>=0.5.0-beta.1', '0.5.0-beta.2'), 'enabled')
    assert.equal(status('^0.5.0', '0.5.0-alpha.1'), 'unavailable')
  })

  it('an invalid engines range is unavailable', () => {
    const [status] = resolvePluginStatuses([plugin('a', { corum: 'not a range' })], ctx)
    assert.equal(status.status, 'unavailable')
  })

  it('missing templates are named in the reason', () => {
    const [status] = resolvePluginStatuses([plugin('a', { templates: ['Journey', 'JourneyStep', 'Other'] })], ctx)
    assert.equal(status.status, 'unavailable')
    assert.match(status.reason ?? '', /JourneyStep/)
    assert.match(status.reason ?? '', /Other/)
    assert.doesNotMatch(status.reason ?? '', /Journey,/)
  })
})

describe('createPluginRuntime', () => {
  let tmp: string
  let saved: string | undefined

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-runtime-'))
    saved = process.env.CORUM_BUILTIN_PLUGIN_DIRS
    process.env.CORUM_BUILTIN_PLUGIN_DIRS = path.join(tmp, 'builtin')
    const dir = path.join(tmp, 'builtin', 'needs-journey')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'plugin.yaml'),
      'id: needs-journey\nversion: 1.0.0\nengines: { corum: "*" }\nrequires: { templates: [Journey] }\nmain: ./index.js\n',
    )
  })

  afterEach(() => {
    if (saved === undefined) delete process.env.CORUM_BUILTIN_PLUGIN_DIRS
    else process.env.CORUM_BUILTIN_PLUGIN_DIRS = saved
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('recomputes statuses on refresh and tracks plugin dirs without exposing them', () => {
    const graph = { templates: new Map() } as unknown as Graph
    const runtime = createPluginRuntime({ graph, graphDir: null, builtinDir: path.join(tmp, 'none'), corumVersion: '1.0.0' })
    assert.equal(runtime.statuses()[0].status, 'unavailable')
    assert.equal(runtime.enabledDir('needs-journey'), null)

    graph.templates.set('Journey', {} as never)
    runtime.refresh()
    assert.equal(runtime.statuses()[0].status, 'enabled')
    assert.equal(runtime.enabledDir('needs-journey'), path.join(tmp, 'builtin', 'needs-journey'))
    assert.ok(!JSON.stringify(runtime.statuses()).includes(path.basename(tmp)))
  })

  it('applies graph.yaml overrides', () => {
    const graphDir = path.join(tmp, 'g')
    fs.mkdirSync(graphDir)
    fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'plugins:\n  - id: needs-journey\n    enabled: false\n')
    const graph = { templates: new Map([['Journey', {}]]) } as unknown as Graph
    const runtime = createPluginRuntime({ graph, graphDir, builtinDir: path.join(tmp, 'none'), corumVersion: '1.0.0' })
    assert.equal(runtime.statuses()[0].status, 'disabled')
    assert.equal(runtime.enabledDir('needs-journey'), null)
  })
})
