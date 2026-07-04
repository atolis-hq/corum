import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPacks } from '../src/loader/pack-loader.js'
import { loadClusters } from '../src/loader/cluster-loader.js'
import { loadEdges } from '../src/loader/edge-loader.js'
import { loadGraph } from '../src/loader/index.js'
import { VALID_EDGE_TYPE_SET } from '../src/loader/constants.js'
import { LoadError } from '../src/schema/index.js'
import type { Diagnostic, Node, Template } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'
import { FileGraphSource } from '../src/source/file-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

async function buildPackContentMap(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadPackContent(await source.defaultBranch())
}

async function buildGraphContentMap(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadGraphContent(await source.defaultBranch())
}

async function loadSampleClusters(diagnostics: Diagnostic[] = []) {
  const templates = loadPacks(await buildPackContentMap(), diagnostics)
  return loadClusters(await buildGraphContentMap(), templates, diagnostics)
}

describe('pack loader (ContentMap)', () => {
  it('loads templates from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(templates.has('DomainModel'))
    assert.ok(templates.has('APIEndpoint'))
    assert.ok(templates.has('Field'))
  })
})

describe('pack loader', () => {
  it('loads core, rest, domain, and messaging packs from fixture graph.yaml', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(templates.has('DomainModel'), 'DomainModel template loaded')
    assert.ok(templates.has('APIEndpoint'), 'APIEndpoint template loaded')
    assert.ok(templates.has('Field'), 'Field template loaded')
    assert.ok(templates.has('Schema'), 'Schema template loaded')
    assert.ok(templates.has('EnumDefinition'), 'EnumDefinition template loaded')
    assert.ok(templates.has('EnumValue'), 'EnumValue template loaded')
    assert.ok(templates.has('DomainEvent'), 'DomainEvent template loaded')
    assert.ok(templates.has('IntegrationEvent'), 'IntegrationEvent template loaded')
  })

  it('applies _base owned sections to all templates', async () => {
    const diagnostics: Diagnostic[] = []
    const content = await buildPackContentMap()
    for (const key of [...content.keys()]) {
      if (!key.startsWith('core/') && !key.startsWith('domain/')) content.delete(key)
    }
    const templates = loadPacks(content, diagnostics)
    const domainModel = templates.get('DomainModel')!

    assert.ok('schemas' in domainModel, 'schemas section inherited from _base')
    assert.ok('enums' in domainModel, 'enums section inherited from _base')
    const schemas = domainModel.schemas as Record<string, unknown>
    assert.equal(schemas['item-template'], 'Schema')
  })

  it('loads optional ui.displayName from template yaml', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const domainModel = templates.get('DomainModel')!

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal(domainModel.ui?.displayName, 'Domain Model')
  })

  it('handles empty pack content without crashing', () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(new Map(), diagnostics)
    assert.equal(templates.size, 0)
    assert.equal(diagnostics.length, 0)
  })
})

describe('cluster loader (ContentMap)', () => {
  it('materialises 151 nodes from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const result = loadClusters(await buildGraphContentMap(), templates, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal(result.nodes.size, 151)
  })
})

