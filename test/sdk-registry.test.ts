import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const sdkDir = path.join(process.cwd(), 'web', 'sdk')
const load = (file: string) => import(pathToFileURL(path.join(sdkDir, file)).href)

type Page = { id: string; title: string; icon?: string; order?: number; mount: string; opens?: string[] }
type Action = { id: string; label: string; appliesTo: string[]; page: string }

const { createRegistry } = await load('registry.js')
const { resolveNodeTarget, hrefForNode } = await load('resolve-node.js')

function plugin(
  id: string,
  pages: Page[],
  opts: { status?: string; actions?: Action[]; mod?: Record<string, unknown>; onLoad?: () => void } = {},
) {
  return {
    id,
    status: opts.status ?? 'enabled',
    manifest: { id, contributes: { pages, nodeActions: opts.actions ?? [] } },
    load: async () => {
      opts.onLoad?.()
      return opts.mod ?? {}
    },
  }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 5))

describe('registry', () => {
  it('disabled and unavailable plugins contribute nothing', () => {
    const reg = createRegistry()
    const page: Page = { id: 'map', title: 'Map', mount: 'mountMap', opens: ['Journey'] }
    const action: Action = { id: 'a', label: 'A', appliesTo: ['Journey'], page: 'map' }
    reg.registerPlugin(plugin('off', [page], { status: 'disabled', actions: [action] }))
    reg.registerPlugin(plugin('bad', [page], { status: 'unavailable', actions: [action] }))
    assert.equal(reg.plugins().length, 2)
    assert.deepEqual(reg.pages(), [])
    assert.deepEqual(reg.claimants(['Journey']), [])
    assert.deepEqual(reg.nodeActionsFor(['Journey']), [])
    assert.equal(reg.findPage('off', 'map'), null)
  })

  it('pages() sorts by order then title', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('a', [
      { id: 'z', title: 'Zeta', order: 20, mount: 'm' },
      { id: 'b', title: 'Beta', order: 10, mount: 'm' },
      { id: 'a', title: 'Alpha', order: 10, mount: 'm' },
    ]))
    assert.deepEqual(reg.pages().map((p: Page) => p.id), ['a', 'b', 'z'])
  })

  it('claimants() returns only matching enabled pages', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('j', [
      { id: 'map', title: 'Map', mount: 'm', opens: ['Journey'] },
      { id: 'other', title: 'Other', mount: 'm', opens: ['Order'] },
      { id: 'none', title: 'None', mount: 'm' },
    ]))
    const found = reg.claimants(['Journey'])
    assert.deepEqual(found.map((p: { pluginId: string; id: string }) => `${p.pluginId}/${p.id}`), ['j/map'])
    assert.equal(reg.claimants(['Journey', 'Order']).length, 2)
    assert.deepEqual(reg.claimants([]), [])
  })

  it('nodeActionsFor filters by appliesTo', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('j', [{ id: 'map', title: 'Map', mount: 'm' }], {
      actions: [
        { id: 'open', label: 'Open', appliesTo: ['Journey'], page: 'map' },
        { id: 'x', label: 'X', appliesTo: ['Order'], page: 'map' },
      ],
    }))
    const actions = reg.nodeActionsFor(['Journey'])
    assert.deepEqual(actions.map((a: Action) => a.id), ['open'])
    assert.equal(actions[0].pluginId, 'j')
  })

  it('page mount lazily loads the module and calls the named export', async () => {
    let loads = 0
    const calls: unknown[] = []
    const reg = createRegistry()
    reg.registerPlugin(plugin('j', [{ id: 'map', title: 'Map', mount: 'mountMap' }], {
      onLoad: () => { loads++ },
      mod: { mountMap: (el: unknown, ctx: unknown) => { calls.push([el, ctx]); return () => calls.push('unmounted') } },
    }))
    assert.equal(loads, 0)
    const unmount = reg.findPage('j', 'map').mount('EL', 'CTX')
    await tick()
    assert.equal(loads, 1)
    assert.deepEqual(calls, [['EL', 'CTX']])
    unmount()
    assert.equal(calls[1], 'unmounted')
  })

  it('unmount before the module resolves skips mounting', async () => {
    const calls: unknown[] = []
    const reg = createRegistry()
    reg.registerPlugin(plugin('j', [{ id: 'map', title: 'Map', mount: 'mountMap' }], {
      mod: { mountMap: () => { calls.push('mounted') } },
    }))
    reg.findPage('j', 'map').mount('EL', {})()
    await tick()
    assert.deepEqual(calls, [])
  })

  it('a failing load is reported to ctx.onError and does not throw', async () => {
    const errors: unknown[] = []
    const reg = createRegistry()
    reg.registerPlugin({
      id: 'j',
      status: 'enabled',
      manifest: { id: 'j', contributes: { pages: [{ id: 'map', title: 'Map', mount: 'm' }], nodeActions: [] } },
      load: async () => { throw new Error('boom') },
    })
    reg.findPage('j', 'map').mount('EL', { onError: (e: Error) => errors.push(e.message) })
    await tick()
    assert.deepEqual(errors, ['boom'])
  })
})

