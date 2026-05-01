import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../src/loader/index.js'
import { saveGraph, serializeGraph } from '../src/writer/graph-writer.js'

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

  it('relativizes legacy absolute extractedFrom paths', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-absolute-extracted-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const root = graph.nodesById.get('orders.DomainModel.order')
      assert.ok(root)
      root.extractedFrom = path.join(fixtureGraphDir, root.extractedFrom!)

      await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })

      assert.equal(
        fs.existsSync(path.join(tmpDir, 'components', 'orders', 'DomainModels', 'order.yaml')),
        true,
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('graph writer', () => {
  it('writes an edited graph to a replacement folder that can be loaded again', async () => {
    const outputGraphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-write-back-'))
    fs.writeFileSync(path.join(outputGraphDir, 'stale.txt'), 'this should be removed')

    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })
      const endpoint = graph.nodesById.get('orders.APIEndpoint.create-order')
      assert.ok(endpoint)
      endpoint.properties.path = '/v2/orders'

      await saveGraph(graph, {
        sourceGraphPath: fixtureGraphDir,
        outputGraphPath: outputGraphDir,
      })

      assert.equal(fs.existsSync(path.join(outputGraphDir, 'stale.txt')), false)

      const writtenGraph = await loadGraph({ graphPath: outputGraphDir })
      const writtenEndpoint = writtenGraph.nodesById.get('orders.APIEndpoint.create-order')
      assert.ok(writtenEndpoint)
      assert.equal(writtenEndpoint.properties.path, '/v2/orders')
      assert.equal(writtenGraph.nodesById.size, 151)
      assert.equal([...writtenGraph.edgesByFrom.values()].flat().length, 167)
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
})
