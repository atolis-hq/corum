import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMcpHandlers } from '../src/mcp/index.js'
import { loadGraph } from '../src/loader/index.js'
import type { Graph } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('MCP handlers', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  describe('list_nodes', () => {
    it('returns all nodes with no filter', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({})
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 45)
      assert.ok('id' in nodes[0])
      assert.ok('template' in nodes[0])
      assert.ok('state' in nodes[0])
      assert.ok(!('properties' in nodes[0]))
    })

    it('filters by template', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].id, 'orders.APIEndpoint.create-order')
    })

    it('filters by component', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ component: 'orders' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 45)
    })
  })

  describe('get_cluster', () => {
    it('returns full cluster for DomainModel', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_cluster({ node_id: 'orders.DomainModel.order' })
      const cluster = JSON.parse(result.content[0].text)
      assert.equal(cluster.root.id, 'orders.DomainModel.order')
      assert.equal(cluster.children.length, 20)
      assert.ok(Array.isArray(cluster.edges))
    })

    it('returns error message for unknown node', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_cluster({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('not found'))
    })
  })

  describe('get_linked_fields', () => {
    it('returns 7 maps-to edges for DomainModel', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_linked_fields({ node_id: 'orders.DomainModel.order' })
      const linked = JSON.parse(result.content[0].text)
      assert.equal(linked.edges.length, 7)
      assert.ok(Array.isArray(linked.nodes))
    })

    it('returns error message for unknown node', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_linked_fields({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
    })
  })
})
