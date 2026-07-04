import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { detectPossibleRenames, diffNodes, resolveIncomingAliases } from '../../src/reconcile/index.js'
import type { Edge, Graph, Node } from '../../src/schema/index.js'

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

function makeEdge(from: string, type: string, to: string, extra: Partial<Edge> = {}): Edge {
  return {
    id: `${from}__${type}__${to}`,
    from,
    to,
    type,
    state: 'proposed',
    stability: 'unstable',
    ...extra,
  }
}

function makeGraph(nodes: Node[], edges: Edge[] = []): Graph {
  const graph: Graph = {
    nodesById: new Map(nodes.map(node => [node.id, node])),
    edgesByFrom: new Map(),
    edgesByTo: new Map(),
    templates: new Map(),
    diagnostics: [],
  }
  for (const edge of edges) {
    const from = graph.edgesByFrom.get(edge.from) ?? []
    from.push(edge)
    graph.edgesByFrom.set(edge.from, from)
    const to = graph.edgesByTo.get(edge.to) ?? []
    to.push(edge)
    graph.edgesByTo.set(edge.to, to)
  }
  return graph
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

  it('preserves previousIds through determined re-imports', () => {
    const original = makeNode('orders.APIEndpoint.createOrder', {
      properties: { method: 'POST' },
      corum: { identity: { previousIds: ['orders.APIEndpoint.create'] } },
    })
    const incoming = makeNode('orders.APIEndpoint.createOrder', {
      derivation: 'determined',
      properties: { method: 'PUT' },
    })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate.length, 1)
    assert.equal(toUpdate[0].properties.method, 'PUT')
    assert.deepEqual(toUpdate[0].corum?.identity?.previousIds, ['orders.APIEndpoint.create'])
  })
})

describe('resolveIncomingAliases', () => {
  const OLD_ID = 'orders.APIEndpoint.create'
  const NEW_ID = 'orders.APIEndpoint.createOrder'

  function renamedGraph(): Graph {
    const live = makeNode(NEW_ID, { corum: { identity: { previousIds: [OLD_ID] } } })
    return makeGraph([live], [makeEdge(NEW_ID, 'renamed-from', OLD_ID)])
  }

  it('re-import of an unrenamed spec merges into the renamed node and reports in-flight drift', () => {
    const graph = renamedGraph()
    const aliasMap = new Map([[OLD_ID, NEW_ID]])
    const incoming = [makeNode(OLD_ID)]

    const { nodes, diagnostics } = resolveIncomingAliases(graph, aliasMap, incoming, [], './specs/orders.yaml')
    assert.equal(nodes.length, 1)
    assert.equal(nodes[0].id, NEW_ID)
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].severity, 'warning')
    assert.match(diagnostics[0].message, /in-flight drift/)
    assert.match(diagnostics[0].message, new RegExp(OLD_ID))
    assert.match(diagnostics[0].message, new RegExp(NEW_ID))

    // Downstream diff sees an update to the renamed node — not add+remove.
    const { toAdd, toUpdate, toRemove } = diffNodes(nodes, graph.nodesById, './specs/orders.yaml')
    assert.equal(toAdd.length, 0)
    assert.equal(toRemove.length, 0)
    assert.ok(toUpdate.every(n => n.id === NEW_ID))
  })

  it('rewrites descendants and their parentIds through the renamed prefix', () => {
    const root = 'orders.DomainModel.order'
    const oldSchema = `${root}.schemas.customer`
    const newSchema = `${root}.schemas.client`
    const graph = makeGraph(
      [makeNode(newSchema, { template: 'Schema', parentId: root })],
      [makeEdge(newSchema, 'renamed-from', oldSchema)],
    )
    const aliasMap = new Map([[oldSchema, newSchema]])
    const incoming = [
      makeNode(oldSchema, { template: 'Schema', parentId: root }),
      makeNode(`${oldSchema}.fields.email`, { template: 'Field', parentId: oldSchema }),
    ]
    const incomingEdges = [makeEdge(oldSchema, 'has-field', `${oldSchema}.fields.email`)]

    const { nodes, edges, diagnostics } = resolveIncomingAliases(graph, aliasMap, incoming, incomingEdges, './specs/orders.yaml')
    assert.deepEqual(nodes.map(n => n.id).sort(), [newSchema, `${newSchema}.fields.email`].sort())
    const field = nodes.find(n => n.template === 'Field')!
    assert.equal(field.parentId, newSchema)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].from, newSchema)
    assert.equal(edges[0].to, `${newSchema}.fields.email`)
    assert.equal(edges[0].id, `${newSchema}__has-field__${newSchema}.fields.email`)
    // Drift reported once per rewritten subtree root, not per descendant.
    const drift = diagnostics.filter(d => /in-flight drift/.test(d.message))
    assert.equal(drift.length, 1)
    assert.equal(drift[0].nodeId, newSchema)
  })

  it('does not rewrite ids sharing a non-segment string prefix', () => {
    const graph = renamedGraph()
    const aliasMap = new Map([[OLD_ID, NEW_ID]])
    const trap = makeNode(`${OLD_ID}X`)
    const { nodes, diagnostics } = resolveIncomingAliases(graph, aliasMap, [trap], [], './specs/orders.yaml')
    assert.equal(nodes[0].id, `${OLD_ID}X`)
    assert.equal(diagnostics.length, 0)
  })

  it('ambiguity: a literal incoming id wins over another id resolving to it, with a warning', () => {
    const graph = renamedGraph()
    const aliasMap = new Map([[OLD_ID, NEW_ID]])
    const incoming = [makeNode(NEW_ID), makeNode(OLD_ID)]

    const { nodes, diagnostics } = resolveIncomingAliases(graph, aliasMap, incoming, [], './specs/orders.yaml')
    assert.deepEqual(nodes.map(n => n.id).sort(), [NEW_ID, OLD_ID].sort(), 'resolution skipped — literal stays authoritative')
    const ambiguous = diagnostics.filter(d => /ambiguous alias/.test(d.message))
    assert.equal(ambiguous.length, 1)
    assert.match(ambiguous[0].message, new RegExp(OLD_ID))
    assert.match(ambiguous[0].message, new RegExp(NEW_ID))
    assert.equal(diagnostics.filter(d => /in-flight drift/.test(d.message)).length, 0)
  })

  it('leaves untouched batches alone when the alias map is empty', () => {
    const graph = makeGraph([])
    const incoming = [makeNode(OLD_ID)]
    const { nodes, diagnostics } = resolveIncomingAliases(graph, new Map(), incoming, [], './specs/orders.yaml')
    assert.equal(nodes, incoming)
    assert.equal(diagnostics.length, 0)
  })
})

