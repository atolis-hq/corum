import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listNodes, getCluster, getLinkedFields, getGraphSummary, searchNodes, getLineage } from '../src/graph/index.js'
import { loadGraph } from '../src/loader/index.js'
import { QueryError } from '../src/schema/index.js'
import type { Edge, Graph, Node } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

function createNode(id: string): Node {
  return {
    id,
    template: 'DomainEvent',
    component: 'orders',
    state: 'agreed',
    stability: 'stable',
    schemaVersion: '1.0.0',
    lastModifiedAt: '2026-07-01T00:00:00Z',
    properties: {},
  }
}

function createEdge(id: string, from: string, to: string): Edge {
  return {
    id,
    from,
    to,
    type: 'produces',
    state: 'agreed',
    stability: 'stable',
  }
}

function createMergedLineageGraph(): Graph {
  const startA = createNode('orders.DomainModel.order.operations.place')
  const startB = createNode('orders.DomainModel.order.operations.complete')
  const shared = createNode('orders.DomainEvent.order-published')
  const nodes = [startA, startB, shared]
  const edges = [
    createEdge('edge-place-published', startA.id, shared.id),
    createEdge('edge-complete-published', startB.id, shared.id),
  ]

  return {
    nodesById: new Map(nodes.map(node => [node.id, node])),
    edgesByFrom: new Map([
      [startA.id, [edges[0]]],
      [startB.id, [edges[1]]],
    ]),
    edgesByTo: new Map([
      [shared.id, edges],
    ]),
    templates: new Map(),
    diagnostics: [],
  }
}

function createUsesTypeGraph(): Graph {
  const consumer = createNode('orders.APIEndpoint.create-order')
  const sharedType = createNode('orders.Schema.shared-type')
  const edge: Edge = {
    id: 'orders.APIEndpoint.create-order__uses-type__orders.Schema.shared-type',
    from: consumer.id,
    to: sharedType.id,
    type: 'uses-type',
    state: 'agreed',
    stability: 'stable',
    generated: true,
  }

  return {
    nodesById: new Map([[consumer.id, consumer], [sharedType.id, sharedType]]),
    edgesByFrom: new Map([[consumer.id, [edge]]]),
    edgesByTo: new Map([[sharedType.id, [edge]]]),
    templates: new Map(),
    diagnostics: [],
  }
}

