import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listNodes, getCluster, getLinkedFields } from '../src/graph/index.js'
import { loadGraph } from '../src/loader/index.js'
import { QueryError } from '../src/schema/index.js'
import type { Graph } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('graph queries', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  describe('listNodes', () => {
    it('returns all 147 nodes when no filter', () => {
      const nodes = listNodes(graph)
      assert.equal(nodes.length, 147)
    })

    it('filters by template', () => {
      const domainModels = listNodes(graph, { template: 'DomainModel' })
      assert.equal(domainModels.length, 2)
      assert.ok(domainModels.some(n => n.id === 'orders.DomainModel.order'))
      assert.ok(domainModels.some(n => n.id === 'payments.DomainModel.payment'))
    })

    it('filters by component', () => {
      const ordersNodes = listNodes(graph, { component: 'orders' })
      assert.equal(ordersNodes.length, 109)
    })

    it('filters by state', () => {
      const agreedNodes = listNodes(graph, { state: 'agreed' })
      assert.ok(agreedNodes.length > 0)
      assert.ok(agreedNodes.every(n => n.state === 'agreed'))
    })

    it('filters by multiple criteria', () => {
      const apiEndpoints = listNodes(graph, { template: 'APIEndpoint', component: 'orders' })
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
})
