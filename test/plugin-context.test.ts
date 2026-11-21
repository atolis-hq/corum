import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const load = (dir: string, file: string) => import(pathToFileURL(path.join(process.cwd(), 'web', dir, file)).href)
const { createPluginContext } = await load('host', 'context.js')
const { createRegistry } = await load('sdk', 'registry.js')
const { hrefForNode, hrefForAction, owningRoot } = await load('sdk', 'resolve-node.js')
const { matchKeysFor } = await load('sdk', 'match-keys.js')

function route(search = '', branch: string | null = null) {
  return { branch, pathname: '/p/demo/home', params: new URLSearchParams(search), plugin: { id: 'demo', page: 'home' } }
}

function setup(overrides: Record<string, unknown> = {}) {
  const calls: { navigated: string[]; fetched: string[] } = { navigated: [], fetched: [] }
  const registry = createRegistry()
  const env = {
    registry,
    hrefForNode,
    hrefForAction,
    owningRoot,
    matchKeysFor,
    navigate: (hash: string) => { calls.navigated.push(hash) },
    buildRoute: ({ pathname, params, branch }: { pathname: string; params?: Record<string, string>; branch?: string | null }) => {
      const qs = new URLSearchParams(params ?? {}).toString()
      return `#${branch ? `/${branch}` : ''}${pathname}${qs ? `?${qs}` : ''}`
    },
    fetchImpl: async (url: string) => {
      calls.fetched.push(url)
      return { ok: true, status: 200, json: async () => ({ url }) }
    },
    pluginId: 'demo',
    pageId: 'home',
    ...overrides,
  }
  const state = {
    route: route('a=1'),
    viewingRef: null as string | null,
    templates: [],
    nodes: [{ id: 'orders.DomainModel.order', template: 'DomainModel' }, { id: 'orders.DomainModel.order.fields.id', template: 'Field', parentId: 'orders.DomainModel.order' }],
    templatesByName: new Map(),
  }
  const handle = createPluginContext(env, state, () => {})
  return { ...handle, calls, registry, state }
}

describe('createPluginContext', () => {
  it('exposes route, params, branch, viewingRef and templates live', () => {
    const { ctx, update, state } = setup()
    assert.equal(ctx.params.get('a'), '1')
    assert.equal(ctx.viewingRef, null)
    const next = route('a=2', 'main')
    update({ ...state, route: next, viewingRef: 'main' })
    assert.equal(ctx.route, next)
    assert.equal(ctx.params.get('a'), '2')
    assert.equal(ctx.branch, 'main')
    assert.equal(ctx.viewingRef, 'main')
  })

  it('subscribe fires on route/viewingRef/templates change only, and unsubscribes', () => {
    const { ctx, update, state } = setup()
    let fired = 0
    const off = ctx.subscribe(() => { fired += 1 })
    update({ ...state })
    assert.equal(fired, 0)
    update({ ...state, route: route('a=2') })
    update({ ...state, viewingRef: 'x' })
    update({ ...state, templates: [] })
    assert.equal(fired, 3)
    off()
    update({ ...state, route: route('a=3') })
    assert.equal(fired, 3)
  })

  it('exposes the data revision live and notifies subscribers when it changes', () => {
    const { ctx, update, state } = setup()
    assert.equal(ctx.revision, 0)
    let fired = 0
    ctx.subscribe(() => { fired += 1 })
    update({ ...state, revision: 1 })
    assert.equal(ctx.revision, 1)
    assert.equal(fired, 1)
    update({ ...state, revision: 1 })
    assert.equal(fired, 1)
  })

  it('api.get applies the viewing ref, accepts object/array params and throws on non-2xx', async () => {
    const { ctx, update, state, calls } = setup()
    await ctx.api.get('/api/graph')
    update({ ...state, viewingRef: 'feature/x' })
    await ctx.api.get('/api/lineage', { depth: '2' })
    await ctx.api.get('/api/lineage', [['node_ids', 'a'], ['node_ids', 'b']])
    assert.deepEqual(calls.fetched, [
      '/api/graph',
      '/api/lineage?depth=2&ref=feature%2Fx',
      '/api/lineage?node_ids=a&node_ids=b&ref=feature%2Fx',
    ])
    const failing = setup({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) })
    await assert.rejects(() => failing.ctx.api.get('/api/graph'), /500/)
  })

  it('navigate, hrefForNode and openNode go through the host', () => {
    const { ctx, update, state, calls } = setup()
    ctx.navigate('#/dashboard')
    assert.deepEqual(calls.navigated, ['#/dashboard'])
    assert.equal(ctx.hrefForNode('orders.DomainModel.order'), '#/node?id=orders.DomainModel.order')
    update({ ...state, viewingRef: 'main' })
    assert.equal(ctx.hrefForNode('orders.DomainModel.order'), '#/main/node?id=orders.DomainModel.order')
    ctx.openNode('orders.DomainModel.order')
    assert.equal(calls.navigated[1], '#/main/node?id=orders.DomainModel.order')
  })

  it('hrefForNode resolves a child node through its root and a plugin claim', () => {
    const { ctx, registry } = setup()
    registry.registerPlugin({
      id: 'claimer', status: 'enabled', load: async () => ({}),
      manifest: { contributes: { pages: [{ id: 'home', title: 'C', mount: 'm', opens: ['DomainModel'] }] } },
    })
    assert.equal(ctx.hrefForNode('orders.DomainModel.order.fields.id'), '#/p/claimer/home?id=orders.DomainModel.order.fields.id')
  })

  it('hrefForPage builds a link to the current page with new params', () => {
    const { ctx, update, state } = setup()
    assert.equal(ctx.hrefForPage({ focus: 'x' }), '#/p/demo/home?focus=x')
    update({ ...state, viewingRef: 'main' })
    assert.equal(ctx.hrefForPage({}), '#/main/p/demo/home')
  })
})

