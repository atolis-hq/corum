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
import { FileGraphSource } from '../../src/source/file-source.js'
import type { CommitOptions, ContentMap, GraphSource } from '../../src/source/index.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/openapi/specs')
const expectedBaseDir = path.join(repoRoot, 'test/fixtures/openapi/expected')

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

  for (const [key, expectedContent] of golden) {
    const actualPath = path.join(graphDir, key)
    assert.ok(fs.existsSync(actualPath), `expected imported file ${key} to exist in graph`)
    const actualContent = fs.readFileSync(actualPath, 'utf-8')
    assert.equal(
      normalizeYaml(actualContent),
      normalizeYaml(expectedContent),
      `${key} output should match golden file`,
    )
  }
}

describe('import runner — orders-simple.yaml', () => {
  it('output matches golden files', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      assertMatchesExpected(graphDir, 'orders-simple')
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
      assertMatchesExpected(yamlDir, 'orders-simple')
      assertMatchesExpected(jsonDir, 'orders-simple')
    } finally {
      cleanYaml()
      cleanJson()
    }
  })
})

describe('import runner — orders-shared.yaml', () => {
  it('output matches expected files', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-shared.yaml')
    try {
      assertMatchesExpected(graphDir, 'orders-shared')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — multi-component.yaml', () => {
  it('routes operations to correct components via uri-segment strategy', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('multi-component.yaml')
    try {
      assertMatchesExpected(graphDir, 'multi-component')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — shared-error.yaml', () => {
  it('places schemas referenced by multiple components in shared component', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('shared-error.yaml')
    try {
      assertMatchesExpected(graphDir, 'shared-error')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — schema-features.yaml', () => {
  it('unwraps allOf:[{$ref}], inlines anonymous objects, emits Mapping nodes for keyed fields, and shares multi-use schemas', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('schema-features.yaml')
    try {
      assertMatchesExpected(graphDir, 'schema-features')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — orphan removal', () => {
  it('marks a previously imported endpoint as removed when absent from updated spec', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
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

describe('import runner — target branch', () => {
  class RecordingSource implements GraphSource {
    readonly commits: Array<{ branch: string; changes: ContentMap; message: string; options?: CommitOptions }> = []
    readonly graphContentRequests: string[] = []

    constructor(
      private readonly packContent: ContentMap,
      private readonly graphContentByBranch: Map<string, ContentMap>,
    ) {}

    async defaultBranch(): Promise<string> {
      return 'main'
    }

    async listBranches(): Promise<string[]> {
      return [...this.graphContentByBranch.keys()]
    }

    async loadPackContent(_ref: string): Promise<ContentMap> {
      return this.packContent
    }

    async loadGraphContent(ref: string): Promise<ContentMap> {
      this.graphContentRequests.push(ref)
      const content = this.graphContentByBranch.get(ref)
      if (!content) throw new Error(`unknown branch: ${ref}`)
      return content
    }

    async commit(branch: string, changes: ContentMap, message: string, options?: CommitOptions): Promise<void> {
      this.commits.push({ branch, changes, message, options })
    }
  }

  async function makeRecordingSource(branches: string[]): Promise<RecordingSource> {
    const fixtureSource = new FileGraphSource({ graphDir: fixtureGraphDir })
    const packContent = await fixtureSource.loadPackContent('main')
    const graphContent = await fixtureSource.loadGraphContent('main')
    const byBranch = new Map(branches.map(branch => [branch, graphContent]))
    return new RecordingSource(packContent, byBranch)
  }

  function importConfig(): ImportConfig {
    return {
      imports: [{
        adapter: 'openapi',
        spec: path.join(specsDir, 'orders-simple.yaml'),
        componentMapping: { strategy: 'uri-segment', segment: 0 },
      }],
    }
  }

  it('commits to the requested branch, creating it when missing', async () => {
    const source = await makeRecordingSource(['main'])
    const runtimeConfig = { kind: 'git' as const, source, graphPath: 'git:fake/.corum/graph' }
    const result = await runImport(importConfig(), runtimeConfig, { branch: 'feat/import' })

    assert.ok(!result.diagnostics.some(d => d.severity === 'error'), 'expected no error diagnostics')
    assert.equal(source.commits.length, 1)
    assert.equal(source.commits[0].branch, 'feat/import')
    assert.equal(source.commits[0].options?.createBranchIfMissing, true)
  })

  it('diffs against the target branch when it already exists', async () => {
    const source = await makeRecordingSource(['main', 'feat/import'])
    const runtimeConfig = { kind: 'git' as const, source, graphPath: 'git:fake/.corum/graph' }
    await runImport(importConfig(), runtimeConfig, { branch: 'feat/import' })

    assert.ok(source.graphContentRequests.includes('feat/import'), 'expected graph load from target branch')
    assert.equal(source.commits[0].branch, 'feat/import')
    assert.ok(!source.commits[0].options?.createBranchIfMissing)
  })

  it('errors clearly when importing to a git source without a target branch', async () => {
    const source = await makeRecordingSource(['main'])
    const runtimeConfig = { kind: 'git' as const, source, graphPath: 'git:fake/.corum/graph' }
    const result = await runImport(importConfig(), runtimeConfig)

    assert.ok(
      result.diagnostics.some(d => d.severity === 'error' && /--branch/.test(d.message)),
      'expected an error diagnostic mentioning --branch',
    )
    assert.equal(source.commits.length, 0)
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

describe('import runner — params-example.yaml', () => {
  it('maps path, query, and header parameters into endpoint properties', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('params-example.yaml')
    try {
      assertMatchesExpected(graphDir, 'params-example')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — openapi-gaps.yaml', () => {
  it('emits Mapping nodes for all additionalProperties shapes and handles oneOf fallback', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('openapi-gaps.yaml')
    try {
      assertMatchesExpected(graphDir, 'openapi-gaps')
    } finally {
      cleanup()
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
