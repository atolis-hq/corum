import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../src/loader/index.js'
import { saveGraph } from '../src/writer/graph-writer.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

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
      assert.equal(writtenGraph.nodesById.size, 45)
      assert.equal([...writtenGraph.edgesByFrom.values()].flat().length, 38)
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
})