describe('cluster loader', () => {
  it('materialises 151 nodes from sample-graph fixtures', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `unexpected errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.equal(result.nodes.size, 151, `expected 151 nodes, got ${result.nodes.size}`)
  })

  it('materialises structural has-field and has-value edges', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    const allEdges = [...result.edgesByFrom.values()].flat()
    const hasFieldEdges = allEdges.filter(e => e.type === 'has-field')
    const hasValueEdges = allEdges.filter(e => e.type === 'has-value')

    assert.equal(hasFieldEdges.length, 92, `expected 92 has-field edges, got ${hasFieldEdges.length}`)
    assert.equal(hasValueEdges.length, 10, `expected 10 has-value edges, got ${hasValueEdges.length}`)
  })

  it('uses API-local order-line-item schemas for endpoint item collections', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)

    const createItems = result.nodes.get('orders.APIEndpoint.create-order.schemas.create-order-request.fields.items')
    const getItems = result.nodes.get('orders.APIEndpoint.get-order.schemas.order-response.fields.items')
    const completeItems = result.nodes.get('orders.APIEndpoint.complete-order.schemas.order-response.fields.items')

    assert.equal(createItems?.properties['$ref'], '#/schemas/order-line-item')
    assert.equal(getItems?.properties['$ref'], '#/schemas/order-line-item')
    assert.equal(completeItems?.properties['$ref'], '#/schemas/order-line-item')
  })

  it('materialises shared.Schema.problem-detail node', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)
    assert.ok(result.nodes.has('shared.Schema.problem-detail'), 'shared problem-detail schema node exists')
    assert.ok(result.nodes.has('shared.Schema.problem-detail.fields.type'), 'type field exists')
    assert.ok(result.nodes.has('shared.Schema.problem-detail.fields.detail'), 'detail field exists')
  })

  it('materialises orders.DomainModel.order.operations.complete node', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)
    assert.ok(result.nodes.has('orders.DomainModel.order.operations.complete'), 'complete operation node exists')
    assert.ok(
      result.nodes.has('orders.DomainModel.order.enums.order-status.values.completed'),
      'completed enum value exists',
    )
  })

  it('materialises orders read model nodes', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.ok(result.nodes.has('orders.ReadModel.order-detail'), 'order-detail read model exists')
    assert.ok(result.nodes.has('orders.ReadModel.order-detail.schemas.order-detail.fields.id'), 'order-detail id field')
    assert.ok(
      result.nodes.has('orders.ReadModel.order-detail.schemas.order-detail.fields.createdAt'),
      'order-detail createdAt field',
    )
    assert.ok(result.nodes.has('orders.ReadModel.order-summary'), 'order-summary read model exists')
    assert.ok(
      result.nodes.has('orders.ReadModel.order-summary.schemas.order-summary.fields.totalAmount'),
      'order-summary totalAmount field',
    )
  })

  it('materialises new orders endpoint nodes', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.ok(result.nodes.has('orders.APIEndpoint.get-order'), 'get-order endpoint exists')
    assert.ok(
      result.nodes.has('orders.APIEndpoint.get-order.schemas.order-response.fields.createdAt'),
      'createdAt field on get-order response',
    )
    assert.ok(result.nodes.has('orders.APIEndpoint.list-orders'), 'list-orders endpoint exists')
    assert.ok(
      result.nodes.has('orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.totalAmount'),
      'totalAmount on list-orders response',
    )
    assert.ok(result.nodes.has('orders.APIEndpoint.complete-order'), 'complete-order endpoint exists')
  })

  it('materialises orders domain and integration event nodes', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.ok(result.nodes.has('orders.DomainEvent.order-placed'), 'order-placed domain event')
    assert.ok(
      result.nodes.has('orders.DomainEvent.order-placed.schemas.order-placed-payload.fields.orderId'),
      'orderId field on order-placed payload',
    )
    assert.ok(result.nodes.has('orders.DomainEvent.order-completed'), 'order-completed domain event')
    assert.ok(result.nodes.has('orders.IntegrationEvent.order-placed'), 'order-placed integration event')
    assert.ok(result.nodes.has('orders.IntegrationEvent.order-completed'), 'order-completed integration event')
  })

  it('materialises payments component nodes', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.ok(result.nodes.has('payments.DomainModel.payment'), 'payment domain model')
    assert.ok(result.nodes.has('payments.DomainModel.payment.schemas.payment.fields.capturedAt'), 'capturedAt field')
    assert.ok(result.nodes.has('payments.DomainModel.payment.enums.payment-status'), 'payment-status enum')
    assert.ok(result.nodes.has('payments.DomainModel.payment.operations.capture'), 'capture operation')
    assert.ok(result.nodes.has('payments.APIEndpoint.complete-payment'), 'complete-payment endpoint')
    assert.ok(result.nodes.has('payments.DomainEvent.payment-captured'), 'payment-captured domain event')
    assert.ok(result.nodes.has('payments.IntegrationEvent.payment-captured'), 'payment-captured integration event')
    assert.ok(
      result.nodes.has('payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.paymentId'),
      'paymentId in integration event payload',
    )
  })

  it('root node inherits state and stability to child nodes', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    const field = result.nodes.get('orders.DomainModel.order.schemas.order.fields.id')
    assert.ok(field, 'field node exists')
    assert.equal(field.state, 'agreed', 'inherits state from root')
    assert.equal(field.stability, 'stable', 'inherits stability from root')
  })

  it('owned field state overrides inherited parent state when specified', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    const overridden = result.nodes.get('orders.DomainModel.order.schemas.order-line-item.fields.unitPrice')
    const inherited = result.nodes.get('orders.DomainModel.order.schemas.order-line-item.fields.quantity')
    assert.ok(overridden, 'overridden field exists')
    assert.ok(inherited, 'inherited field exists')
    assert.equal(overridden.state, 'proposed')
    assert.equal(inherited.state, 'agreed')
  })

  it('materialises correct Field node properties', async () => {
    const diagnostics: Diagnostic[] = []
    const result = await loadSampleClusters(diagnostics)

    const field = result.nodes.get('orders.DomainModel.order.schemas.order.fields.id')!
    assert.equal(field.template, 'Field')
    assert.equal(field.component, 'orders')
    assert.equal(field.properties.type, 'uuid')
    assert.equal(field.properties.nullable, false)
    assert.equal(field.properties.collection, undefined)
  })

  it('warns and falls back on an invalid root node state', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const content: ContentMap = new Map([
      ['components/orders/DomainModels/bad-state.yaml', [
        'id: orders.DomainModel.bad-state',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: bogus',
        '  stability: unstable',
        '  lastModifiedAt: "2026-01-01"',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes("invalid state 'bogus'")))
    assert.equal(result.nodes.get('orders.DomainModel.bad-state')?.state, 'proposed', 'falls back to default state')
  })

  it('warns and falls back on an invalid owned-child stability', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    const content: ContentMap = new Map([
      ['components/orders/DomainModels/bad-child-stability.yaml', [
        'id: orders.DomainModel.bad-child-stability',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: agreed',
        '  stability: stable',
        '  lastModifiedAt: "2026-01-01"',
        'schemas:',
        '  item:',
        '    stability: bogus',
        '    fields:',
        '      id:',
        '        type: uuid',
        '        nullable: false',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes("invalid stability 'bogus'")))
    assert.equal(
      result.nodes.get('orders.DomainModel.bad-child-stability.schemas.item')?.stability,
      'stable',
      'falls back to inherited parent stability',
    )
  })
})

describe('edge loader', () => {
  it('shares valid explicit edge types from loader constants', () => {
    assert.ok(VALID_EDGE_TYPE_SET.has('reads'))
    assert.ok(VALID_EDGE_TYPE_SET.has('maps-to'))
    assert.ok(!VALID_EDGE_TYPE_SET.has('unknown'))
  })

  it('loads 65 explicit edges from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = loadEdges(await buildGraphContentMap(), clusters.nodes, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal([...edgeResult.edgesByFrom.values()].flat().length, 65)
  })

  it('loads 65 explicit edges from edge files', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = loadEdges(await buildGraphContentMap(), clusters.nodes, diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `unexpected errors: ${JSON.stringify(diagnostics)}`,
    )
    const allExplicitEdges = [...edgeResult.edgesByFrom.values()].flat()
    assert.equal(allExplicitEdges.length, 65, `expected 65 explicit edges, got ${allExplicitEdges.length}`)
  })

  it('derives edge ID as {from}__{type}__{to}', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = loadEdges(await buildGraphContentMap(), clusters.nodes, diagnostics)

    const all = [...edgeResult.edgesByFrom.values()].flat()
    const readsEdge = all.find(e => e.type === 'reads')!
    assert.ok(readsEdge, 'reads edge exists')
    assert.equal(readsEdge.id, `${readsEdge.from}__reads__${readsEdge.to}`)
  })

  it('applies default state and stability when omitted', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = loadEdges(await buildGraphContentMap(), clusters.nodes, diagnostics)

    const all = [...edgeResult.edgesByFrom.values()].flat()
    const mapsToEdge = all.find(e => e.type === 'maps-to')!
    assert.ok(mapsToEdge, 'maps-to edge exists')
    assert.equal(mapsToEdge.state, 'proposed')
    assert.equal(mapsToEdge.stability, 'unstable')
  })

  it('reports warning for unresolved edge endpoint', async () => {
    const diagnostics: Diagnostic[] = []
    loadEdges(await buildGraphContentMap(), new Map<string, Node>(), diagnostics)
    const warnings = diagnostics.filter(d => d.severity === 'warning')
    assert.ok(warnings.length > 0, 'expected warnings for unresolved endpoints')
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('warns and falls back on an invalid edge state, without erroring', () => {
    const nodes = new Map<string, Node>([
      ['a.DomainModel.a', { id: 'a.DomainModel.a', template: 'DomainModel', component: 'a', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
      ['b.DomainModel.b', { id: 'b.DomainModel.b', template: 'DomainModel', component: 'b', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
    ])
    const content: ContentMap = new Map([
      ['edges/bad.edges.yaml', 'edges:\n  - from: a.DomainModel.a\n    to: b.DomainModel.b\n    type: reads\n    state: bogus\n'],
    ])
    const diagnostics: Diagnostic[] = []
    const result = loadEdges(content, nodes, diagnostics)

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('invalid edge state')))
    const edge = [...result.edgesByFrom.values()].flat()[0]
    assert.equal(edge.state, 'proposed', 'falls back to default state')
  })

  it('warns and falls back on an invalid edge stability, without erroring', () => {
    const nodes = new Map<string, Node>([
      ['a.DomainModel.a', { id: 'a.DomainModel.a', template: 'DomainModel', component: 'a', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
      ['b.DomainModel.b', { id: 'b.DomainModel.b', template: 'DomainModel', component: 'b', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
    ])
    const content: ContentMap = new Map([
      ['edges/bad.edges.yaml', 'edges:\n  - from: a.DomainModel.a\n    to: b.DomainModel.b\n    type: reads\n    stability: bogus\n'],
    ])
    const diagnostics: Diagnostic[] = []
    const result = loadEdges(content, nodes, diagnostics)

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('invalid edge stability')))
    const edge = [...result.edgesByFrom.values()].flat()[0]
    assert.equal(edge.stability, 'unstable', 'falls back to default stability')
  })

  it('loads a hidden-type edge with a dangling to (retired id) without any diagnostic', () => {
    const nodes = new Map<string, Node>([
      ['a.DomainModel.new', { id: 'a.DomainModel.new', template: 'DomainModel', component: 'a', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
    ])
    const content: ContentMap = new Map([
      ['edges/trail.edges.yaml', 'edges:\n  - from: a.DomainModel.new\n    to: a.DomainModel.old\n    type: renamed-from\n'],
    ])
    const diagnostics: Diagnostic[] = []
    const result = loadEdges(content, nodes, diagnostics)

    assert.equal(diagnostics.length, 0, `expected no diagnostics, got: ${JSON.stringify(diagnostics)}`)
    const edge = [...result.edgesByFrom.values()].flat()[0]
    assert.ok(edge, 'renamed-from edge must be loaded despite the retired to')
    assert.equal(edge.id, 'a.DomainModel.new__renamed-from__a.DomainModel.old')
    assert.equal(result.edgesByTo.get('a.DomainModel.old')?.length, 1, 'edge indexed by its retired to id')
  })

  it('errors and drops a hidden-type edge whose from (live end) does not resolve', () => {
    const content: ContentMap = new Map([
      ['edges/trail.edges.yaml', 'edges:\n  - from: a.DomainModel.missing\n    to: a.DomainModel.old\n    type: renamed-from\n'],
    ])
    const diagnostics: Diagnostic[] = []
    const result = loadEdges(content, new Map<string, Node>(), diagnostics)

    assert.ok(
      diagnostics.some(d => d.severity === 'error' && d.message.includes("hidden edge type 'renamed-from' requires a live 'from' node: a.DomainModel.missing")),
      `expected a live-end error, got: ${JSON.stringify(diagnostics)}`,
    )
    assert.equal([...result.edgesByFrom.values()].flat().length, 0, 'edge must be dropped')
  })

  it('keeps warn-and-drop behaviour for a non-hidden edge with a dangling to', () => {
    const nodes = new Map<string, Node>([
      ['a.DomainModel.a', { id: 'a.DomainModel.a', template: 'DomainModel', component: 'a', state: 'proposed', stability: 'unstable', schemaVersion: '1', lastModifiedAt: '2026-01-01', properties: {} }],
    ])
    const content: ContentMap = new Map([
      ['edges/broken.edges.yaml', 'edges:\n  - from: a.DomainModel.a\n    to: a.DomainModel.gone\n    type: reads\n'],
    ])
    const diagnostics: Diagnostic[] = []
    const result = loadEdges(content, nodes, diagnostics)

    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('edge to unresolved node: a.DomainModel.gone')))
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal([...result.edgesByFrom.values()].flat().length, 0, 'non-hidden dangling edge is still dropped')
  })
})

describe('loadGraph', () => {
  it('loads 151 nodes and 178 edges using FileGraphSource', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graph = await loadGraph({ source })
    assert.equal(graph.nodesById.size, 151)
    assert.equal([...graph.edgesByFrom.values()].flat().length, 178)
  })

  it('loads packsPath when graph.yaml is absent', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-no-graph-yaml-'))
    try {
      const componentsDir = path.join(tmp, 'components', 'shared')
      fs.mkdirSync(componentsDir, { recursive: true })
      fs.writeFileSync(
        path.join(componentsDir, 'problem-detail.yaml'),
        'id: shared.Schema.problem-detail\ntemplate: Schema\nschemaVersion: "1.0"\nmetadata:\n  component: shared\n  state: agreed\n  stability: stable\n  lastModifiedAt: "2026-01-01"\n',
      )

      const graph = await loadGraph({
        graphPath: tmp,
        packsPath: path.join(repoRoot, '.corum/packs/core'),
      })

      assert.ok(graph.templates.has('Schema'))
      assert.ok(graph.nodesById.has('shared.Schema.problem-detail'))
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('loads full sample-graph with 151 nodes and 178 edges', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    assert.equal(graph.nodesById.size, 151, `expected 151 nodes, got ${graph.nodesById.size}`)
    const allEdges = [...graph.edgesByFrom.values()].flat()
    assert.equal(allEdges.length, 178, `expected 178 edges, got ${allEdges.length}`)
  })

  it('does not throw in strict mode for the valid fixture', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    assert.ok(graph.nodesById.size > 0)
  })

  it('returns diagnostics without throwing in lenient mode', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir, strict: false })
    assert.equal(graph.diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('throws LoadError with all diagnostics when strict and errors exist', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-bad-graph-'))
    try {
      fs.cpSync(fixtureGraphDir, tmp, { recursive: true })
      fs.writeFileSync(
        path.join(tmp, 'edges', 'broken.edges.yaml'),
        'edges:\n  - from: missing.Node\n    to: orders.DomainModel.order\n    type: reads\n',
      )

      await assert.rejects(
        () => loadGraph({ graphPath: tmp }),
        (err: unknown) => {
          assert.ok(err instanceof LoadError)
          assert.ok(err.diagnostics.some(d => d.message.includes('missing.Node')))
          return true
        },
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('cluster loader — Mapping nodes', () => {
  it('materialises Mapping nodes from a mappings section', () => {
    const templates = new Map<string, Template>()
    templates.set('DomainModel', {
      name: 'DomainModel',
      info: { version: '1.0.0' },
      mappings: { 'item-template': 'Mapping' },
      schemas: { 'item-template': 'Schema' },
      enums: { 'item-template': 'EnumDefinition' },
    } as unknown as Template)
    templates.set('Mapping', {
      name: 'Mapping',
      info: { version: '1.0.0', core: true },
    } as Template)

    const clusterYaml = [
      'id: orders.DomainModel.order',
      'template: DomainModel',
      'schemaVersion: "1"',
      'metadata:',
      '  component: orders',
      '  state: agreed',
      '  stability: stable',
      '  lastModifiedAt: "2026-01-01"',
      'mappings:',
      '  surcharge-by-zone:',
      '    key-ref: orders.DomainModel.order.enums.shipping-zone',
      '    type: string',
    ].join('\n')

    const content: ContentMap = new Map([
      ['components/orders/DomainModels/order.yaml', clusterYaml],
    ])

    const diagnostics: Diagnostic[] = []
    const result = loadClusters(content, templates, diagnostics)

    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `unexpected errors: ${JSON.stringify(diagnostics)}`,
    )
    assert.ok(result.nodes.has('orders.DomainModel.order'), 'root node exists')
    assert.ok(
      result.nodes.has('orders.DomainModel.order.mappings.surcharge-by-zone'),
      'mapping node exists',
    )

    const mapping = result.nodes.get('orders.DomainModel.order.mappings.surcharge-by-zone')!
    assert.equal(mapping.template, 'Mapping')
    assert.equal(mapping.component, 'orders')
    assert.equal(mapping.properties['key-ref'], 'orders.DomainModel.order.enums.shipping-zone')
    assert.equal(mapping.properties['type'], 'string')
  })

  it('Mapping node inherits state and stability from parent', () => {
    const templates = new Map<string, Template>()
    templates.set('DomainModel', {
      name: 'DomainModel',
      info: { version: '1.0.0' },
      mappings: { 'item-template': 'Mapping' },
    } as unknown as Template)
    templates.set('Mapping', {
      name: 'Mapping',
      info: { version: '1.0.0', core: true },
    } as Template)

    const clusterYaml = [
      'id: payments.DomainModel.payment',
      'template: DomainModel',
      'schemaVersion: "1"',
      'metadata:',
      '  component: payments',
      '  state: implemented',
      '  stability: stable',
      '  lastModifiedAt: "2026-01-01"',
      'mappings:',
      '  carrier-rates:',
      '    type: decimal',
    ].join('\n')

    const content: ContentMap = new Map([
      ['components/payments/DomainModels/payment.yaml', clusterYaml],
    ])

    const diagnostics: Diagnostic[] = []
    const result = loadClusters(content, templates, diagnostics)

    const mapping = result.nodes.get('payments.DomainModel.payment.mappings.carrier-rates')!
    assert.ok(mapping, 'mapping node exists')
    assert.equal(mapping.state, 'implemented', 'inherits state from parent')
    assert.equal(mapping.stability, 'stable', 'inherits stability from parent')
  })

  it('pack loader includes Mapping template after loading core pack', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(templates.has('Mapping'), 'Mapping template loaded')
    const mapping = templates.get('Mapping')!
    assert.equal(mapping.info.core, true)
  })
})

describe('cluster loader — structural uses-type edges', () => {
  it('auto-generates a uses-type edge from a field with a global node-ref $ref', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, 'pack load errors')

    const content: ContentMap = new Map([
      ['components/orders/DomainModels/cross-ref-test.yaml', [
        'id: orders.DomainModel.cross-ref-test',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
        'schemas:',
        '  item:',
        '    fields:',
        '      price:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
      ].join('\n')],
      ['components/payments/DomainModels/payment.yaml', [
        'id: payments.DomainModel.payment',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: payments',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)
    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `load errors: ${JSON.stringify(diagnostics.filter(d => d.severity === 'error'))}`,
    )

    const allEdges = [...result.edgesByFrom.values()].flat()
    const structuralUsesType = allEdges.filter(e => e.type === 'uses-type' && e.generated === true)

    assert.ok(structuralUsesType.length > 0, 'expected at least one structural uses-type edge')

    const edge = structuralUsesType.find(
      e => e.from === 'orders.DomainModel.cross-ref-test' && e.to === 'payments.DomainModel.payment',
    )
    assert.ok(edge, 'expected uses-type edge from orders.DomainModel.cross-ref-test to payments.DomainModel.payment')
    assert.strictEqual(edge!.generated, true)
    assert.strictEqual(edge!.from, 'orders.DomainModel.cross-ref-test')
  })

  it('deduplicates structural uses-type edges when multiple fields reference the same external node', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)

    const content: ContentMap = new Map([
      ['components/orders/DomainModels/multi-ref-test.yaml', [
        'id: orders.DomainModel.multi-ref-test',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
        'schemas:',
        '  first:',
        '    fields:',
        '      price:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
        '  second:',
        '    fields:',
        '      amount:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)

    const allEdges = [...result.edgesByFrom.values()].flat()
    const usesTypeToPayment = allEdges.filter(
      e => e.type === 'uses-type' && e.to === 'payments.DomainModel.payment' && e.generated === true,
    )
    assert.equal(usesTypeToPayment.length, 1, 'duplicate uses-type edges must be de-duplicated')
  })
})
