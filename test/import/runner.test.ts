import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { createGraphRuntimeConfig } from '../../src/source/config.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/openapi/specs')

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir(): Promise<{ graphDir: string; cleanup: () => void }> {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-import-'))
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

async function runAgainstFixture(specFile: string): Promise<{ graphDir: string; cleanup: () => void }> {
  const { graphDir, cleanup } = await setupGraphDir()
  const config: ImportConfig = {
    imports: [{
      adapter: 'openapi',
      spec: path.join(specsDir, specFile),
      componentMapping: { strategy: 'uri-segment', segment: 0 },
    }],
  }
  const runtimeConfig = makeRuntimeConfig(graphDir)
  await runImport(config, runtimeConfig)
  return { graphDir, cleanup }
}

describe('import runner — orders-simple.yaml', () => {
  it('produces an APIEndpoint node for createOrder', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const node = graph.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(node, 'expected orders.APIEndpoint.createOrder node')
      assert.equal(node.properties.method, 'POST')
      assert.equal(node.properties.path, '/orders/create')
      assert.equal(node.derivation, 'determined')
      assert.equal(node.derivedBy, 'adapter:openapi')
    } finally {
      cleanup()
    }
  })

  it('produces Field nodes with correct types', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const customerIdField = [...graph.nodesById.values()].find(n => n.id.endsWith('.fields.customerId'))
      assert.ok(customerIdField)
      assert.equal(customerIdField.properties.type, 'uuid')
      assert.equal(customerIdField.properties.nullable, false)
    } finally {
      cleanup()
    }
  })

  it('is idempotent — second import produces no new nodes', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'openapi',
          spec: path.join(specsDir, 'orders-simple.yaml'),
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      }
      const before = await loadGraph({ graphPath: graphDir })
      const beforeCount = before.nodesById.size
      await runImport(config, makeRuntimeConfig(graphDir))
      const after = await loadGraph({ graphPath: graphDir })
      assert.equal(after.nodesById.size, beforeCount)
    } finally {
      cleanup()
    }
  })

  it('parses JSON spec identically to YAML spec', async () => {
    const { graphDir: yamlDir, cleanup: cleanYaml } = await runAgainstFixture('orders-simple.yaml')
    const { graphDir: jsonDir, cleanup: cleanJson } = await runAgainstFixture('orders-simple.json')
    try {
      const yamlGraph = await loadGraph({ graphPath: yamlDir })
      const jsonGraph = await loadGraph({ graphPath: jsonDir })
      const yamlEndpoint = yamlGraph.nodesById.get('orders.APIEndpoint.createOrder')
      const jsonEndpoint = jsonGraph.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(yamlEndpoint && jsonEndpoint)
      assert.equal(yamlEndpoint.properties.method, jsonEndpoint.properties.method)
    } finally {
      cleanYaml()
      cleanJson()
    }
  })
})

describe('import runner — orders-shared.yaml', () => {
  it('produces a shared Schema node for OrderSummary', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-shared.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const schemaNode = graph.nodesById.get('orders.Schema.OrderSummary')
      assert.ok(schemaNode, 'expected shared Schema node for OrderSummary')
    } finally {
      cleanup()
    }
  })

  it('produces an EnumDefinition for OrderStatus', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-shared.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const enumNode = graph.nodesById.get('orders.EnumDefinition.OrderStatus')
      assert.ok(enumNode, 'expected EnumDefinition node for OrderStatus')
      const pendingValue = graph.nodesById.get('orders.EnumDefinition.OrderStatus.values.pending')
      assert.ok(pendingValue)
    } finally {
      cleanup()
    }
  })
})

describe('import runner — orphan removal', () => {
  it('marks a previously imported endpoint as removed when absent from updated spec', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      // Write spec to a stable temp path, import it to establish extractedFrom
      const tempSpec = path.join(graphDir, 'test-spec.yaml')
      fs.copyFileSync(path.join(specsDir, 'orders-simple.yaml'), tempSpec)
      const makeConfig = (): ImportConfig => ({
        imports: [{
          adapter: 'openapi',
          spec: tempSpec,
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      })

      await runImport(makeConfig(), makeRuntimeConfig(graphDir))
      const graphBefore = await loadGraph({ graphPath: graphDir })
      assert.ok(graphBefore.nodesById.get('orders.APIEndpoint.createOrder'), 'node should exist after first import')

      // Overwrite same path with empty spec — orphan detection fires on re-import
      fs.writeFileSync(tempSpec, `openapi: '3.0.3'\ninfo:\n  title: Empty\n  version: '1.0'\npaths: {}`)
      await runImport(makeConfig(), makeRuntimeConfig(graphDir))

      const graphAfter = await loadGraph({ graphPath: graphDir })
      const removed = graphAfter.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(removed, 'node should still exist')
      assert.equal(removed.state, 'removed', 'node should be marked removed')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — invalid spec', () => {
  it('returns error diagnostic and writes no new nodes for an invalid spec', async () => {
    const { graphDir, cleanup: cleanupInvalid } = await setupGraphDir()
    try {
      const badSpec = path.join(graphDir, 'bad.yaml')
      fs.writeFileSync(badSpec, `not: valid openapi`)
      const config: ImportConfig = {
        imports: [{
          adapter: 'openapi',
          spec: badSpec,
          componentMapping: { strategy: 'hardcoded', component: 'orders' },
        }],
      }
      const result = await runImport(config, makeRuntimeConfig(graphDir))
      assert.ok(result.diagnostics.some(d => d.severity === 'error'), 'expected at least one error diagnostic')
      const graph = await loadGraph({ graphPath: graphDir })
      const originalGraph = await loadGraph({ graphPath: fixtureGraphDir })
      assert.equal(graph.nodesById.size, originalGraph.nodesById.size)
    } finally {
      cleanupInvalid()
    }
  })
})

describe('import runner — existing tests unaffected', () => {
  it('existing fixture graph still loads with expected node count', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    assert.ok(graph.nodesById.size > 0)
    assert.equal(graph.diagnostics.filter(d => d.severity === 'error').length, 0)
  })
})
