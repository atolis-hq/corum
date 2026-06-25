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
const specsDir = path.join(repoRoot, 'test/fixtures/corum/specs')
const expectedBaseDir = path.join(repoRoot, 'test/fixtures/corum/expected')

function makeRuntimeConfig(graphDir: string) {
  process.env.CORUM_GRAPH_PATH = graphDir
  return createGraphRuntimeConfig()
}

async function setupGraphDir() {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-runner-'))
  const graph = await loadGraph({ graphPath: fixtureGraphDir })
  await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: graphDir })
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

function normalizeYaml(content: string): string {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/lastModifiedAt: .+/g, 'lastModifiedAt: <date>')
    .replace(/extractedFrom: .+/g, 'extractedFrom: <spec>')
}

function assertMatchesExpected(graphDir: string, goldenSubdir: string): void {
  const goldenDir = path.join(expectedBaseDir, goldenSubdir)
  function readYamlFiles(baseDir: string): Map<string, string> {
    const map = new Map<string, string>()
    if (!fs.existsSync(baseDir)) return map
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.yaml')) {
          const key = path.relative(baseDir, full).split(path.sep).join('/')
          map.set(key, fs.readFileSync(full, 'utf-8'))
        }
      }
    }
    walk(baseDir)
    return map
  }
  const golden = readYamlFiles(goldenDir)
  assert.ok(golden.size > 0, `golden dir ${goldenSubdir} should contain at least one file`)
  for (const [key, expected] of golden) {
    const actualPath = path.join(graphDir, key)
    assert.ok(fs.existsSync(actualPath), `expected ${key} to exist in graph output`)
    const actual = fs.readFileSync(actualPath, 'utf-8')
    assert.equal(normalizeYaml(actual), normalizeYaml(expected), `${key} content mismatch`)
  }
}

describe('corum import — basic fixture', () => {
  it('imports nodes and produces edge from basic.corum.yaml', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'corum',
          spec: path.join(specsDir, 'basic.corum.yaml'),
        }],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      const result = await runImport(config, runtimeConfig)

      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `unexpected errors: ${JSON.stringify(result.diagnostics.filter(d => d.severity === 'error'))}`)
      assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('unresolved-field-type')))
      assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/DomainEvents/OrderPlacedDomainEvent.yaml')))
      assert.ok(fs.existsSync(path.join(graphDir, 'components/orders/DomainModels/OrderAggregate.yaml')))

      assertMatchesExpected(graphDir, 'basic')
    } finally {
      cleanup()
    }
  })
})
