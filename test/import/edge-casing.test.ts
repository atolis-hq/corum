import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEdgeCasing } from '../../src/import/edge-casing.js'
import type { Diagnostic, Edge, Graph, Node } from '../../src/schema/index.js'

function makeNode(id: string): Node {
  const parts = id.split('.')
  return {
    id,
    template: parts[1] ?? 'Unknown',
    component: parts[0],
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-01-01',
    properties: {},
  }
}

function makeEdge(from: string, to: string, type: Edge['type'] = 'maps-to'): Edge {
  return {
    id: `${from}__${type}__${to}`,
    from,
    to,
    type,
    state: 'agreed',
    stability: 'unstable',
  }
}

function makeGraph(nodeIds: string[]): Graph {
  return {
    nodesById: new Map(nodeIds.map(id => [id, makeNode(id)])),
    edgesByFrom: new Map(),
    edgesByTo: new Map(),
    templates: new Map(),
    diagnostics: [],
  }
}

describe('resolveEdgeCasing', () => {
  it('rewrites an endpoint that only differs by case to the exact surviving node id', () => {
    const graph = makeGraph(['orders.Schema.Money.fields.amount', 'orders.DomainModel.order.fields.id'])
    const edges = [makeEdge('orders.DomainModel.order.fields.id', 'orders.Schema.Money.fields.Amount')]
    const diagnostics: Diagnostic[] = []

    const result = resolveEdgeCasing(graph, edges, diagnostics)

    assert.equal(result[0].to, 'orders.Schema.Money.fields.amount')
    assert.equal(result[0].id, 'orders.DomainModel.order.fields.id__maps-to__orders.Schema.Money.fields.amount')
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].severity, 'warning')
    assert.match(diagnostics[0].message, /\[INFO\]/)
  })

  it('leaves an edge unchanged when both endpoints already match exactly', () => {
    const graph = makeGraph(['orders.Schema.Money.fields.amount', 'orders.DomainModel.order.fields.id'])
    const edges = [makeEdge('orders.DomainModel.order.fields.id', 'orders.Schema.Money.fields.amount')]
    const diagnostics: Diagnostic[] = []

    const result = resolveEdgeCasing(graph, edges, diagnostics)

    assert.equal(result[0], edges[0], 'should return the same edge object, not a copy')
    assert.equal(diagnostics.length, 0)
  })

  it('leaves an edge unresolved when there is no case-insensitive match either', () => {
    const graph = makeGraph(['orders.Schema.Money.fields.amount'])
    const edges = [makeEdge('orders.DomainModel.order.fields.id', 'orders.Schema.Money.fields.Currency')]
    const diagnostics: Diagnostic[] = []

    const result = resolveEdgeCasing(graph, edges, diagnostics)

    assert.equal(result[0].to, 'orders.Schema.Money.fields.Currency', 'left as-is for the existing dangling-ref check to catch')
    assert.equal(diagnostics.length, 0)
  })

  it('leaves an edge unresolved when the case-insensitive match is ambiguous', () => {
    const graph = makeGraph(['orders.Schema.Money.fields.amount', 'orders.Schema.Money.fields.Amount'])
    const edges = [makeEdge('orders.DomainModel.order.fields.id', 'orders.Schema.Money.fields.AMOUNT')]
    const diagnostics: Diagnostic[] = []

    const result = resolveEdgeCasing(graph, edges, diagnostics)

    assert.equal(result[0].to, 'orders.Schema.Money.fields.AMOUNT')
    assert.equal(diagnostics.length, 0)
  })

  it('rewrites both endpoints independently when both differ only by case', () => {
    const graph = makeGraph(['orders.Schema.Money.fields.amount', 'orders.DomainModel.order.fields.id'])
    const edges = [makeEdge('orders.DomainModel.order.fields.Id', 'orders.Schema.Money.fields.Amount')]
    const diagnostics: Diagnostic[] = []

    const result = resolveEdgeCasing(graph, edges, diagnostics)

    assert.equal(result[0].from, 'orders.DomainModel.order.fields.id')
    assert.equal(result[0].to, 'orders.Schema.Money.fields.amount')
  })
})
