import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildExistingSchemaIndex,
  detectSchemaPromotions,
  rewritePromotedSchemaEdges,
} from '../../src/import/schema-promotion.js'
import type { Diagnostic, Edge, Graph, Node } from '../../src/schema/index.js'

function makeNode(id: string, state: Node['state'] = 'implemented'): Node {
  const parts = id.split('.')
  return {
    id,
    ...(parts.length > 3 && { parentId: parts.slice(0, -2).join('.') }),
    template: parts[1] ?? 'Unknown',
    component: parts[0],
    state,
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

function makeGraph(nodes: Node[], edges: Edge[]): Graph {
  const nodesById = new Map(nodes.map(n => [n.id, n]))
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const edge of edges) {
    edgesByFrom.set(edge.from, [...(edgesByFrom.get(edge.from) ?? []), edge])
    edgesByTo.set(edge.to, [...(edgesByTo.get(edge.to) ?? []), edge])
  }
  return { nodesById, edgesByFrom, edgesByTo, templates: new Map(), diagnostics: [] }
}

describe('buildExistingSchemaIndex', () => {
  it('indexes standalone schema nodes by their field names', () => {
    const graph = makeGraph([
      makeNode('orders.Schema.Money'),
      makeNode('orders.Schema.Money.fields.amount'),
      makeNode('orders.Schema.Money.fields.currency'),
      makeNode('orders.APIEndpoint.createOrder'),
      makeNode('orders.APIEndpoint.createOrder.schemas.Foo'),
    ], [])

    const index = buildExistingSchemaIndex(graph)

    assert.ok(index.has('orders.Schema.Money'))
    assert.deepEqual(index.get('orders.Schema.Money'), new Set(['amount', 'currency']))
    assert.ok(!index.has('orders.APIEndpoint.createOrder.schemas.Foo'), 'inline schemas are not indexed')
  })

  it('excludes standalone schemas marked as removed', () => {
    const graph = makeGraph([
      makeNode('orders.Schema.Money', 'removed'),
      makeNode('orders.Schema.Money.fields.amount', 'removed'),
    ], [])

    const index = buildExistingSchemaIndex(graph)
    assert.ok(!index.has('orders.Schema.Money'))
  })
})

describe('detectSchemaPromotions', () => {
  it('matches old inline subtrees to a newly created standalone schema by component + name', () => {
    const priorNodeIds = new Set([
      'orders.APIEndpoint.createOrder.schemas.Money',
      'orders.APIEndpoint.refundOrder.schemas.Money',
      'payments.APIEndpoint.charge.schemas.Money', // different component — must not match
    ])
    const newlyCreated = new Set(['orders.Schema.Money'])

    const promotions = detectSchemaPromotions(new Map([...priorNodeIds].map(id => [id, makeNode(id)])), newlyCreated)

    assert.equal(promotions.length, 2)
    assert.ok(promotions.some(p => p.oldPrefix === 'orders.APIEndpoint.createOrder.schemas.Money' && p.newPrefix === 'orders.Schema.Money'))
    assert.ok(promotions.some(p => p.oldPrefix === 'orders.APIEndpoint.refundOrder.schemas.Money' && p.newPrefix === 'orders.Schema.Money'))
  })

  it('does not treat an already-existing standalone schema as a promotion', () => {
    const priorNodeIds = new Set(['orders.Schema.Money', 'orders.APIEndpoint.createOrder.schemas.Money'])
    const newlyCreated = new Set(['orders.Schema.Money'])

    const promotions = detectSchemaPromotions(new Map([...priorNodeIds].map(id => [id, makeNode(id)])), newlyCreated)
    assert.equal(promotions.length, 0)
  })
})

describe('rewritePromotedSchemaEdges', () => {
  it('rewrites edges under the old inline subtree to the new standalone subtree', () => {
    const graph = makeGraph([
      makeNode('orders.APIEndpoint.createOrder.schemas.Money', 'removed'),
      makeNode('orders.APIEndpoint.createOrder.schemas.Money.fields.amount', 'removed'),
      makeNode('orders.Schema.Money'),
      makeNode('orders.Schema.Money.fields.amount'),
      makeNode('orders.DomainModels.ledger'),
    ], [
      makeEdge('orders.DomainModels.ledger', 'orders.APIEndpoint.createOrder.schemas.Money.fields.amount'),
    ])

    const diagnostics: Diagnostic[] = []
    rewritePromotedSchemaEdges(graph, [
      { oldPrefix: 'orders.APIEndpoint.createOrder.schemas.Money', newPrefix: 'orders.Schema.Money' },
    ], diagnostics)

    assert.equal(diagnostics.length, 0)
    const rewritten = (graph.edgesByTo.get('orders.Schema.Money.fields.amount') ?? [])
    assert.equal(rewritten.length, 1)
    assert.equal(rewritten[0].from, 'orders.DomainModels.ledger')
    assert.equal(rewritten[0].id, 'orders.DomainModels.ledger__maps-to__orders.Schema.Money.fields.amount')

    const stale = (graph.edgesByTo.get('orders.APIEndpoint.createOrder.schemas.Money.fields.amount') ?? [])
    assert.equal(stale.length, 0, 'old edge index entry should be cleared')
  })

  it('warns and leaves the edge unrewritten when the rewritten target does not exist', () => {
    const graph = makeGraph([
      makeNode('orders.APIEndpoint.createOrder.schemas.Money', 'removed'),
      makeNode('orders.APIEndpoint.createOrder.schemas.Money.fields.legacyField', 'removed'),
      makeNode('orders.Schema.Money'),
      makeNode('orders.Schema.Money.fields.amount'), // note: no "legacyField" on the new schema
      makeNode('orders.DomainModels.ledger'),
    ], [
      makeEdge('orders.DomainModels.ledger', 'orders.APIEndpoint.createOrder.schemas.Money.fields.legacyField'),
    ])

    const diagnostics: Diagnostic[] = []
    rewritePromotedSchemaEdges(graph, [
      { oldPrefix: 'orders.APIEndpoint.createOrder.schemas.Money', newPrefix: 'orders.Schema.Money' },
    ], diagnostics)

    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].severity, 'warning')
    assert.match(diagnostics[0].message, /unresolvable|does not exist/i)

    const stale = (graph.edgesByTo.get('orders.APIEndpoint.createOrder.schemas.Money.fields.legacyField') ?? [])
    assert.equal(stale.length, 1, 'edge left in place when unresolvable')
  })
})

