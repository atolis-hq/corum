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
import type { Diagnostic, Node } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const samplePackDirs = [
  path.join(repoRoot, '.corum/packs/core'),
  path.join(repoRoot, '.corum/packs/rest'),
  path.join(repoRoot, '.corum/packs/domain'),
  path.join(repoRoot, '.corum/packs/messaging'),
]

async function loadSampleClusters(diagnostics: Diagnostic[] = []) {
  const templates = await loadPacks(samplePackDirs, diagnostics)
  return loadClusters(fixtureGraphDir, templates, diagnostics)
}

describe('pack loader', () => {
  it('loads core, rest, domain, and messaging packs from fixture graph.yaml', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = await loadPacks(samplePackDirs, diagnostics)

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
    const templates = await loadPacks(
      [path.join(repoRoot, '.corum/packs/core'), path.join(repoRoot, '.corum/packs/domain')],
      diagnostics,
    )
    const domainModel = templates.get('DomainModel')!

    assert.ok('schemas' in domainModel, 'schemas section inherited from _base')
    assert.ok('enums' in domainModel, 'enums section inherited from _base')
    const schemas = domainModel.schemas as Record<string, unknown>
    assert.equal(schemas['item-template'], 'Schema')
  })

  it('loads optional ui.displayName from template yaml', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = await loadPacks(samplePackDirs, diagnostics)
    const domainModel = templates.get('DomainModel')!

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal(domainModel.ui?.displayName, 'Domain Model')
  })

  it('reports warning for missing pack template directory without crashing', async () => {
    const diagnostics: Diagnostic[] = []
    await loadPacks([path.join(repoRoot, 'nonexistent-pack')], diagnostics)
    assert.ok(diagnostics.some(d => d.severity === 'warning'))
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
    assert.equal(field.properties.cardinality, 'one')
  })
})

describe('edge loader', () => {
  it('shares valid explicit edge types from loader constants', () => {
    assert.ok(VALID_EDGE_TYPE_SET.has('reads'))
    assert.ok(VALID_EDGE_TYPE_SET.has('maps-to'))
    assert.ok(!VALID_EDGE_TYPE_SET.has('unknown'))
  })

  it('loads 65 explicit edges from edge files', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = await loadEdges(fixtureGraphDir, clusters.nodes, diagnostics)

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
    const edgeResult = await loadEdges(fixtureGraphDir, clusters.nodes, diagnostics)

    const all = [...edgeResult.edgesByFrom.values()].flat()
    const readsEdge = all.find(e => e.type === 'reads')!
    assert.ok(readsEdge, 'reads edge exists')
    assert.equal(readsEdge.id, `${readsEdge.from}__reads__${readsEdge.to}`)
  })

  it('applies default state and stability when omitted', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const edgeResult = await loadEdges(fixtureGraphDir, clusters.nodes, diagnostics)

    const all = [...edgeResult.edgesByFrom.values()].flat()
    const mapsToEdge = all.find(e => e.type === 'maps-to')!
    assert.ok(mapsToEdge, 'maps-to edge exists')
    assert.equal(mapsToEdge.state, 'proposed')
    assert.equal(mapsToEdge.stability, 'unstable')
  })

  it('strict: reports error for unresolved edge endpoint', async () => {
    const diagnostics: Diagnostic[] = []
    await loadEdges(fixtureGraphDir, new Map<string, Node>(), diagnostics)
    const errors = diagnostics.filter(d => d.severity === 'error')
    assert.ok(errors.length > 0, 'expected errors for unresolved endpoints')
  })
})

describe('loadGraph', () => {
  it('loads full sample-graph with 151 nodes and 167 edges', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    assert.equal(graph.nodesById.size, 151, `expected 151 nodes, got ${graph.nodesById.size}`)
    const allEdges = [...graph.edgesByFrom.values()].flat()
    assert.equal(allEdges.length, 167, `expected 167 edges, got ${allEdges.length}`)
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
