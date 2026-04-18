import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Node, Edge, Graph, LoadOptions } from '../src/schema/index.js'

describe('schema types', () => {
  it('Node has required fields', () => {
    const node: Node = {
      id: 'orders.DomainModel.order',
      template: 'DomainModel',
      component: 'orders',
      state: 'agreed',
      stability: 'stable',
      schemaVersion: '1',
      lastModifiedAt: '2026-04-17',
      properties: {},
    }
    assert.equal(node.id, 'orders.DomainModel.order')
  })

  it('Edge has required fields', () => {
    const edge: Edge = {
      id: 'orders.APIEndpoint.create-order__reads__orders.DomainModel.order',
      from: 'orders.APIEndpoint.create-order',
      to: 'orders.DomainModel.order',
      type: 'reads',
      state: 'proposed',
      stability: 'unstable',
    }
    assert.equal(edge.type, 'reads')
  })

  it('Graph and LoadOptions carry graph loading state', () => {
    const graph: Graph = {
      nodesById: new Map(),
      edgesByFrom: new Map(),
      edgesByTo: new Map(),
      templates: new Map(),
      diagnostics: [],
    }
    const options: LoadOptions = { graphPath: 'fixtures/sample-graph' }

    assert.equal(graph.nodesById.size, 0)
    assert.equal(options.graphPath, 'fixtures/sample-graph')
  })

  it('LoadError carries diagnostics', async () => {
    const { LoadError } = await import('../src/schema/index.js')
    const err = new LoadError([{ severity: 'error', file: 'x.yaml', message: 'bad' }])
    assert.equal(err.diagnostics.length, 1)
    assert.ok(err instanceof Error)
  })
})
