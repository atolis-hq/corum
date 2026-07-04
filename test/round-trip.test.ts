import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../src/loader/index.js'
import { serializeGraph } from '../src/writer/graph-writer.js'
import type { Edge } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

function writeContentMap(dir: string, map: Map<string, string>): void {
  for (const [key, content] of map) {
    const filePath = path.join(dir, ...key.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
  }
}

describe('round-trip determinism (P2.4)', () => {
  it('load -> serialize -> load -> serialize produces a byte-identical ContentMap', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-roundtrip-'))
    try {
      const graphA = await loadGraph({ graphPath: fixtureGraphDir })
      const mapA = serializeGraph(graphA, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
      writeContentMap(tmpDir, mapA)

      const graphB = await loadGraph({ graphPath: tmpDir })
      const mapB = serializeGraph(graphB, { sourceGraphPath: tmpDir, outputGraphPath: tmpDir })

      assert.deepEqual([...mapA.keys()].sort(), [...mapB.keys()].sort(), 'ContentMap keys must match')
      for (const [key, content] of mapA) {
        assert.equal(mapB.get(key), content, `content for ${key} must be byte-identical on second serialisation`)
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('permuting a node property insertion order in memory does not change serialised output', async () => {
    const baseline = await loadGraph({ graphPath: fixtureGraphDir })
    const baselineMap = serializeGraph(baseline)

    const permutedGraph = await loadGraph({ graphPath: fixtureGraphDir })
    const node = permutedGraph.nodesById.get('orders.DomainModel.order')
    assert.ok(node)

    // Delete and reinsert every key in reverse order to scramble insertion order.
    const keys = Object.keys(node.properties)
    const values = keys.map(k => node.properties[k])
    for (const key of keys) delete node.properties[key]
    for (let i = keys.length - 1; i >= 0; i--) node.properties[keys[i]] = values[i]

    const permutedMap = serializeGraph(permutedGraph)

    assert.deepEqual([...baselineMap.keys()].sort(), [...permutedMap.keys()].sort())
    for (const [key, content] of baselineMap) {
      assert.equal(permutedMap.get(key), content, `content for ${key} must be unaffected by property key permutation`)
    }
  })

  it('rename trail (renamed-from edge with dangling to + corum.identity.previousIds) survives serialize -> reload (design §3/§11)', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-trail-roundtrip-'))
    try {
      const graph = await loadGraph({ graphPath: fixtureGraphDir })

      const nodeId = 'orders.DomainModel.order'
      const retiredId = 'orders.DomainModel.orderLegacy'
      const node = graph.nodesById.get(nodeId)
      assert.ok(node)
      node.corum = { identity: { previousIds: [retiredId] } }

      const trailEdge: Edge = {
        id: `${nodeId}__renamed-from__${retiredId}`,
        from: nodeId,
        to: retiredId,
        type: 'renamed-from',
        state: 'proposed',
        stability: 'unstable',
      }
      graph.edgesByFrom.set(nodeId, [...(graph.edgesByFrom.get(nodeId) ?? []), trailEdge])
      graph.edgesByTo.set(retiredId, [...(graph.edgesByTo.get(retiredId) ?? []), trailEdge])

      writeContentMap(tmpDir, serializeGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir }))

      // strict: true (the default) — reload must produce no error diagnostics.
      const reloaded = await loadGraph({ graphPath: tmpDir })
      assert.equal(
        reloaded.diagnostics.length,
        0,
        `expected a clean reload, got: ${JSON.stringify(reloaded.diagnostics, null, 2)}`,
      )

      const reloadedNode = reloaded.nodesById.get(nodeId)
      assert.ok(reloadedNode)
      assert.deepEqual(reloadedNode.corum?.identity?.previousIds, [retiredId], 'previousIds must survive the round trip')

      const reloadedEdge = (reloaded.edgesByFrom.get(nodeId) ?? []).find(e => e.type === 'renamed-from')
      assert.ok(reloadedEdge, 'renamed-from edge must survive the round trip')
      assert.equal(reloadedEdge.to, retiredId, 'dangling to must be preserved')
      assert.equal(reloaded.edgesByTo.get(retiredId)?.length, 1, 'edge re-indexed under the retired id')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