describe('ctx.nodeLinks', () => {
  const claimer = (id: string, opens: string[], extra: Record<string, unknown> = {}, actions: unknown[] = []) => ({
    id, status: 'enabled', load: async () => ({}),
    manifest: { contributes: { pages: [{ id: 'home', title: `Page ${id}`, icon: 'star', mount: 'm', opens }], nodeActions: actions, ...extra } },
  })
  const action = (over: Record<string, unknown>) => ({ id: 'act', label: 'Act', appliesTo: ['DomainModel'], page: 'home', ...over })

  it('is empty when nothing claims or acts on the node', () => {
    const { ctx } = setup()
    assert.deepEqual(ctx.nodeLinks('orders.DomainModel.order'), {
      quick: { header: [], relations: [] },
      menu: { defaultHref: null, destinations: [], actions: [] },
    })
    assert.deepEqual(ctx.nodeLinks('unknown.node').menu.actions, [])
  })

  it('lists claimant destinations with a default view, and actions in menu and quick surfaces', () => {
    const { ctx, registry, update, state } = setup()
    registry.registerPlugin(claimer('a', ['DomainModel'], {}, [action({ id: 'view', label: 'View', icon: 'eye', quick: ['header'] })]))
    const links = ctx.nodeLinks('orders.DomainModel.order')
    assert.equal(links.menu.defaultHref, '#/node?id=orders.DomainModel.order')
    assert.deepEqual(links.menu.destinations, [
      { key: 'a/home', pluginId: 'a', id: 'home', label: 'Page a', icon: 'star', href: '#/p/a/home?id=orders.DomainModel.order' },
    ])
    const expected = { key: 'a/view', pluginId: 'a', id: 'view', label: 'View', icon: 'eye', href: '#/p/a/home?id=orders.DomainModel.order' }
    assert.deepEqual(links.menu.actions, [expected])
    assert.deepEqual(links.quick, { header: [expected], relations: [] })
    update({ ...state, viewingRef: 'feat/x' })
    const branched = ctx.nodeLinks('orders.DomainModel.order')
    assert.equal(branched.menu.defaultHref, '#/feat/x/node?id=orders.DomainModel.order')
    assert.equal(branched.menu.actions[0].href, '#/feat%2Fx/p/a/home?id=orders.DomainModel.order')
  })

  it('supports the * wildcard, a custom param and icon null', () => {
    const { ctx, registry } = setup()
    registry.registerPlugin(claimer('w', [], {}, [action({ appliesTo: ['*'], param: 'focus', quick: ['relations'] })]))
    const links = ctx.nodeLinks('orders.DomainModel.order')
    assert.equal(links.menu.defaultHref, null)
    assert.deepEqual(links.menu.destinations, [])
    assert.equal(links.menu.actions[0].href, '#/p/w/home?focus=orders.DomainModel.order')
    assert.equal(links.menu.actions[0].icon, null)
    assert.equal(links.quick.relations.length, 1)
    assert.equal(links.quick.header.length, 0)
  })

  it('resolves a child through its owning root but keeps the child id in hrefs', () => {
    const { ctx, registry } = setup()
    registry.registerPlugin(claimer('a', ['DomainModel'], {}, [action({ quick: ['header'] })]))
    const child = 'orders.DomainModel.order.fields.id'
    const links = ctx.nodeLinks(child)
    assert.equal(links.menu.defaultHref, `#/node?id=${child}`)
    assert.equal(links.menu.destinations[0].href, `#/p/a/home?id=${child}`)
    assert.equal(links.quick.header[0].href, `#/p/a/home?id=${child}`)
  })

  it('keeps menu:false actions in quick but out of the menu', () => {
    const { ctx, registry } = setup()
    registry.registerPlugin(claimer('a', [], {}, [action({ menu: false, quick: ['header'] }), action({ id: 'other', label: 'Other' })]))
    const links = ctx.nodeLinks('orders.DomainModel.order')
    assert.deepEqual(links.quick.header.map((link: { id: string }) => link.id), ['act'])
    assert.deepEqual(links.menu.actions.map((link: { id: string }) => link.id), ['other'])
  })
})