describe('resolveNodeTarget / hrefForNode', () => {
  const page = (id: string, opens: string[]): Page => ({ id, title: id, mount: 'm', opens })

  it('generic when no claimant', () => {
    const reg = createRegistry()
    assert.deepEqual(resolveNodeTarget(reg, ['Journey']), { kind: 'generic' })
  })

  it('page for exactly one claimant', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('journeys', [page('map', ['Journey'])]))
    assert.deepEqual(resolveNodeTarget(reg, ['Journey']), { kind: 'page', pluginId: 'journeys', pageId: 'map' })
  })

  it('chooser for two claimants', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('a', [page('one', ['Journey'])]))
    reg.registerPlugin(plugin('b', [page('two', ['Journey'])]))
    const target = resolveNodeTarget(reg, ['Journey'])
    assert.equal(target.kind, 'chooser')
    assert.equal(target.claimants.length, 2)
  })

  it('via picks the named plugin; missing or disabled via falls back to generic', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('a', [page('one', ['Journey'])]))
    reg.registerPlugin(plugin('b', [page('two', ['Journey'])]))
    reg.registerPlugin(plugin('off', [page('three', ['Journey'])], { status: 'disabled' }))
    assert.deepEqual(resolveNodeTarget(reg, ['Journey'], { via: 'b' }), { kind: 'page', pluginId: 'b', pageId: 'two' })
    assert.deepEqual(resolveNodeTarget(reg, ['Journey'], { via: 'nope' }), { kind: 'generic' })
    assert.deepEqual(resolveNodeTarget(reg, ['Journey'], { via: 'off' }), { kind: 'generic' })
  })

  it('hrefForNode builds generic, page and branch hrefs', () => {
    const reg = createRegistry()
    assert.equal(hrefForNode(reg, 'a.b', ['Journey'], {}), '#/node?id=a.b')
    reg.registerPlugin(plugin('journeys', [page('map', ['Journey'])]))
    assert.equal(hrefForNode(reg, 'a.b', ['Journey'], {}), '#/p/journeys/map?id=a.b')
    assert.equal(hrefForNode(reg, 'a.b', ['Journey'], { branch: 'main' }), '#/main/p/journeys/map?id=a.b')
    assert.equal(hrefForNode(reg, 'a.b', ['Order'], { branch: 'main' }), '#/main/node?id=a.b')
    assert.equal(hrefForNode(reg, 'a.b', ['Journey'], { via: 'missing' }), '#/node?id=a.b')
  })

  it('hrefForNode uses the generic node page when a chooser is needed', () => {
    const reg = createRegistry()
    reg.registerPlugin(plugin('a', [page('one', ['Journey'])]))
    reg.registerPlugin(plugin('b', [page('two', ['Journey'])]))
    assert.equal(hrefForNode(reg, 'a.b', ['Journey'], {}), '#/node?id=a.b')
  })
})
