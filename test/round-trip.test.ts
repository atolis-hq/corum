import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../src/loader/index.js'
import { serializeGraph } from '../src/writer/graph-writer.js'

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
})
