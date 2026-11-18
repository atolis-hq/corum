import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadGraph } from '../src/loader/index.js'
import { getNamespaces, getGraphSummary, listNodes } from '../src/graph/index.js'
import { createMcpHandlers } from '../src/mcp/index.js'
import { startWebServer, type WebServerHandle } from '../src/web/server.js'
import { FileGraphSource } from '../src/source/file-source.js'
import type { Graph } from '../src/schema/index.js'

const fixture = path.resolve('fixtures/sample-graph')

const JOURNEYS = 'kinds:\n  journey:\n    label: Customer Journey\n'
const CREATE_ORDER = 'nodes/orders/APIEndpoints/create-order.yaml'

/** orders -> journey (pack-defined), payments -> mystery (undeclared), shared -> component. */
async function loadMixed(mutate?: (content: Map<string, string>) => void): Promise<Graph> {
  const source = new FileGraphSource({ graphDir: fixture })
  const content = await source.loadGraphContent('main')
  const packs = await source.loadPackContent('main')
  content.set('nodes/orders/namespace.yaml', 'kind: journey\n')
  content.set('nodes/payments/namespace.yaml', 'kind: mystery\n')
  packs.set('journeys/kinds.yaml', JOURNEYS)
  mutate?.(content)
  return loadGraph({ strict: false, source: {
    defaultBranch: async () => 'main', listBranches: async () => ['main'],
    head: async () => 'test', log: async () => [],
    loadGraphContent: async () => content, loadPackContent: async () => packs, commit: async () => {},
  } })
}

const ns = (nodes: Array<{ id: string }>) => [...new Set(nodes.map(n => n.id.split('.')[0]))].sort()

describe('namespace from ID', () => {
  it('derives namespace from the ID even when metadata.component disagrees', async () => {
    const graph = await loadMixed(content => {
      const yaml = content.get(CREATE_ORDER)!
      assert.ok(yaml.includes('component: orders'))
      content.set(CREATE_ORDER, yaml.replace('component: orders', 'component: billing'))
    })
    const node = graph.nodesById.get('orders.APIEndpoint.create-order')!
    assert.equal(node.namespace, 'orders')
    assert.ok(listNodes(graph, { namespace: 'orders' }).some(n => n.id === node.id))
    assert.ok(listNodes(graph, { kind: 'journey' }).some(n => n.id === node.id))
    const summary = getGraphSummary(graph)
    assert.equal(summary.nodesByNamespace.billing, undefined)
    assert.equal(summary.namespaceCount, getNamespaces(graph).size)
    assert.deepEqual(Object.keys(summary.nodesByNamespace).sort(), [...getNamespaces(graph).keys()].sort())
  })
})

