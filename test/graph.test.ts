import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computeClusterOverlay, listNodes, getCluster, getLinkedFields, getGraphSummary, searchNodes, getLineage } from '../src/graph/index.js'
import { loadGraph } from '../src/loader/index.js'
import { QueryError } from '../src/schema/index.js'
import type { Edge, Graph, MultiGraph, Node, Template } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

function createNode(id: string): Node {
  return {
    id,
    template: 'DomainEvent',
    namespace: 'orders',
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

function createRenamedLineageGraph(): Graph {
  // orders.Schema.customer-email was renamed to orders.Schema.email-address
  // (renamed-from trail edge with intentionally dangling `to`); a stale edge
  // still references the retired ID.
  const endpoint = createNode('orders.APIEndpoint.create-order')
  const emailSchema = createNode('orders.Schema.email-address')
  const audit = createNode('orders.DomainEvent.email-changed')
  const staleEdge = createEdge('stale-produces', endpoint.id, 'orders.Schema.customer-email')
  const liveEdge = createEdge('live-produces', emailSchema.id, audit.id)
  const trailEdge: Edge = {
    id: 'orders.Schema.email-address__renamed-from__orders.Schema.customer-email',
    from: emailSchema.id,
    to: 'orders.Schema.customer-email',
    type: 'renamed-from',
    state: 'proposed',
    stability: 'unstable',
  }

  return {
    nodesById: new Map([endpoint, emailSchema, audit].map(node => [node.id, node])),
    edgesByFrom: new Map([
      [endpoint.id, [staleEdge]],
      [emailSchema.id, [liveEdge, trailEdge]],
    ]),
    edgesByTo: new Map([
      ['orders.Schema.customer-email', [staleEdge, trailEdge]],
      [audit.id, [liveEdge]],
    ]),
    templates: new Map(),
    diagnostics: [],
  }
}

function createRenamedLinkedFieldsGraph(): Graph {
  // orders.Schema.customer was renamed to orders.Schema.order; a maps-to edge
  // authored before the rename still targets a field under the retired prefix.
  const fieldTemplate: Template = { name: 'Field', info: { version: '1.0', role: 'field' } }
  const root: Node = { ...createNode('orders.Schema.order'), template: 'Schema' }
  const field: Node = { ...createNode('orders.Schema.order.fields.email'), template: 'Field', parentId: root.id }
  const external: Node = { ...createNode('api.Schema.request.fields.email'), template: 'Field' }
  const staleMapsTo: Edge = {
    id: 'api.Schema.request.fields.email__maps-to__orders.Schema.customer.fields.email',
    from: external.id,
    to: 'orders.Schema.customer.fields.email',
    type: 'maps-to',
    state: 'proposed',
    stability: 'unstable',
  }
  const trailEdge: Edge = {
    id: 'orders.Schema.order__renamed-from__orders.Schema.customer',
    from: root.id,
    to: 'orders.Schema.customer',
    type: 'renamed-from',
    state: 'proposed',
    stability: 'unstable',
  }

  return {
    nodesById: new Map([root, field, external].map(node => [node.id, node])),
    edgesByFrom: new Map([
      [external.id, [staleMapsTo]],
      [root.id, [trailEdge]],
    ]),
    edgesByTo: new Map([
      ['orders.Schema.customer.fields.email', [staleMapsTo]],
      ['orders.Schema.customer', [trailEdge]],
    ]),
    templates: new Map([[fieldTemplate.name, fieldTemplate]]),
    diagnostics: [],
  }
}

function createDerivedFieldGraph(): Graph {
  // total is computed from amount; formatted is computed from total.
  const fieldTemplate: Template = { name: 'Field', info: { version: '1.0', role: 'field' } }
  const root: Node = { ...createNode('orders.Schema.source'), template: 'Schema' }
  const field = (name: string): Node => ({ ...createNode(`orders.Schema.source.fields.${name}`), template: 'Field', parentId: root.id })
  const amount = field('amount')
  const total = field('total')
  const formatted = field('formatted')
  const derived = (from: Node, to: Node): Edge => ({
    ...createEdge(`${from.id}__derived-from__${to.id}`, from.id, to.id),
    type: 'derived-from',
  })
  const edges = [derived(total, amount), derived(formatted, total)]
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const e of edges) {
    edgesByFrom.set(e.from, [...(edgesByFrom.get(e.from) ?? []), e])
    edgesByTo.set(e.to, [...(edgesByTo.get(e.to) ?? []), e])
  }
  return {
    nodesById: new Map([root, amount, total, formatted].map(n => [n.id, n])),
    edgesByFrom,
    edgesByTo,
    templates: new Map([[fieldTemplate.name, fieldTemplate]]),
    diagnostics: [],
  }
}

describe('derived-from field lineage', () => {
  const g = createDerivedFieldGraph()
  const amount = 'orders.Schema.source.fields.amount'
  const total = 'orders.Schema.source.fields.total'
  const formatted = 'orders.Schema.source.fields.formatted'

  it('downstream from an input reaches the fields computed from it', () => {
    const result = getLineage(g, [amount], { depth: 2 })
    const byId = new Map(result.nodes.map(n => [n.id, n]))
    assert.equal(byId.get(total)?.depth, 1)
    assert.equal(byId.get(total)?.via_edge_type, 'derived-from')
    assert.equal(byId.get(formatted)?.depth, 2)
    assert.ok(result.edges.every(e => e.type === 'derived-from'))
  })

  it('upstream from a computed field reaches its inputs', () => {
    const result = getLineage(g, [formatted], { direction: 'upstream', depth: 2 })
    const fields = result.nodes.filter(n => n.via_edge_type === 'derived-from')
    assert.deepEqual(fields.map(n => n.id).sort(), [amount, total].sort())
  })

  it('does not walk derived-from against data flow', () => {
    assert.deepEqual(getLineage(g, [formatted], { depth: 2 }).nodes, [])
    const up = getLineage(g, [amount], { direction: 'upstream', depth: 2 })
    assert.ok(up.nodes.every(n => n.via_edge_type !== 'derived-from'))
  })

  it('edge_types maps-to limits lineage to copies', () => {
    assert.deepEqual(getLineage(g, [amount], { edgeTypes: ['maps-to'], depth: 2 }).nodes, [])
  })

  it('a root with derived-from listed explicitly seeds its fields', () => {
    const result = getLineage(g, ['orders.Schema.source'], { edgeTypes: ['derived-from'], depth: 2 })
    // Owned fields are seeded, so they are the origin set; their derivation edges are returned.
    assert.equal(result.edges.length, 2)
    assert.ok(result.edges.every(e => e.type === 'derived-from'))
  })

  it('getLinkedFields returns derived-from edges and honours edgeTypes', () => {
    const all = getLinkedFields(g, 'orders.Schema.source')
    assert.equal(all.edges.length, 2)
    assert.ok(all.edges.every(e => e.type === 'derived-from'))
    assert.deepEqual(getLinkedFields(g, 'orders.Schema.source', { edgeTypes: ['maps-to'] }).edges, [])
  })
})

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
      const ordersNodes = listNodes(graph, { namespace: 'orders' })
      assert.equal(ordersNodes.length, 113)
    })

    it('filters by state', () => {
      const agreedNodes = listNodes(graph, { state: 'agreed' })
      assert.ok(agreedNodes.length > 0)
      assert.ok(agreedNodes.every(n => n.state === 'agreed'))
    })

    it('filters by multiple criteria', () => {
      const apiEndpoints = listNodes(graph, { templates: ['APIEndpoint'], namespace: 'orders' })
      assert.equal(apiEndpoints.length, 4)
      assert.ok(apiEndpoints.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })
  })

  describe('getCluster', () => {
    it('uses transitive ownership for prefix-related roots and internal edges', () => {
      const root = createNode('orders.Schema.foo')
      const other = createNode(root.id + '.bar')
      const schema = { ...createNode(root.id + '.schemas.data'), parentId: root.id }
      const field = { ...createNode(schema.id + '.fields.value'), parentId: schema.id }
      const otherField = { ...createNode(other.id + '.fields.value'), parentId: other.id }
      const internal = createEdge('internal', schema.id, field.id)
      const external = createEdge('external', field.id, otherField.id)
      const ownedGraph: Graph = {
        ...graph,
        nodesById: new Map([root, other, schema, field, otherField].map(node => [node.id, node])),
        edgesByFrom: new Map([[schema.id, [internal]], [field.id, [external]]]),
        edgesByTo: new Map([[field.id, [internal]], [otherField.id, [external]]]),
      }
      assert.deepEqual(getCluster(ownedGraph, root.id).children, [schema, field])
      assert.deepEqual(getCluster(ownedGraph, root.id).edges, [internal])
      assert.deepEqual(getCluster(ownedGraph, other.id).children, [otherField])
      assert.deepEqual(getCluster(ownedGraph, schema.id).children, [field])
      const branch = { ref: 'feature', isDefault: false, graph: ownedGraph }
      const multi: MultiGraph = {
        default: { ref: 'main', isDefault: true, graph: { ...ownedGraph, nodesById: new Map() } },
        branches: [branch], branchResults: [],
        overlay: viewingRef => ({
          viewingRef, edges: new Map(),
          nodes: new Map([...ownedGraph.nodesById.values()].map(node => [node.id, {
            id: node.id, ghostState: 'ghost-single', presence: new Map([['feature', node]]),
          }])),
        }),
        diff: () => { throw new Error('unused') },
      }
      assert.deepEqual(computeClusterOverlay(multi, 'main', ['feature'], root.id)?.fields.map(node => node.id), [schema.id, field.id])
      assert.deepEqual(computeClusterOverlay(multi, 'main', ['feature'], other.id)?.fields.map(node => node.id), [otherField.id])
    })

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

    it('resolves maps-to edges referencing retired field IDs to the live field', () => {
      const renamedGraph = createRenamedLinkedFieldsGraph()
      const result = getLinkedFields(renamedGraph, 'orders.Schema.order')
      assert.deepEqual(result.edges.map(e => e.id), ['api.Schema.request.fields.email__maps-to__orders.Schema.customer.fields.email'])
      const nodeIds = new Set(result.nodes.map(n => n.id))
      assert.ok(nodeIds.has('orders.Schema.order.fields.email'))
      assert.ok(nodeIds.has('api.Schema.request.fields.email'))
    })

    it('resolves a retired input ID to the live cluster root', () => {
      const renamedGraph = createRenamedLinkedFieldsGraph()
      const result = getLinkedFields(renamedGraph, 'orders.Schema.customer')
      assert.equal(result.edges.length, 1)
      assert.ok(result.nodes.some(n => n.id === 'orders.Schema.order.fields.email'))
    })
  })

  describe('field-level lineage and field filter', () => {
    const fromField = 'orders.APIEndpoint.complete-order.schemas.order-response.fields.createdAt'
    const toField = 'orders.ReadModel.order-detail.schemas.order-detail.fields.createdAt'

    it('getLinkedFields field filter narrows by name and full ID; unknown is empty', () => {
      const all = getLinkedFields(graph, 'orders.ReadModel.order-detail')
      const byName = getLinkedFields(graph, 'orders.ReadModel.order-detail', { field: 'createdAt' })
      assert.ok(byName.edges.length > 0 && byName.edges.length < all.edges.length)
      assert.ok(byName.edges.some(e => e.to === toField))
      const byId = getLinkedFields(graph, 'orders.ReadModel.order-detail', { field: toField })
      assert.deepEqual(byId.edges.map(e => e.id), byName.edges.map(e => e.id))
      assert.deepEqual(getLinkedFields(graph, 'orders.ReadModel.order-detail', { field: 'noSuchField' }).edges, [])
    })

    it('field-start maps-to traversal returns field nodes and edges', () => {
      const result = getLineage(graph, [fromField], { edgeTypes: ['maps-to'], depth: 1 })
      assert.ok(result.nodes.some(n => n.id === toField && n.depth === 1 && n.via_edge_type === 'maps-to'))
      assert.ok(result.edges.some(e => e.from === fromField && e.to === toField))
    })

    it('upstream field-start traversal works', () => {
      const result = getLineage(graph, [toField], { edgeTypes: ['maps-to'], direction: 'upstream', depth: 1 })
      assert.ok(result.nodes.some(n => n.id === fromField))
    })

    it('root-start with maps-to reaches the fields getLinkedFields links', () => {
      const root = 'orders.APIEndpoint.complete-order'
      const lineage = getLineage(graph, [root], { edgeTypes: ['maps-to'], depth: 1 })
      const linked = getLinkedFields(graph, root)
      const downstreamIds = new Set(linked.edges.filter(e => e.from.startsWith(root + '.')).map(e => e.to))
      assert.ok(downstreamIds.size > 0)
      for (const id of downstreamIds) assert.ok(lineage.nodes.some(n => n.id === id), id)
    })

    it('without maps-to a root start is unchanged (no field nodes)', () => {
      const result = getLineage(graph, ['orders.APIEndpoint.complete-order'], { edgeTypes: ['calls'], depth: 1 })
      assert.ok(!result.nodes.some(n => n.id.includes('.fields.')))
    })

    it('default edge types never pull in fields from a root start (downstream and both)', () => {
      for (const direction of ['downstream', 'both'] as const) {
        const result = getLineage(graph, ['orders.APIEndpoint.complete-order'], { direction, depth: 3 })
        assert.ok(!result.nodes.some(n => n.id.includes('.fields.')), `${direction}: no field nodes`)
        assert.ok(!result.edges.some(e => e.type === 'maps-to'), `${direction}: no maps-to edges`)
      }
    })

    it('resolves a maps-to endpoint that references a retired field ID to the live field', () => {
      const renamed = createRenamedLinkedFieldsGraph()
      const result = getLineage(renamed, ['api.Schema.request.fields.email'], { edgeTypes: ['maps-to'], depth: 1 })
      assert.ok(result.nodes.some(n => n.id === 'orders.Schema.order.fields.email'))
    })

    it('terminates on a maps-to cycle', () => {
      const back = createEdge(`${toField}__maps-to__${fromField}`, toField, fromField)
      back.type = 'maps-to'
      const g: Graph = { ...graph, edgesByFrom: new Map(graph.edgesByFrom), edgesByTo: new Map(graph.edgesByTo) }
      g.edgesByFrom.set(toField, [...(g.edgesByFrom.get(toField) ?? []), back])
      g.edgesByTo.set(fromField, [...(g.edgesByTo.get(fromField) ?? []), back])
      const result = getLineage(g, [fromField], { edgeTypes: ['maps-to'], depth: 6 })
      assert.ok(result.nodes.some(n => n.id === toField))
    })
  })

  describe('getGraphSummary', () => {
    it('returns correct node and component counts', () => {
      const summary = getGraphSummary(graph)
      assert.equal(summary.nodeCount, 151)
      assert.equal(summary.namespaceCount, 3)
      assert.deepEqual(summary.namespacesByKind, { component: 3 })
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
      assert.ok(summary.nodesByNamespace.orders > 0)
      assert.ok(summary.nodesByNamespace.payments > 0)
      assert.equal(
        Object.values(summary.nodesByTemplate).reduce<number>((a, b) => a + b, 0),
        summary.nodeCount,
      )
      assert.equal(
        Object.values(summary.nodesByNamespace).reduce<number>((a, b) => a + b, 0),
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

    it('upstream direction retains parent-only ancestors reached via the synthetic parent hop', () => {
      const result = getLineage(graph, ['orders.DomainModel.order.operations.place'], {
        direction: 'upstream',
        depth: 1,
        edgeTypes: ['triggers'],
        excludeNodeTypes: [],
      })
      assert.ok(
        result.nodes.some((n: { id: string }) => n.id === 'orders.DomainModel.order'),
        'the parent reached via the synthetic parent hop should stay in the result even without a visible edge',
      )
      assert.ok(
        result.nodes.some((n: { via_edge_type?: string }) => n.via_edge_type === 'parent'),
        'the returned annotation should preserve that this hop came from the synthetic parent traversal',
      )
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

    it('traverses an edge referencing a retired ID through to the live node', () => {
      const renamedGraph = createRenamedLineageGraph()
      const result = getLineage(renamedGraph, ['orders.APIEndpoint.create-order'], { depth: 2 })
      const ids = result.nodes.map(n => n.id)
      assert.ok(ids.includes('orders.Schema.email-address'), 'stale edge endpoint resolves to the live node')
      assert.ok(ids.includes('orders.DomainEvent.email-changed'), 'traversal continues from the resolved node')
      assert.ok(result.edges.some(e => e.id === 'stale-produces'), 'the stale edge is included as authored')
    })

    it('excludes hidden renamed-from edges from lineage defaults', () => {
      const renamedGraph = createRenamedLineageGraph()
      const result = getLineage(renamedGraph, ['orders.APIEndpoint.create-order'], { depth: 2, direction: 'both' })
      assert.ok(result.nodes.every(n => n.via_edge_type !== 'renamed-from'))
      assert.ok(result.edges.every(e => e.type !== 'renamed-from'))
    })

    it('resolves a retired start ID to the live node', () => {
      const renamedGraph = createRenamedLineageGraph()
      const result = getLineage(renamedGraph, ['orders.Schema.customer-email'], { depth: 1 })
      assert.deepEqual(result.nodes.map(n => n.id), ['orders.DomainEvent.email-changed'])
    })
  })
})
