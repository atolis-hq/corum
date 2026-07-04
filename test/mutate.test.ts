import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../src/loader/index.js'
import { serializeGraph } from '../src/writer/graph-writer.js'
import { isStructuralEdgeType } from '../src/graph/index.js'
import {
  MutationError,
  buildAliasMap,
  deleteEdge,
  deleteNode,
  renameNode,
  resolveAlias,
  rewriteIdPrefix,
  shouldRecordTrail,
} from '../src/mutate/index.js'
import type { Edge, Graph, Node } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

function makeNode(id: string, extra: Partial<Node> = {}): Node {
  return {
    id,
    template: 'Schema',
    component: id.split('.')[0],
    state: 'proposed',
    stability: 'unstable',
    schemaVersion: '1.0.0',
    lastModifiedAt: '2026-07-01',
    properties: {},
    ...extra,
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

const ROOT = 'orders.DomainModel.order'
const SCHEMA = `${ROOT}.schemas.customer`
const SIBLING_TRAP = `${ROOT}.schemas.customerX`
const OTHER_SIBLING = `${ROOT}.schemas.other`
const FIELD = `${SCHEMA}.fields.email`
const TRAP_FIELD = `${SIBLING_TRAP}.fields.name`
const CONSUMER = 'payments.APIEndpoint.pay'

function makeRenameFixture(): Graph {
  return makeGraph(
    [
      makeNode(ROOT, { template: 'DomainModel' }),
      makeNode(SCHEMA, { parentId: ROOT }),
      makeNode(SIBLING_TRAP, { parentId: ROOT }),
      makeNode(OTHER_SIBLING, { parentId: ROOT }),
      makeNode(FIELD, { parentId: SCHEMA, template: 'Field' }),
      makeNode(TRAP_FIELD, { parentId: SIBLING_TRAP, template: 'Field' }),
      makeNode(CONSUMER, { template: 'APIEndpoint' }),
    ],
    [
      makeEdge(SCHEMA, 'has-field', FIELD),
      makeEdge(SIBLING_TRAP, 'has-field', TRAP_FIELD),
      makeEdge(CONSUMER, 'uses-type', SCHEMA, {
        state: 'agreed',
        stability: 'stable',
        properties: { via: 'request-body' },
      }),
    ],
  )
}

/** Order-independent structural snapshot for before/after deep comparison. */
function snapshot(graph: Graph): string {
  const nodes = [...graph.nodesById.values()].sort((a, b) => a.id.localeCompare(b.id))
  const edges = allEdges(graph).sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify({ nodes, edges })
}

function allEdges(graph: Graph): Edge[] {
  return [...graph.edgesByFrom.values()].flat()
}

/** Every edge must sit in both indexes under exactly its endpoints. */
function assertIndexIntegrity(graph: Graph): void {
  for (const [key, edges] of graph.edgesByFrom) {
    assert.ok(edges.length > 0, `empty edgesByFrom bucket: ${key}`)
    for (const edge of edges) {
      assert.equal(edge.from, key)
      assert.equal(edge.id, `${edge.from}__${edge.type}__${edge.to}`)
      assert.ok((graph.edgesByTo.get(edge.to) ?? []).includes(edge), `edge ${edge.id} missing from edgesByTo`)
    }
  }
  for (const [key, edges] of graph.edgesByTo) {
    assert.ok(edges.length > 0, `empty edgesByTo bucket: ${key}`)
    for (const edge of edges) {
      assert.equal(edge.to, key)
      assert.ok((graph.edgesByFrom.get(edge.from) ?? []).includes(edge), `edge ${edge.id} missing from edgesByFrom`)
    }
  }
}

describe('renameNode', () => {
  it('renames a node and cascades to descendants, parentIds, and edges', () => {
    const graph = makeRenameFixture()
    const { newId, warnings } = renameNode(graph, SCHEMA, 'client', true)

    const newSchemaId = `${ROOT}.schemas.client`
    const newFieldId = `${newSchemaId}.fields.email`
    assert.equal(newId, newSchemaId)
    assert.equal(warnings.length, 0)

    assert.ok(graph.nodesById.has(newSchemaId))
    assert.ok(!graph.nodesById.has(SCHEMA))
    const field = graph.nodesById.get(newFieldId)
    assert.ok(field, 'descendant renamed')
    assert.ok(!graph.nodesById.has(FIELD))
    assert.equal(field.parentId, newSchemaId)

    // structural edge rewritten: findable under new from AND new to, not old
    const hasField = (graph.edgesByFrom.get(newSchemaId) ?? []).find(e => e.type === 'has-field')
    assert.ok(hasField)
    assert.equal(hasField.to, newFieldId)
    assert.equal(hasField.id, `${newSchemaId}__has-field__${newFieldId}`)
    assert.ok(!graph.edgesByFrom.has(SCHEMA))
    assert.ok(!graph.edgesByTo.has(FIELD))
    assert.ok((graph.edgesByTo.get(newFieldId) ?? []).includes(hasField))

    // explicit edge keeps its properties, state, and stability
    const usesType = (graph.edgesByFrom.get(CONSUMER) ?? []).find(e => e.type === 'uses-type')
    assert.ok(usesType)
    assert.equal(usesType.to, newSchemaId)
    assert.equal(usesType.id, `${CONSUMER}__uses-type__${newSchemaId}`)
    assert.deepEqual(usesType.properties, { via: 'request-body' })
    assert.equal(usesType.state, 'agreed')
    assert.equal(usesType.stability, 'stable')

    // trail recorded
    const renamed = graph.nodesById.get(newSchemaId)!
    assert.deepEqual(renamed.properties.previousNames, [SCHEMA])
    const trail = (graph.edgesByFrom.get(newSchemaId) ?? []).find(e => e.type === 'renamed-from')
    assert.ok(trail)
    assert.equal(trail.to, SCHEMA)
    assert.equal(trail.id, `${newSchemaId}__renamed-from__${SCHEMA}`)
    assert.equal(trail.state, 'proposed')
    assert.equal(trail.stability, 'unstable')

    assertIndexIntegrity(graph)
  })

  it('does not touch nodes sharing a string prefix (exact-segment boundary)', () => {
    const graph = makeRenameFixture()
    renameNode(graph, SCHEMA, 'client', false)

    assert.ok(graph.nodesById.has(SIBLING_TRAP), 'customerX must survive customer rename')
    assert.ok(graph.nodesById.has(TRAP_FIELD))
    const trapEdge = (graph.edgesByFrom.get(SIBLING_TRAP) ?? []).find(e => e.type === 'has-field')
    assert.ok(trapEdge)
    assert.equal(trapEdge.to, TRAP_FIELD)
  })

  it('records no trail when recordTrail is false', () => {
    const graph = makeRenameFixture()
    const { newId } = renameNode(graph, SCHEMA, 'client', false)
    assert.equal(graph.nodesById.get(newId)!.properties.previousNames, undefined)
    assert.ok(!(graph.edgesByFrom.get(newId) ?? []).some(e => e.type === 'renamed-from'))
  })

  it('rejects an invalid segment and leaves the graph untouched', () => {
    const graph = makeRenameFixture()
    const before = snapshot(graph)
    assert.throws(() => renameNode(graph, SCHEMA, 'bad name', true), MutationError)
    assert.throws(() => renameNode(graph, SCHEMA, 'a__b', true), MutationError)
    assert.throws(() => renameNode(graph, SCHEMA, '', true), MutationError)
    assert.equal(snapshot(graph), before)
  })

  it('rejects a missing node and a sibling collision, leaving the graph untouched', () => {
    const graph = makeRenameFixture()
    const before = snapshot(graph)
    assert.throws(() => renameNode(graph, `${ROOT}.schemas.nope`, 'x', true), MutationError)
    assert.throws(() => renameNode(graph, SCHEMA, 'customerX', true), MutationError)
    assert.throws(() => renameNode(graph, SCHEMA, 'customer', true), MutationError)
    assert.equal(snapshot(graph), before)
    try {
      renameNode(graph, SCHEMA, 'customerX', true)
      assert.fail('expected MutationError')
    } catch (err) {
      assert.ok(err instanceof MutationError)
      assert.ok(err.diagnostics.some(d => d.severity === 'error'))
    }
  })

  it('warns (not errors) when the new id is a retired id in the alias map', () => {
    const graph = makeRenameFixture()
    renameNode(graph, SCHEMA, 'client', true) // customer retired
    const { warnings } = renameNode(graph, OTHER_SIBLING, 'customer', false)
    assert.equal(warnings.length, 1)
    assert.equal(warnings[0].severity, 'warning')
    assert.match(warnings[0].message, /retired id/)
    assert.ok(graph.nodesById.has(SCHEMA), 'other took the retired name')
  })

  it('chains: previousNames ordered oldest first, trail edges re-point to the live id', () => {
    const graph = makeRenameFixture()
    renameNode(graph, SCHEMA, 'client', true)
    const { newId } = renameNode(graph, `${ROOT}.schemas.client`, 'consumer', true)

    const consumerId = `${ROOT}.schemas.consumer`
    assert.equal(newId, consumerId)
    const node = graph.nodesById.get(consumerId)!
    assert.deepEqual(node.properties.previousNames, [SCHEMA, `${ROOT}.schemas.client`])

    const trails = (graph.edgesByFrom.get(consumerId) ?? []).filter(e => e.type === 'renamed-from')
    assert.deepEqual(
      trails.map(e => e.to).sort(),
      [`${ROOT}.schemas.client`, SCHEMA].sort(),
      'existing trail edge auto-repointed, each old id resolvable in one hop',
    )
    assertIndexIntegrity(graph)
  })

  it('rename-back prunes previousNames and never leaves a self-loop trail edge', () => {
    const graph = makeRenameFixture()
    renameNode(graph, SCHEMA, 'client', true)
    const { newId } = renameNode(graph, `${ROOT}.schemas.client`, 'customer', true)

    assert.equal(newId, SCHEMA)
    const node = graph.nodesById.get(SCHEMA)!
    const previousNames = node.properties.previousNames as string[]
    assert.ok(!previousNames.includes(SCHEMA), 'previousNames never contains the current id')
    assert.deepEqual(previousNames, [`${ROOT}.schemas.client`])

    const trails = allEdges(graph).filter(e => e.type === 'renamed-from')
    assert.ok(trails.every(e => e.from !== e.to), 'no self-loop renamed-from edges')
    assert.deepEqual(trails.map(e => e.id), [`${SCHEMA}__renamed-from__${ROOT}.schemas.client`])
    assertIndexIntegrity(graph)
  })

  it('rewritten structural edges equal regeneration from ownership (fixture round-trip)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mutate-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const schemaId = 'orders.DomainModel.order.schemas.order-line-item'
      assert.ok(graph.nodesById.has(schemaId), 'fixture schema exists')
      renameNode(graph, schemaId, 'order-line', false)

      const map = serializeGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
      for (const [key, content] of map) {
        const filePath = path.join(tmpDir, ...key.split('/'))
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
      }
      const reloaded = await loadGraph({ graphPath: tmpDir })

      const structuralIds = (g: Graph) =>
        allEdges(g).filter(e => isStructuralEdgeType(g, e.type)).map(e => e.id).sort()
      assert.deepEqual(structuralIds(graph), structuralIds(reloaded))
      assert.equal(graph.nodesById.size, reloaded.nodesById.size)
      assertIndexIntegrity(graph)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('alias map and resolution', () => {
  it('rewriteIdPrefix rewrites only on exact-segment boundaries', () => {
    assert.equal(rewriteIdPrefix('orders.x', 'orders.x', 'orders.y'), 'orders.y')
    assert.equal(rewriteIdPrefix('orders.x.fields.a', 'orders.x', 'orders.y'), 'orders.y.fields.a')
    assert.equal(rewriteIdPrefix('orders.xy', 'orders.x', 'orders.y'), null)
    assert.equal(rewriteIdPrefix('orders.xy.fields.a', 'orders.x', 'orders.y'), null)
  })

  it('buildAliasMap maps retired id → live id from renamed-from edges', () => {
    const graph = makeGraph(
      [makeNode('orders.Schema.b')],
      [makeEdge('orders.Schema.b', 'renamed-from', 'orders.Schema.a')],
    )
    const aliasMap = buildAliasMap(graph)
    assert.deepEqual([...aliasMap.entries()], [['orders.Schema.a', 'orders.Schema.b']])
  })

  it('resolves exact hits and lets a live node win outright', () => {
    const graph = makeGraph([makeNode('orders.Schema.b'), makeNode('orders.Schema.live')])
    const aliasMap = new Map([
      ['orders.Schema.a', 'orders.Schema.b'],
      ['orders.Schema.live', 'orders.Schema.elsewhere'],
    ])
    assert.equal(resolveAlias(graph, aliasMap, 'orders.Schema.a'), 'orders.Schema.b')
    assert.equal(resolveAlias(graph, aliasMap, 'orders.Schema.live'), 'orders.Schema.live', 'live wins over alias')
  })

  it('resolves descendants of a renamed prefix without their own trail entries', () => {
    const newField = 'orders.DomainModel.order.schemas.client.fields.email'
    const graph = makeGraph([makeNode(newField, { template: 'Field' })])
    const aliasMap = new Map([[SCHEMA, `${ROOT}.schemas.client`]])
    assert.equal(resolveAlias(graph, aliasMap, FIELD), newField)
  })

  it('never rewrites a non-segment prefix (orders.x must not match orders.xy)', () => {
    const graph = makeGraph([])
    const aliasMap = new Map([['orders.x', 'orders.y']])
    assert.equal(resolveAlias(graph, aliasMap, 'orders.xy.fields.a'), 'orders.xy.fields.a')
  })

  it('resolves chains to fixpoint and guards against cycles', () => {
    const graph = makeGraph([makeNode('orders.Schema.c')])
    const chained = new Map([
      ['orders.Schema.a', 'orders.Schema.b'],
      ['orders.Schema.b', 'orders.Schema.c'],
    ])
    assert.equal(resolveAlias(graph, chained, 'orders.Schema.a'), 'orders.Schema.c')

    const cyclic = new Map([
      ['orders.Schema.a', 'orders.Schema.b'],
      ['orders.Schema.b', 'orders.Schema.a'],
    ])
    assert.equal(resolveAlias(makeGraph([]), cyclic, 'orders.Schema.a'), 'orders.Schema.a')
  })

  it('returns unresolved ids unchanged', () => {
    assert.equal(resolveAlias(makeGraph([]), new Map(), 'orders.Schema.new'), 'orders.Schema.new')
  })
})

describe('shouldRecordTrail', () => {
  it('uses default-branch membership when no override is given', () => {
    const ids = new Set([SCHEMA])
    assert.equal(shouldRecordTrail(ids, SCHEMA), true)
    assert.equal(shouldRecordTrail(ids, OTHER_SIBLING), false)
  })

  it('override always wins', () => {
    const ids = new Set([SCHEMA])
    assert.equal(shouldRecordTrail(ids, SCHEMA, false), false)
    assert.equal(shouldRecordTrail(ids, OTHER_SIBLING, true), true)
  })
})

describe('deleteNode', () => {
  it('soft deletes the owned subtree when the node is in the default branch', () => {
    const graph = makeRenameFixture()
    const result = deleteNode(graph, SCHEMA, {}, new Set([SCHEMA]))
    assert.equal(result.tier, 'soft')
    assert.deepEqual(result.affectedIds.sort(), [SCHEMA, FIELD].sort())
    assert.equal(graph.nodesById.get(SCHEMA)!.state, 'removed')
    assert.equal(graph.nodesById.get(FIELD)!.state, 'removed')
    assert.notEqual(graph.nodesById.get(SCHEMA)!.lastModifiedAt, '2026-07-01')
    // nodes and edges remain queryable
    assert.ok((graph.edgesByFrom.get(SCHEMA) ?? []).some(e => e.type === 'has-field'))
    assert.ok((graph.edgesByTo.get(SCHEMA) ?? []).some(e => e.type === 'uses-type'))
    // exact-segment: sibling untouched
    assert.equal(graph.nodesById.get(SIBLING_TRAP)!.state, 'proposed')
  })

  it('hard deletes (purges) an unmaterialised node by default, leaving no orphan edges', () => {
    const graph = makeRenameFixture()
    const result = deleteNode(graph, SCHEMA, {}, new Set())
    assert.equal(result.tier, 'hard')
    assert.ok(!graph.nodesById.has(SCHEMA))
    assert.ok(!graph.nodesById.has(FIELD))
    for (const edge of allEdges(graph)) {
      assert.ok(![edge.from, edge.to].some(id => id === SCHEMA || id === FIELD), `orphan edge survived: ${edge.id}`)
    }
    assert.ok(!graph.edgesByFrom.has(SCHEMA))
    assert.ok(!graph.edgesByTo.has(SCHEMA))
    assert.ok(!graph.edgesByTo.has(FIELD))
    // consumer's uses-type edge is gone from the consumer's bucket too
    assert.ok(!(graph.edgesByFrom.get(CONSUMER) ?? []).some(e => e.type === 'uses-type'))
    // exact-segment: trap sibling and its edges survive
    assert.ok(graph.nodesById.has(SIBLING_TRAP))
    assert.ok(graph.nodesById.has(TRAP_FIELD))
    assertIndexIntegrity(graph)
  })

  it('purge: true forces hard delete of a materialised node', () => {
    const graph = makeRenameFixture()
    const result = deleteNode(graph, SCHEMA, { purge: true }, new Set([SCHEMA]))
    assert.equal(result.tier, 'hard')
    assert.ok(!graph.nodesById.has(SCHEMA))
  })

  it('recordTrail override forces the tier in both directions', () => {
    const softGraph = makeRenameFixture()
    assert.equal(deleteNode(softGraph, SCHEMA, { recordTrail: true }, new Set()).tier, 'soft')
    assert.equal(softGraph.nodesById.get(SCHEMA)!.state, 'removed')

    const hardGraph = makeRenameFixture()
    assert.equal(deleteNode(hardGraph, SCHEMA, { recordTrail: false }, new Set([SCHEMA])).tier, 'hard')
    assert.ok(!hardGraph.nodesById.has(SCHEMA))
  })

  it('throws MutationError for a missing node and leaves the graph untouched', () => {
    const graph = makeRenameFixture()
    const before = snapshot(graph)
    assert.throws(() => deleteNode(graph, `${ROOT}.schemas.nope`, {}, new Set()), MutationError)
    assert.equal(snapshot(graph), before)
  })
})

describe('deleteEdge', () => {
  it('removes the edge from both indexes', () => {
    const graph = makeRenameFixture()
    const edgeId = `${CONSUMER}__uses-type__${SCHEMA}`
    const removed = deleteEdge(graph, edgeId)
    assert.equal(removed.id, edgeId)
    assert.ok(!(graph.edgesByFrom.get(CONSUMER) ?? []).some(e => e.id === edgeId))
    assert.ok(!(graph.edgesByTo.get(SCHEMA) ?? []).some(e => e.id === edgeId))
    assertIndexIntegrity(graph)
  })

  it('throws MutationError when the edge does not exist', () => {
    const graph = makeRenameFixture()
    const before = snapshot(graph)
    assert.throws(() => deleteEdge(graph, 'a__calls__b'), MutationError)
    assert.equal(snapshot(graph), before)
  })
})
