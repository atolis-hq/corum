import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { loadGraph } from '../src/loader/index.js'
import { saveGraph, serializeGraph } from '../src/writer/graph-writer.js'
import type { Edge } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('serializeGraph', () => {
  it('returns a ContentMap with cluster and edge yaml', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const map = serializeGraph(graph)
    const keys = [...map.keys()]
    assert.ok(keys.some(k => k.startsWith('components/') && k.endsWith('.yaml')))
    assert.ok(keys.some(k => k.startsWith('edges/')))
    assert.ok(keys.some(k => k === 'graph.yaml'))
  })

  it('ContentMap round-trips through loadGraph', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-serialize-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const map = serializeGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
      for (const [key, content] of map) {
        const filePath = path.join(tmpDir, ...key.split('/'))
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
      }
      const reloaded = await loadGraph({ graphPath: tmpDir })
      assert.equal(reloaded.nodesById.size, 151)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('writes extractedFrom into metadata block and reloads it', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-metadata-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const root = graph.nodesById.get('orders.DomainModel.order')
      assert.ok(root)
      root.extractedFrom = './specs/orders-api.yaml'
      root.derivation = 'determined'
      root.derivedBy = 'adapter:openapi'

      await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
      const reloaded = await loadGraph({ graphPath: tmpDir })
      const reloadedRoot = reloaded.nodesById.get('orders.DomainModel.order')
      assert.ok(reloadedRoot)
      assert.equal(reloadedRoot.extractedFrom, './specs/orders-api.yaml')
      assert.equal(reloadedRoot.derivation, 'determined')
      assert.equal(reloadedRoot.derivedBy, 'adapter:openapi')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('excludes generated uses-type edges from edge file output', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    const syntheticEdge: Edge = {
      id: 'orders.DomainModel.order__uses-type__payments.DomainModel.payment',
      from: 'orders.DomainModel.order',
      to: 'payments.DomainModel.payment',
      type: 'uses-type',
      state: 'proposed',
      stability: 'unstable',
      generated: true,
    }
    const fromEdges = graph.edgesByFrom.get('orders.DomainModel.order') ?? []
    graph.edgesByFrom.set('orders.DomainModel.order', [...fromEdges, syntheticEdge])

    const map = serializeGraph(graph)
    for (const [key, content] of map) {
      if (!key.startsWith('edges/')) continue
      // The root node 'payments.DomainModel.payment' (no child suffix) never appears as a to: target
      // in real edges — only child field IDs do. Its presence here means a generated edge was written.
      assert.ok(
        !content.includes('to: payments.DomainModel.payment\n'),
        `generated uses-type edge must not appear in edge file ${key}`,
      )
    }
  })

  it('serialises explicit edge properties in alphabetical order when the edge type declares no schema', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    const syntheticEdge: Edge = {
      id: 'orders.DomainModel.order__triggers__payments.DomainModel.payment',
      from: 'orders.DomainModel.order',
      to: 'payments.DomainModel.payment',
      type: 'triggers',
      state: 'proposed',
      stability: 'unstable',
      properties: { zeta: 1, alpha: 2, mid: 3 },
    }
    const fromEdges = graph.edgesByFrom.get('orders.DomainModel.order') ?? []
    graph.edgesByFrom.set('orders.DomainModel.order', [...fromEdges, syntheticEdge])

    const map = serializeGraph(graph)
    const edgeYaml = map.get('edges/corum.edges.yaml')
    assert.ok(edgeYaml)
    const doc = parseYaml(edgeYaml) as { edges: Array<Record<string, unknown>> }
    const written = doc.edges.find(e => e.from === syntheticEdge.from && e.to === syntheticEdge.to)
    assert.ok(written)
    assert.deepEqual(Object.keys(written.properties as Record<string, unknown>), ['alpha', 'mid', 'zeta'])
  })
})

