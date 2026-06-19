import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diffNodes } from '../../src/reconcile/index.js'
import type { Node } from '../../src/schema/index.js'

function makeNode(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    template: 'APIEndpoint',
    component: 'orders',
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-06-18',
    properties: {},
    extractedFrom: './specs/orders.yaml',
    derivation: 'determined',
    derivedBy: 'adapter:openapi',
    ...overrides,
  }
}

describe('diffNodes', () => {
  it('identifies new nodes', () => {
    const existing = new Map<string, Node>()
    const incoming = [makeNode('orders.APIEndpoint.create')]
    const { toAdd, toUpdate, toRemove } = diffNodes(incoming, existing, './specs/orders.yaml')
    assert.equal(toAdd.length, 1)
    assert.equal(toUpdate.length, 0)
    assert.equal(toRemove.length, 0)
  })

  it('identifies unchanged nodes as neither add nor update', () => {
    const node = makeNode('orders.APIEndpoint.create')
    const existing = new Map([[node.id, { ...node }]])
    const { toAdd, toUpdate } = diffNodes([node], existing, './specs/orders.yaml')
    assert.equal(toAdd.length, 0)
    assert.equal(toUpdate.length, 0)
  })

  it('identifies changed nodes', () => {
    const original = makeNode('orders.APIEndpoint.create', { properties: { method: 'GET' } })
    const updated = makeNode('orders.APIEndpoint.create', { properties: { method: 'POST' } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([updated], existing, './specs/orders.yaml')
    assert.equal(toUpdate.length, 1)
    assert.equal(toUpdate[0].properties.method, 'POST')
  })

  it('identifies orphaned nodes for removal', () => {
    const orphan = makeNode('orders.APIEndpoint.deleted', { extractedFrom: './specs/orders.yaml' })
    const existing = new Map([[orphan.id, orphan]])
    const { toRemove } = diffNodes([], existing, './specs/orders.yaml')
    assert.equal(toRemove.length, 1)
    assert.equal(toRemove[0].id, 'orders.APIEndpoint.deleted')
  })

  it('does not remove nodes from a different spec', () => {
    const other = makeNode('orders.APIEndpoint.other', { extractedFrom: './specs/other.yaml' })
    const existing = new Map([[other.id, other]])
    const { toRemove } = diffNodes([], existing, './specs/orders.yaml')
    assert.equal(toRemove.length, 0)
  })

  it('preserves state/stability on update', () => {
    const original = makeNode('orders.APIEndpoint.create', { state: 'agreed', stability: 'stable' })
    const incoming = makeNode('orders.APIEndpoint.create', { state: 'implemented', stability: 'unstable', properties: { method: 'POST' } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate[0].state, 'agreed')
    assert.equal(toUpdate[0].stability, 'stable')
  })

  it('always overwrites derivation with incoming value', () => {
    const original = makeNode('orders.APIEndpoint.create', { derivation: 'manual' })
    const incoming = makeNode('orders.APIEndpoint.create', { derivation: 'determined' })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate[0].derivation, 'determined')
  })

  it('for determined nodes, incoming properties replace current â€” non-human current-only props are dropped', () => {
    const original = makeNode('orders.APIEndpoint.create', { properties: { method: 'GET', displayName: 'Create Order' } })
    const incoming = makeNode('orders.APIEndpoint.create', { properties: { method: 'POST' } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate[0].properties.method, 'POST')
    assert.equal(toUpdate[0].properties.displayName, undefined)
  })

  it('for determined nodes, parameters property is updated on re-import', () => {
    const oldParams = { status: { location: 'query', type: 'string', required: false } }
    const newParams = {
      status: { location: 'query', type: 'string', required: false },
      limit: { location: 'query', type: 'integer', required: true },
    }
    const original = makeNode('items.APIEndpoint.searchItems', { properties: { method: 'GET', parameters: oldParams } })
    const incoming = makeNode('items.APIEndpoint.searchItems', { properties: { method: 'GET', parameters: newParams } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate.length, 1)
    assert.deepEqual(toUpdate[0].properties.parameters, newParams)
  })
})