describe('graph queries', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  describe('listNodes', () => {
    it('returns all 151 nodes when no filter', () => {
      const nodes = listNodes(graph)
      assert.equal(nodes.length, 151)
    })

    it('filters by template', () => {
      const domainModels = listNodes(graph, { templates: ['DomainModel'] })
      assert.equal(domainModels.length, 2)
      assert.ok(domainModels.some(n => n.id === 'orders.DomainModel.order'))
      assert.ok(domainModels.some(n => n.id === 'payments.DomainModel.payment'))
    })

    it('filters by multiple templates (OR semantics)', () => {
      const nodes = listNodes(graph, { templates: ['DomainModel', 'ReadModel'] })
      assert.ok(nodes.every(n => n.template === 'DomainModel' || n.template === 'ReadModel'))
      assert.ok(nodes.some(n => n.template === 'DomainModel'))
      assert.ok(nodes.some(n => n.template === 'ReadModel'))
    })

    it('excludes templates', () => {
      const structural = ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping']
      const nodes = listNodes(graph, { excludeTemplates: structural })
      assert.ok(nodes.every(n => !structural.includes(n.template)))
      assert.ok(nodes.length > 0)
    })

    it('filters by state as array', () => {
      const nodes = listNodes(graph, { state: ['agreed', 'proposed'] })
      assert.ok(nodes.every(n => n.state === 'agreed' || n.state === 'proposed'))
      assert.ok(nodes.length > 0)
    })

    it('filters by component', () => {
      const ordersNodes = listNodes(graph, { component: 'orders' })
      assert.equal(ordersNodes.length, 113)
    })

    it('filters by state', () => {
      const agreedNodes = listNodes(graph, { state: 'agreed' })
      assert.ok(agreedNodes.length > 0)
      assert.ok(agreedNodes.every(n => n.state === 'agreed'))
    })

    it('filters by multiple criteria', () => {
      const apiEndpoints = listNodes(graph, { templates: ['APIEndpoint'], component: 'orders' })
      assert.equal(apiEndpoints.length, 4)
      assert.ok(apiEndpoints.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })
  })

  describe('getCluster', () => {
    it('returns root + 22 children for DomainModel cluster', () => {
      const cluster = getCluster(graph, 'orders.DomainModel.order')
      assert.equal(cluster.root.id, 'orders.DomainModel.order')
      assert.equal(cluster.children.length, 22)
    })

    it('returns root + 18 children for APIEndpoint cluster', () => {
      const cluster = getCluster(graph, 'orders.APIEndpoint.create-order')
      assert.equal(cluster.root.id, 'orders.APIEndpoint.create-order')
      assert.equal(cluster.children.length, 18)
    })

    it('includes structural edges within the cluster', () => {
      const cluster = getCluster(graph, 'orders.DomainModel.order')
      const hasField = cluster.edges.filter(e => e.type === 'has-field')
      const hasValue = cluster.edges.filter(e => e.type === 'has-value')
      assert.equal(hasField.length, 9)
      assert.equal(hasValue.length, 4)
    })

    it('throws QueryError for unknown nodeId', () => {
      assert.throws(
        () => getCluster(graph, 'nonexistent.Node.id'),
        (err: unknown) => err instanceof QueryError,
      )
    })
  })

  describe('getLinkedFields', () => {
    it('returns 23 maps-to edges for DomainModel order', () => {
      const result = getLinkedFields(graph, 'orders.DomainModel.order')
      assert.equal(result.edges.length, 23)
      assert.ok(result.edges.every(e => e.type === 'maps-to'))
    })

    it('returns 7 maps-to edges for APIEndpoint create-order', () => {
      const result = getLinkedFields(graph, 'orders.APIEndpoint.create-order')
      assert.equal(result.edges.length, 7)
    })

    it('includes both endpoint nodes for each edge', () => {
      const result = getLinkedFields(graph, 'orders.DomainModel.order')
      const nodeIds = new Set(result.nodes.map(n => n.id))
      for (const edge of result.edges) {
        assert.ok(nodeIds.has(edge.from), `from node ${edge.from} in result`)
        assert.ok(nodeIds.has(edge.to), `to node ${edge.to} in result`)
      }
    })

    it('throws QueryError for unknown nodeId', () => {
      assert.throws(
        () => getLinkedFields(graph, 'nonexistent.Node.id'),
        (err: unknown) => err instanceof QueryError,
      )
    })
  })

  describe('getGraphSummary', () => {
    it('returns correct node and component counts', () => {
      const summary = getGraphSummary(graph)
      assert.equal(summary.nodeCount, 151)
      assert.equal(summary.componentCount, 3)
    })

    it('returns edge counts by type with non-zero triggers', () => {
      const summary = getGraphSummary(graph)
      assert.ok(typeof summary.edgesByType.triggers === 'number')
      assert.ok(summary.edgesByType.triggers > 0)
      assert.ok(typeof summary.edgesByType.produces === 'number')
      assert.ok(!('has-field' in summary.edgesByType), 'structural edges excluded')
    })

    it('returns orphan breakdown with non-negative count', () => {
      const summary = getGraphSummary(graph)
      assert.ok(summary.orphanNodeCount >= 0)
      assert.equal(
        Object.values(summary.orphansByTemplate).reduce<number>((a, b) => a + b, 0),
        summary.orphanNodeCount,
      )
    })

    it('returns diagnosticCount', () => {
      const summary = getGraphSummary(graph)
      assert.ok(typeof summary.diagnosticCount === 'number')
    })

    it('returns node breakdowns for all templates, states, and stability values', () => {
      const summary = getGraphSummary(graph)
      assert.ok(summary.nodesByTemplate.DomainModel > 0)
      assert.ok(summary.nodesByTemplate.Schema > 0)
      assert.ok(summary.nodesByTemplate.Field > 0)
      assert.ok(summary.nodesByComponent.orders > 0)
      assert.ok(summary.nodesByComponent.payments > 0)
      assert.equal(
        Object.values(summary.nodesByTemplate).reduce<number>((a, b) => a + b, 0),
        summary.nodeCount,
      )
      assert.equal(
        Object.values(summary.nodesByComponent).reduce<number>((a, b) => a + b, 0),
        summary.nodeCount,
      )
      assert.equal(
        Object.values(summary.nodesByState).reduce<number>((a, b) => a + b, 0),
        summary.nodeCount,
      )
      assert.equal(
        Object.values(summary.nodesByStability).reduce<number>((a, b) => a + b, 0),
        summary.nodeCount,
      )
    })
  })

  describe('searchNodes', () => {
    it('returns root-level nodes matching query', () => {
      const results = searchNodes(graph, ['order'])
      assert.ok(results.length > 0)
      assert.ok(results.some((r: { node: { id: string } }) => r.node.id === 'orders.DomainModel.order'))
    })

    it('excludes structural child nodes from results', () => {
      const results = searchNodes(graph, ['order'])
      assert.ok(!results.some((r: { node: { id: string } }) => r.node.id.includes('.operations.')))
      assert.ok(!results.some((r: { node: { id: string } }) => r.node.id.includes('.fields.')))
    })

    it('top result for "order" has highest score', () => {
      const results = searchNodes(graph, ['order'])
      const first = results[0]
      assert.ok(results.every((r: { score: number }) => r.score <= first.score))
    })

    it('empty query returns empty', () => {
      assert.equal(searchNodes(graph, ['']).length, 0)
      assert.equal(searchNodes(graph, []).length, 0)
    })

    it('limit is applied', () => {
      const results = searchNodes(graph, ['order'], { limit: 2 })
      assert.ok(results.length <= 2)
    })

    it('multiple queries use OR semantics', () => {
      const results = searchNodes(graph, ['order', 'payment'])
      assert.ok(results.some((r: { node: { id: string } }) => r.node.id.includes('order')))
      assert.ok(results.some((r: { node: { id: string } }) => r.node.id.includes('payment')))
    })

    it('template filter restricts results', () => {
      const results = searchNodes(graph, ['order'], { templates: ['DomainModel'] })
      assert.ok(results.every((r: { node: { template: string } }) => r.node.template === 'DomainModel'))
    })
  })

  describe('getLineage', () => {
    it('returns downstream lineage from a start node', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.DomainEvent.order-placed'))
      assert.ok(ids.includes('orders.IntegrationEvent.order-placed'))
    })

    it('annotates nodes with origin_id, depth, and via_edge_type', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
      const orderPlaced = result.nodes.find((n: { id: string }) => n.id === 'orders.DomainEvent.order-placed')
      assert.ok(orderPlaced !== undefined)
      assert.equal(orderPlaced!.origin_id, 'orders.DomainModel.order.operations.place')
      assert.equal(orderPlaced!.depth, 1)
      assert.equal(orderPlaced!.via_edge_type, 'produces')
    })

    it('respects depth limit', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'], { depth: 1 })
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.DomainEvent.order-placed'))
      assert.ok(!ids.includes('orders.IntegrationEvent.order-placed'))
    })

    it('upstream direction follows reverse edges', () => {
      const result = getLineage(graph, ['orders.DomainEvent.order-placed'], { direction: 'upstream' })
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.DomainModel.order.operations.place'))
    })

    it('excludes start nodes from result', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
      assert.ok(!result.nodes.some((n: { id: string }) => n.id === 'orders.DomainModel.order.operations.place'))
    })

    it('includes edges between result nodes', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
      assert.ok(result.edges.length > 0)
      assert.ok(result.edges.some((e: { type: string }) => e.type === 'produces'))
    })

    it('multiple start nodes expand in parallel', () => {
      const result = getLineage(graph, [
        'orders.DomainModel.order.operations.place',
        'orders.DomainModel.order.operations.complete',
      ])
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.DomainEvent.order-placed'))
      assert.ok(ids.includes('orders.DomainEvent.order-completed'))
    })

    it('records all origins when multiple start nodes reach the same node', () => {
      const mergedGraph = createMergedLineageGraph()
      const result = getLineage(mergedGraph, [
        'orders.DomainModel.order.operations.place',
        'orders.DomainModel.order.operations.complete',
      ])
      const shared = result.nodes.find((node: { id: string }) => node.id === 'orders.DomainEvent.order-published')

      assert.ok(shared !== undefined)
      assert.deepEqual(shared!.origins?.sort(), [
        'orders.DomainModel.order.operations.complete',
        'orders.DomainModel.order.operations.place',
      ])
    })

    it('follows uses-type outbound from a consumer to the shared type it references', () => {
      const usesTypeGraph = createUsesTypeGraph()
      const result = getLineage(usesTypeGraph, ['orders.APIEndpoint.create-order'])
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.Schema.shared-type'))
    })

    it('does not pull a consumer inbound when starting lineage from the shared type it uses', () => {
      const usesTypeGraph = createUsesTypeGraph()
      const result = getLineage(usesTypeGraph, ['orders.Schema.shared-type'], { direction: 'upstream' })
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(!ids.includes('orders.APIEndpoint.create-order'))
    })

    it('does pull the consumer inbound when readsOutboundOnly is disabled', () => {
      const usesTypeGraph = createUsesTypeGraph()
      const result = getLineage(usesTypeGraph, ['orders.Schema.shared-type'], {
        direction: 'upstream',
        readsOutboundOnly: false,
      })
      const ids = result.nodes.map((n: { id: string }) => n.id)
      assert.ok(ids.includes('orders.APIEndpoint.create-order'))
    })

    it('returns empty result for unknown start node', () => {
      const result = getLineage(graph, ['nonexistent.Node.id'])
      assert.equal(result.nodes.length, 0)
      assert.equal(result.edges.length, 0)
    })
  })
})
