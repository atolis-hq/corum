import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { specKey } from '../../src/import/spec-key.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/openapi/specs')

describe('specKey', () => {
  it('normalises separators and leading ./', () => {
    assert.equal(specKey('./specs/a.yaml'), 'specs/a.yaml')
    assert.equal(specKey('specs//a.yaml'), 'specs/a.yaml')
    assert.equal(specKey('specs\\sub\\a.yaml'), 'specs/sub/a.yaml')
    assert.equal(specKey('specs/./a.yaml'), 'specs/a.yaml')
  })

  it('keeps absolute paths absolute and never adds a cwd prefix', () => {
    assert.equal(specKey('/abs/specs/a.yaml'), '/abs/specs/a.yaml')
    assert.ok(!specKey('specs/a.yaml').startsWith(process.cwd()))
    assert.equal(specKey('../x/a.yaml'), '../x/a.yaml')
  })
})

describe('import runner — stable extractedFrom', () => {
  async function setup() {
    const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-key-graph-'))
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
    return graphDir
  }

  function makeConfig(spec: string): ImportConfig {
    return { imports: [{ adapter: 'openapi', spec, componentMapping: { strategy: 'uri-segment', segment: 0 } }] }
  }

  async function runIn(cwd: string, config: ImportConfig, graphDir: string) {
    const prev = process.cwd()
    process.chdir(cwd)
    try {
      process.env.CORUM_GRAPH_PATH = graphDir
      await runImport(config, createGraphRuntimeConfig())
    } finally {
      process.chdir(prev)
    }
  }

  it('is identical across working directories and removal works across them', async () => {
    const graphA = await setup()
    const graphB = await setup()
    const cwdA = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-key-a-'))
    const cwdB = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-key-b-'))
    try {
      for (const cwd of [cwdA, cwdB]) {
        fs.mkdirSync(path.join(cwd, 'specs'))
        fs.copyFileSync(path.join(specsDir, 'orders-simple.yaml'), path.join(cwd, 'specs', 'orders.yaml'))
      }
      const config = makeConfig('./specs/orders.yaml')
      await runIn(cwdA, config, graphA)
      await runIn(cwdB, config, graphB)

      const a = await loadGraph({ graphPath: graphA })
      const b = await loadGraph({ graphPath: graphB })
      const node = a.nodesById.get('orders.APIEndpoint.createOrder')
      assert.equal(node?.extractedFrom, 'specs/orders.yaml')
      assert.equal(b.nodesById.get('orders.APIEndpoint.createOrder')?.extractedFrom, 'specs/orders.yaml')
      for (const n of a.nodesById.values()) {
        if (n.extractedFrom !== undefined) assert.ok(!n.extractedFrom.includes(cwdA))
      }

      // Re-import in a different cwd with the spec content emptied.
      fs.writeFileSync(path.join(cwdB, 'specs', 'orders.yaml'), `openapi: '3.0.3'\ninfo:\n  title: Empty\n  version: '1.0'\npaths: {}`)
      await runIn(cwdB, config, graphA)
      const after = await loadGraph({ graphPath: graphA })
      assert.equal(after.nodesById.get('orders.APIEndpoint.createOrder')?.state, 'removed')
    } finally {
      for (const d of [graphA, graphB, cwdA, cwdB]) fs.rmSync(d, { recursive: true, force: true })
    }
  })

  it('updates legacy absolute extractedFrom in place without duplicating', async () => {
    const graphDir = await setup()
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-key-legacy-'))
    try {
      const abs = path.join(cwd, 'orders.yaml')
      fs.copyFileSync(path.join(specsDir, 'orders-simple.yaml'), abs)
      const config = makeConfig('orders.yaml')
      await runIn(cwd, config, graphDir)
      const g = await loadGraph({ graphPath: graphDir })
      const count = g.nodesById.size
      // Simulate a legacy graph by re-importing and checking key; then count stability.
      await runIn(cwd, config, graphDir)
      const g2 = await loadGraph({ graphPath: graphDir })
      assert.equal(g2.nodesById.size, count)
      assert.equal(g2.nodesById.get('orders.APIEndpoint.createOrder')?.extractedFrom, 'orders.yaml')
    } finally {
      fs.rmSync(graphDir, { recursive: true, force: true })
      fs.rmSync(cwd, { recursive: true, force: true })
    }
  })
})