describe('kind filter and registry with mixed kinds', () => {
  let graph: Graph
  let handle: WebServerHandle
  before(async () => {
    graph = await loadMixed()
    handle = await startWebServer(graph, { port: 0 })
  })
  after(async () => { await handle.close() })

  it('listNodes returns exactly the nodes of the requested kind', () => {
    assert.deepEqual(ns(listNodes(graph, { kind: 'journey' })), ['orders'])
    assert.deepEqual(ns(listNodes(graph, { kind: 'mystery' })), ['payments'])
    assert.deepEqual(ns(listNodes(graph, { kind: 'component' })), ['shared'])
  })

  it('summary counts namespaces by more than one kind', () => {
    const summary = getGraphSummary(graph)
    assert.deepEqual(summary.namespacesByKind, { component: 1, journey: 1, mystery: 1 })
    assert.equal(summary.namespaceCount, 3)
  })

  it('/api/nodes filters by kind', async () => {
    const get = async (q: string) => (await (await fetch(`http://localhost:${handle.port}/api/nodes?${q}`)).json()) as Array<{ id: string; namespace: string }>
    const journey = await get('kind=journey')
    assert.ok(journey.length > 0)
    assert.deepEqual(ns(journey), ['orders'])
    assert.ok(journey.every(n => n.namespace === 'orders'))
    assert.deepEqual(ns(await get('kind=mystery')), ['payments'])
  })

  it('/api/kinds shows pack label and falls back to id for unknown kinds', async () => {
    const body = await (await fetch(`http://localhost:${handle.port}/api/kinds`)).json() as {
      kinds: Array<{ id: string; label: string }>
      namespaces: Array<{ namespace: string; kind: string; label: string }>
    }
    assert.deepEqual(body.kinds.find(k => k.id === 'journey'), { id: 'journey', label: 'Customer Journey' })
    const byName = new Map(body.namespaces.map(n => [n.namespace, n]))
    assert.equal(byName.get('orders')?.kind, 'journey')
    assert.equal(byName.get('orders')?.label, 'Customer Journey')
    assert.equal(byName.get('payments')?.kind, 'mystery')
    assert.equal(byName.get('payments')?.label, 'mystery')
    assert.equal(byName.get('shared')?.kind, 'component')
  })

  it('/api/nodes and /api/graph carry each node\'s namespace kind for UI grouping and colouring', async () => {
    const nodes = await (await fetch(`http://localhost:${handle.port}/api/nodes`)).json() as Array<{ namespace: string; kind: string }>
    const kindOf = (list: Array<{ namespace: string; kind: string }>) =>
      Object.fromEntries([...new Set(list.map(n => `${n.namespace}=${n.kind}`))].sort().map(s => s.split('=')))
    assert.deepEqual(kindOf(nodes), { orders: 'journey', payments: 'mystery' })
    const g = await (await fetch(`http://localhost:${handle.port}/api/graph`)).json() as { nodes: Array<{ namespace: string; kind: string }> }
    assert.deepEqual(kindOf(g.nodes), { orders: 'journey', payments: 'mystery' })
  })

  it('/api/stats reports mixed kinds', async () => {
    const stats = await (await fetch(`http://localhost:${handle.port}/api/stats`)).json() as { namespacesByKind: Record<string, number> }
    assert.deepEqual(stats.namespacesByKind, { component: 1, journey: 1, mystery: 1 })
  })

  it('MCP list_nodes and get_graph filter by kind', async () => {
    const handlers = createMcpHandlers(graph)
    const list = JSON.parse((await handlers.list_nodes({ filter: { kind: 'journey' }, format: 'json' })).content[0].text) as Array<{ id: string; namespace: string }>
    assert.ok(list.length > 0)
    assert.deepEqual(ns(list), ['orders'])
    const full = JSON.parse((await handlers.get_graph({ filter: { kind: 'mystery' }, format: 'json' })).content[0].text) as { nodes: Array<{ id: string }> }
    assert.ok(full.nodes.length > 0)
    assert.deepEqual(ns(full.nodes), ['payments'])
  })

  it('MCP get_graph_metadata returns kinds and namespaces', async () => {
    const handlers = createMcpHandlers(graph)
    const meta = JSON.parse((await handlers.get_graph_metadata({ format: 'json' })).content[0].text) as {
      kinds: Array<{ id: string; label: string }>
      namespaces: Array<{ namespace: string; kind: string }>
    }
    assert.deepEqual(meta.kinds.find(k => k.id === 'journey'), { id: 'journey', label: 'Customer Journey' })
    assert.deepEqual(meta.namespaces, [
      { namespace: 'orders', kind: 'journey' },
      { namespace: 'payments', kind: 'mystery' },
      { namespace: 'shared', kind: 'component' },
    ])
  })

  it('MCP get_graph_summary reports namespace counts by kind', async () => {
    const handlers = createMcpHandlers(graph)
    const out = JSON.parse((await handlers.get_graph_summary({ format: 'json' })).content[0].text) as { namespacesByKind: Record<string, number> }
    assert.deepEqual(out.namespacesByKind, { component: 1, journey: 1, mystery: 1 })
  })
})