describe('detectPossibleRenames', () => {
  const parent = 'orders.DomainModel.order.schemas.customer'

  function fieldNode(name: string, overrides: Partial<Node> = {}): Node {
    return makeNode(`${parent}.fields.${name}`, { template: 'Field', parentId: parent, ...overrides })
  }

  it('warns when a re-import removes X and adds Y under the same parent with the same template', () => {
    const removed = fieldNode('customerEmail', { state: 'removed' })
    const added = fieldNode('emailAddress')
    const diagnostics = detectPossibleRenames(
      { toAdd: [added], toUpdate: [], toRemove: [removed] },
      './specs/orders.yaml',
    )
    assert.equal(diagnostics.length, 1)
    assert.equal(diagnostics[0].severity, 'warning')
    assert.match(diagnostics[0].message, /possible rename/)
    assert.match(diagnostics[0].message, /rename_node/)
    assert.match(diagnostics[0].message, new RegExp(removed.id))
    assert.match(diagnostics[0].message, new RegExp(added.id))
  })

  it('does not fire for different templates or different parents', () => {
    const removed = fieldNode('customerEmail', { state: 'removed' })
    const differentTemplate = makeNode(`${parent}.fields.emailAddress`, { template: 'EnumValue', parentId: parent })
    const differentParent = makeNode(
      'orders.DomainModel.order.schemas.other.fields.emailAddress',
      { template: 'Field', parentId: 'orders.DomainModel.order.schemas.other' },
    )
    const diagnostics = detectPossibleRenames(
      { toAdd: [differentTemplate, differentParent], toUpdate: [], toRemove: [removed] },
      './specs/orders.yaml',
    )
    assert.equal(diagnostics.length, 0)
  })

  it('does not fire when nothing was removed', () => {
    const diagnostics = detectPossibleRenames(
      { toAdd: [fieldNode('emailAddress')], toUpdate: [], toRemove: [] },
      './specs/orders.yaml',
    )
    assert.equal(diagnostics.length, 0)
  })
})