describe('graph writer', () => {
  it('writes an edited graph to a replacement folder that can be loaded again, preserving non-yaml files', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-write-back-'))
    // Non-YAML files a user kept alongside the graph must survive a replace
    // (P2.4): saveGraph's replace semantics only own *.yaml content.
    fs.writeFileSync(path.join(outputGraphDir, 'notes.txt'), 'kept by user')

    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const endpoint = graph.nodesById.get('orders.APIEndpoint.create-order')
      assert.ok(endpoint)
      endpoint.properties.path = '/v2/orders'

      await saveGraph(graph, {
        sourceGraphPath: fixtureGraphDir,
        outputGraphPath: outputGraphDir,
      })

      assert.equal(fs.readFileSync(path.join(outputGraphDir, 'notes.txt'), 'utf-8'), 'kept by user')

      const writtenGraph = await loadGraph({ graphPath: outputGraphDir })
      const writtenEndpoint = writtenGraph.nodesById.get('orders.APIEndpoint.create-order')
      assert.ok(writtenEndpoint)
      assert.equal(writtenEndpoint.properties.path, '/v2/orders')
      assert.equal(writtenGraph.nodesById.size, 151)
      assert.equal([...writtenGraph.edgesByFrom.values()].flat().length, 178)
    } finally {
      fs.rmSync(outputGraphDir, { recursive: true, force: true })
    }
  })

  it('writes explicit edges only and derives structural edges on reload', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-write-back-'))

    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      await saveGraph(graph, {
        sourceGraphPath: fixtureGraphDir,
        outputGraphPath: outputGraphDir,
      })

      const edgeFile = path.join(outputGraphDir, 'edges', 'corum.edges.yaml')
      const edgeYaml = fs.readFileSync(edgeFile, 'utf-8')

      assert.match(edgeYaml, /type: reads/)
      assert.match(edgeYaml, /type: maps-to/)
      assert.doesNotMatch(edgeYaml, /type: has-field/)
      assert.doesNotMatch(edgeYaml, /type: has-value/)
    } finally {
      fs.rmSync(outputGraphDir, { recursive: true, force: true })
    }
  })

  it('preserves child node state overrides when writing graph files', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-write-back-'))

    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const field = graph.nodesById.get('orders.DomainModel.order.schemas.order-line-item.fields.unitPrice')
      assert.ok(field)
      assert.equal(field.state, 'proposed')

      await saveGraph(graph, {
        sourceGraphPath: fixtureGraphDir,
        outputGraphPath: outputGraphDir,
      })

      const writtenGraph = await loadGraph({ graphPath: outputGraphDir })
      const writtenField = writtenGraph.nodesById.get('orders.DomainModel.order.schemas.order-line-item.fields.unitPrice')
      const siblingField = writtenGraph.nodesById.get('orders.DomainModel.order.schemas.order-line-item.fields.quantity')
      assert.ok(writtenField)
      assert.ok(siblingField)
      assert.equal(writtenField.state, 'proposed')
      assert.equal(siblingField.state, 'agreed')
    } finally {
      fs.rmSync(outputGraphDir, { recursive: true, force: true })
    }
  })

  it('refuses to replace an existing folder when replace is false', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-write-back-'))

    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })

      await assert.rejects(
        () => saveGraph(graph, {
          sourceGraphPath: fixtureGraphDir,
          outputGraphPath: outputGraphDir,
          replace: false,
        }),
        /already exists/,
      )
    } finally {
      fs.rmSync(outputGraphDir, { recursive: true, force: true })
    }
  })

  it('round-trips field $ref values with correct YAML quoting', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-ref-roundtrip-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })

      const statusField = graph.nodesById.get('orders.DomainModel.order.schemas.order.fields.status')
      assert.ok(statusField, 'status field exists')

      await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: outputGraphDir })

      const orderYaml = fs.readFileSync(
        path.join(outputGraphDir, 'components', 'orders', 'DomainModels', 'order.yaml'),
        'utf-8',
      )
      assert.match(orderYaml, /\$ref: '#\/enums\/order-status'/, 'field $ref is quoted')
      assert.doesNotMatch(orderYaml, /\$ref: #\//, 'no unquoted $ref values')
      assert.match(orderYaml, /schema: '#\/schemas\/order'/, 'schema property is quoted')

      const reloadedGraph = await loadGraph({ graphPath: outputGraphDir })
      const reloadedField = reloadedGraph.nodesById.get('orders.DomainModel.order.schemas.order.fields.status')
      assert.ok(reloadedField, 'status field survives round-trip')
      assert.equal(reloadedField.properties['$ref'], '#/enums/order-status')
      const reloadedRoot = reloadedGraph.nodesById.get('orders.DomainModel.order')
      assert.equal(reloadedRoot?.properties.schema, '#/schemas/order', 'schema property survives round-trip')
    } finally {
      fs.rmSync(outputGraphDir, { recursive: true, force: true })
    }
  })

  it('serialises root node properties in template-declared order, unknown keys alphabetically after', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const endpoint = graph.nodesById.get('orders.APIEndpoint.create-order')
    assert.ok(endpoint)

    // Permute insertion order and add keys not declared on the template.
    const permuted: Record<string, unknown> = {}
    permuted.zzzCustom = 'z'
    permuted.responses = endpoint.properties.responses
    permuted.aaaCustom = 'a'
    permuted.path = endpoint.properties.path
    permuted.request = endpoint.properties.request
    permuted.method = endpoint.properties.method
    endpoint.properties = permuted

    const map = serializeGraph(graph)
    const clusterYaml = map.get('components/orders/APIEndpoints/create-order.yaml')
    assert.ok(clusterYaml)
    const doc = parseYaml(clusterYaml) as { properties: Record<string, unknown> }
    assert.deepEqual(
      Object.keys(doc.properties),
      ['method', 'path', 'request', 'responses', 'aaaCustom', 'zzzCustom'],
    )
  })

  it('serialises owned child (field) properties in template-declared order', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const field = graph.nodesById.get('orders.DomainModel.order.schemas.order-line-item.fields.unitPrice')
    assert.ok(field)

    const permuted: Record<string, unknown> = {}
    permuted.nullable = field.properties.nullable
    permuted.type = field.properties.type
    field.properties = permuted

    const map = serializeGraph(graph)
    const clusterYaml = map.get('components/orders/DomainModels/order.yaml')
    assert.ok(clusterYaml)
    const doc = parseYaml(clusterYaml) as {
      schemas: { 'order-line-item': { fields: { unitPrice: Record<string, unknown> } } }
    }
    const fieldDoc = doc.schemas['order-line-item'].fields.unitPrice
    const propertyKeys = Object.keys(fieldDoc).filter(k => k === 'type' || k === 'nullable')
    assert.deepEqual(propertyKeys, ['type', 'nullable'])
  })

  it('preserves source field order when rewriting a cluster and appends new fields at the end', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const paymentFieldParent = 'payments.DomainModel.payment.schemas.payment'
    const paymentFieldPath = path.join(fixtureGraphDir, 'components', 'payments', 'DomainModels', 'payment.yaml')
    const originalDoc = parseYaml(fs.readFileSync(paymentFieldPath, 'utf-8')) as {
      schemas: { payment: { fields: Record<string, unknown> } }
    }
    const originalOrder = Object.keys(originalDoc.schemas.payment.fields)

    const statusField = graph.nodesById.get(`${paymentFieldParent}.fields.status`)
    assert.ok(statusField)
    statusField.properties.nullable = true

    graph.nodesById.set(`${paymentFieldParent}.fields.adjustmentAmount`, {
      id: `${paymentFieldParent}.fields.adjustmentAmount`,
      template: 'Field',
      component: 'payments',
      parentId: paymentFieldParent,
      state: 'agreed',
      stability: 'stable',
      schemaVersion: '1',
      lastModifiedAt: '2026-07-04',
      properties: { type: 'decimal', nullable: true },
    })

    const map = serializeGraph(graph)
    const clusterYaml = map.get('components/payments/DomainModels/payment.yaml')
    assert.ok(clusterYaml)
    const doc = parseYaml(clusterYaml) as {
      schemas: { payment: { fields: Record<string, unknown> } }
    }

    assert.deepEqual(
      Object.keys(doc.schemas.payment.fields),
      [...originalOrder, 'adjustmentAmount'],
    )
  })

  it('property key permutation does not change serialised output (determinism)', async () => {
    const graphA = await loadGraph({ graphPath: fixtureGraphDir })
    const mapA = serializeGraph(graphA)

    const graphB = await loadGraph({ graphPath: fixtureGraphDir })
    const endpoint = graphB.nodesById.get('orders.APIEndpoint.create-order')
    assert.ok(endpoint)
    const keys = Object.keys(endpoint.properties).reverse()
    const permuted: Record<string, unknown> = {}
    for (const key of keys) permuted[key] = endpoint.properties[key]
    endpoint.properties = permuted
    const mapB = serializeGraph(graphB)

    assert.deepEqual([...mapA.keys()].sort(), [...mapB.keys()].sort())
    for (const [key, content] of mapA) {
      assert.equal(mapB.get(key), content, `content for ${key} differs after property permutation`)
    }
  })
})