describe('schema promotion with prefix-related roots', () => {
  it('indexes only owned fields and indexes independent schema roots separately', () => {
    const root = makeNode('orders.Schema.foo')
    const independent = { ...makeNode(root.id + '.fields.independent'), parentId: undefined }
    const child = { ...makeNode(independent.id + '.fields.value'), parentId: independent.id }
    const graph = makeGraph([root, makeNode(root.id + '.fields.owned'), independent, child], [])
    const index = buildExistingSchemaIndex(graph)
    assert.deepEqual(index.get(root.id), new Set(['owned']))
    assert.deepEqual(index.get(independent.id), new Set(['value']))
  })

  it('does not detect an independent root with an inline-looking ID as a promotion', () => {
    const independent = { ...makeNode('orders.DomainModel.foo.schemas.Money'), parentId: undefined }
    assert.deepEqual(detectSchemaPromotions(new Map([[independent.id, independent]]), new Set(['orders.Schema.Money'])), [])
  })

  it('rewrites owned endpoints but leaves an independent root and its child untouched', () => {
    const owner = makeNode('orders.DomainModel.foo')
    const old = makeNode(owner.id + '.schemas.Money', 'removed')
    const oldField = makeNode(old.id + '.fields.value', 'removed')
    const independent = { ...makeNode(old.id + '.bar'), parentId: undefined }
    const independentChild = { ...makeNode(independent.id + '.fields.value'), parentId: independent.id }
    const promoted = makeNode('orders.Schema.Money')
    const promotedField = makeNode(promoted.id + '.fields.value')
    // Candidate IDs exist to expose an incorrect prefix-based redirect.
    const candidate = { ...makeNode(promoted.id + '.bar'), parentId: undefined }
    const candidateChild = { ...makeNode(candidate.id + '.fields.value'), parentId: candidate.id }
    const independentEdge = makeEdge(independent.id, independentChild.id)
    const ownedEdge = makeEdge(oldField.id, independentChild.id)
    const graph = makeGraph([owner, old, oldField, independent, independentChild, promoted, promotedField, candidate, candidateChild], [independentEdge, ownedEdge])
    const diagnostics: Diagnostic[] = []
    rewritePromotedSchemaEdges(graph, [{ oldPrefix: old.id, newPrefix: promoted.id }], diagnostics)
    assert.deepEqual(diagnostics, [])
    assert.deepEqual(graph.edgesByFrom.get(independent.id), [independentEdge])
    assert.equal(graph.edgesByFrom.get(promotedField.id)?.[0].to, independentChild.id)
    assert.equal(graph.edgesByFrom.get(candidate.id), undefined)
  })
})

it('warns rather than redirecting a promoted field to an independent root with the candidate ID', () => {
  const old = makeNode('orders.DomainModel.foo.schemas.Money')
  const field = makeNode(old.id + '.fields.value')
  const promoted = makeNode('orders.Schema.Money')
  const independent = { ...makeNode(promoted.id + '.fields.value'), parentId: undefined }
  const edge = makeEdge(field.id, 'orders.Command.consume')
  const graph = makeGraph([old, field, promoted, independent], [edge])
  const diagnostics: Diagnostic[] = []
  rewritePromotedSchemaEdges(graph, [{ oldPrefix: old.id, newPrefix: promoted.id }], diagnostics)
  assert.equal(diagnostics.length, 1)
  assert.deepEqual(graph.edgesByFrom.get(field.id), [edge])
  assert.equal(graph.edgesByFrom.get(independent.id), undefined)
})
