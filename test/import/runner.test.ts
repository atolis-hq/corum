import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { saveGraph } from '../../src/writer/graph-writer.js'
import { runImport } from '../../src/import/runner.js'
import { renameNode } from '../../src/mutate/index.js'
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

describe('import runner — rename-aware reconciliation (design §6a)', () => {
  it('re-import of an unrenamed spec merges into the renamed node and reports in-flight drift', async () => {
    const { graphDir, cleanup: cleanupGraph } = await setupGraphDir()
    // Spec lives outside graphDir so saveGraph's stale-YAML cleanup cannot touch it.
    const specTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-rename-spec-'))
    const cleanup = () => {
      cleanupGraph()
      fs.rmSync(specTmpDir, { recursive: true, force: true })
    }
    try {
      const tempSpec = path.join(specTmpDir, 'test-spec.yaml')
      fs.copyFileSync(path.join(specsDir, 'orders-simple.yaml'), tempSpec)
      const makeConfig = (): ImportConfig => ({
        imports: [{
          adapter: 'openapi',
          spec: tempSpec,
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      })

      await runImport(makeConfig(), makeRuntimeConfig(graphDir))

      // Rename the imported endpoint in the graph, recording a trail.
      const graph = await loadGraph({ graphPath: graphDir })
      const oldId = 'orders.APIEndpoint.createOrder'
      assert.ok(graph.nodesById.has(oldId), 'endpoint exists after first import')
      const { newId } = renameNode(graph, oldId, 'submitOrder', true)
      await saveGraph(graph, { sourceGraphPath: graphDir, outputGraphPath: graphDir })

      // Re-import the unchanged spec: it still uses the retired name.
      const result = await runImport(makeConfig(), makeRuntimeConfig(graphDir))
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `expected no errors: ${JSON.stringify(result.diagnostics)}`)
      assert.ok(
        result.diagnostics.some(d => d.severity === 'warning' && /in-flight drift/.test(d.message) && d.message.includes(oldId) && d.message.includes(newId)),
        `expected an in-flight drift warning, got: ${JSON.stringify(result.diagnostics)}`,
      )

      const after = await loadGraph({ graphPath: graphDir })
      const renamed = after.nodesById.get(newId)
      assert.ok(renamed, 'renamed node survives the re-import')
      assert.notEqual(renamed.state, 'removed', 'renamed node is not orphan-removed')
      assert.ok(!after.nodesById.has(oldId), 'old name is not re-added')
      assert.deepEqual(renamed.corum?.identity?.previousIds, [oldId], 'previousIds survives the determined merge')
      assert.ok(
        (after.edgesByFrom.get(newId) ?? []).some(e => e.type === 'renamed-from' && e.to === oldId),
        'renamed-from trail edge survives the re-import',
      )
    } finally {
      cleanup()
    }
  })

  it('suggests rename_node when a re-import removes and adds a sibling with the same template', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const tempSpec = path.join(graphDir, 'test-spec.yaml')
      const spec = fs.readFileSync(path.join(specsDir, 'orders-simple.yaml'), 'utf-8')
      fs.writeFileSync(tempSpec, spec)
      const makeConfig = (): ImportConfig => ({
        imports: [{
          adapter: 'openapi',
          spec: tempSpec,
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      })

      await runImport(makeConfig(), makeRuntimeConfig(graphDir))

      // Rename the operation in the spec only (code renamed, graph not).
      fs.writeFileSync(tempSpec, spec.replace(/createOrder/g, 'submitOrder'))
      const result = await runImport(makeConfig(), makeRuntimeConfig(graphDir))

      assert.ok(
        result.diagnostics.some(d =>
          d.severity === 'warning'
          && /possible rename/.test(d.message)
          && /rename_node/.test(d.message)
          && d.message.includes('orders.APIEndpoint.createOrder')
          && d.message.includes('orders.APIEndpoint.submitOrder')),
        `expected a possible-rename warning, got: ${JSON.stringify(result.diagnostics)}`,
      )

      const after = await loadGraph({ graphPath: graphDir })
      assert.equal(after.nodesById.get('orders.APIEndpoint.createOrder')?.state, 'removed', 'old node soft-removed')
      assert.ok(after.nodesById.has('orders.APIEndpoint.submitOrder'), 'new node added')
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
      // Mirrors real git-source behaviour: a commit with replaceGraphContent
      // becomes what the next loadGraphContent(branch) call sees.
      this.graphContentByBranch.set(branch, new Map(changes))
    }

    async head(): Promise<string> {
      return 'fake-head'
    }

    async log(): Promise<string[]> {
      return []
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

  it('mechanically rewrites a hand-authored edge on a git-backed source when a re-import promotes a schema', async () => {
    const source = await makeRecordingSource(['main'])
    const runtimeConfig = { kind: 'git' as const, source, graphPath: 'git:fake/.corum/graph' }
    const specDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-promotion-'))
    try {
      const specPath = path.join(specDir, 'money-spec.json')
      const moneySpec = (paths: Record<string, unknown>) => JSON.stringify({
        openapi: '3.0.3',
        info: { title: 'Orders API', version: '1.0' },
        components: { schemas: { Money: { type: 'object', properties: { amount: { type: 'integer' } } } } },
        paths,
      })
      const singleUsePaths = {
        '/orders/create': {
          post: {
            operationId: 'createOrder',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } },
            responses: {},
          },
        },
      }
      fs.writeFileSync(specPath, moneySpec(singleUsePaths))

      const importConfig = (): ImportConfig => ({
        imports: [{ adapter: 'openapi', spec: specPath, componentMapping: { strategy: 'uri-segment', segment: 0 } }],
      })

      await runImport(importConfig(), runtimeConfig, { branch: 'feat/import' })
      assert.equal(source.commits.length, 1)
      assert.ok(
        source.commits[0].changes.has('components/orders/APIEndpoints/createOrder.yaml'),
        'expected the inline schema to be nested under the endpoint cluster file',
      )

      // Hand-author an edge pointing at the inline schema's field, committed directly to the branch —
      // simulating an agent/UI-authored design link that lands between imports.
      const branchContent = new Map(source.commits[0].changes)
      branchContent.set('edges/money-test.edges.yaml', [
        'edges:',
        '  - from: orders.DomainModel.order.schemas.order.fields.id',
        '    to: orders.APIEndpoint.createOrder.schemas.Money.fields.amount',
        '    type: maps-to',
        '',
      ].join('\n'))
      await source.commit('feat/import', branchContent, 'hand-author a design edge')

      const twoUsePaths = {
        ...singleUsePaths,
        '/orders/refund': {
          post: {
            operationId: 'refundOrder',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } },
            responses: {},
          },
        },
      }
      fs.writeFileSync(specPath, moneySpec(twoUsePaths))
      const result = await runImport(importConfig(), runtimeConfig, { branch: 'feat/import' })
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `expected no errors: ${JSON.stringify(result.diagnostics)}`)

      const finalChanges = source.commits[source.commits.length - 1].changes
      assert.ok(finalChanges.has('components/orders/Schemas/Money.yaml'), 'Money should be promoted to a standalone cluster file')

      // serializeGraph consolidates all explicit edges into a single canonical file, regardless
      // of which source file they were originally read from.
      const rewrittenEdgesYaml = finalChanges.get('edges/corum.edges.yaml') ?? ''
      assert.match(rewrittenEdgesYaml, /to: orders\.Schema\.Money\.fields\.amount/, 'hand-authored edge should be rewritten to the new standalone field')
      assert.doesNotMatch(rewrittenEdgesYaml, /orders\.APIEndpoint\.createOrder\.schemas\.Money\.fields\.amount/, 'old inline field id should no longer appear in the rewritten edge')
    } finally {
      fs.rmSync(specDir, { recursive: true, force: true })
    }
  })
})

describe('import runner — edgeCasing (cross-source field-casing drift)', () => {
  // Reproduces the real PRL scenario: an OpenAPI spec and a corum-native spec both
  // define the same schema name; dedup drops the corum copy in favour of OpenAPI's
  // (exact schema-id collision), but corum's own edges still reference its original
  // (differently-cased) field id, which no longer exists after dedup.
  function moneyOpenApiSpec(): string {
    return JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Orders API', version: '1.0' },
      components: { schemas: { Money: { type: 'object', properties: { amount: { type: 'integer' } } } } },
      paths: {
        '/orders/create': {
          post: { operationId: 'createOrder', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } }, responses: {} },
        },
        '/orders/refund': {
          post: { operationId: 'refundOrder', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } }, responses: {} },
        },
      },
    })
  }

  function moneyCorumSpec(): string {
    return [
      "corum: '1.0'",
      'info:',
      '  source:',
      '    analyser: corum-extract',
      '    language: csharp',
      'nodes:',
      '  orders.Schema.Money:',
      '    type: Schema',
      '    title: Money',
      '    schema:',
      "      $ref: '#/components/schemas/Money'",
      '    provenance:',
      '      derivation: determined',
      '      derivedBy: extractor:treesitter',
      '      extractedFrom: ../test-repo',
      'components:',
      '  schemas:',
      '    Money:',
      '      type: object',
      '      properties:',
      '        Amount:',
      '          type: integer',
      'edges:',
      '  - type: maps-to',
      '    from: orders.DomainModel.order.schemas.order.fields.id',
      '    to: orders.Schema.Money.fields.Amount',
      '',
    ].join('\n')
  }

  async function runMoneyImport(edgeCasing?: 'preserve' | 'match') {
    const { graphDir, cleanup } = await setupGraphDir()
    const openapiSpecPath = path.join(graphDir, 'money-openapi.json')
    const corumSpecPath = path.join(graphDir, 'money-corum.yaml')
    fs.writeFileSync(openapiSpecPath, moneyOpenApiSpec())
    fs.writeFileSync(corumSpecPath, moneyCorumSpec())

    const config: ImportConfig = {
      deduplication: [{ primary: 'openapi', secondary: 'corum' }],
      ...(edgeCasing ? { edgeCasing } : {}),
      imports: [
        { adapter: 'openapi', spec: openapiSpecPath, componentMapping: { strategy: 'uri-segment', segment: 0 } },
        { adapter: 'corum', spec: corumSpecPath },
      ],
    }
    const result = await runImport(config, makeRuntimeConfig(graphDir))
    return { graphDir, cleanup, result }
  }

  it('by default (preserve), the corum edge is left pointing at the dropped PascalCase field', async () => {
    const { graphDir, cleanup, result } = await runMoneyImport()
    try {
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `expected no errors: ${JSON.stringify(result.diagnostics)}`)

      const graph = await loadGraph({ graphPath: graphDir })
      assert.ok(graph.nodesById.has('orders.Schema.Money.fields.amount'), 'openapi field survives dedup')
      assert.ok(!graph.nodesById.has('orders.Schema.Money.fields.Amount'), 'corum field was dropped by dedup')

      assert.ok(
        graph.diagnostics.some(d => d.message.includes('edge to unresolved node: orders.Schema.Money.fields.Amount')),
        'the corum-authored edge should dangle without edgeCasing: match',
      )
    } finally {
      cleanup()
    }
  })

  it('with edgeCasing: match, the corum edge is rewritten to the surviving camelCase field', async () => {
    const { graphDir, cleanup, result } = await runMoneyImport('match')
    try {
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `expected no errors: ${JSON.stringify(result.diagnostics)}`)
      assert.ok(result.diagnostics.some(d => d.message.includes('[INFO] Resolved edge casing mismatch')))

      const graph = await loadGraph({ graphPath: graphDir })
      assert.ok(
        !graph.diagnostics.some(d => d.message.includes('unresolved node') && d.message.includes('Money')),
        `expected no dangling Money field refs, got: ${JSON.stringify(graph.diagnostics)}`,
      )

      const rewritten = (graph.edgesByTo.get('orders.Schema.Money.fields.amount') ?? []).filter(e => e.type === 'maps-to')
      assert.equal(rewritten.length, 1)
      assert.equal(rewritten[0].from, 'orders.DomainModel.order.schemas.order.fields.id')
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

describe('import runner — schema promotion (ADR-009b rule 4)', () => {
  function moneySpec(operations: Record<string, unknown>): string {
    return JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'Orders API', version: '1.0' },
      components: {
        schemas: {
          Money: { type: 'object', properties: { amount: { type: 'integer' } } },
        },
      },
      paths: operations,
    })
  }

  it('mechanically rewrites a hand-authored edge when a re-import promotes an inline schema to standalone', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const specPath = path.join(graphDir, 'money-spec.json')
      const singleUsePaths = {
        '/orders/create': {
          post: {
            operationId: 'createOrder',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } },
            responses: {},
          },
        },
      }
      fs.writeFileSync(specPath, moneySpec(singleUsePaths))

      const importConfig = (): ImportConfig => ({
        imports: [{ adapter: 'openapi', spec: specPath, componentMapping: { strategy: 'uri-segment', segment: 0 } }],
      })

      await runImport(importConfig(), makeRuntimeConfig(graphDir))
      const afterFirstImport = await loadGraph({ graphPath: graphDir })
      assert.ok(
        afterFirstImport.nodesById.has('orders.APIEndpoint.createOrder.schemas.Money'),
        'Money should be inlined after the first import',
      )

      // Hand-author an edge pointing at the inline schema's field, simulating agent/UI-authored design links.
      const edgesFile = path.join(graphDir, 'edges', 'money-test.edges.yaml')
      fs.writeFileSync(edgesFile, [
        'edges:',
        '  - from: orders.DomainModel.order.schemas.order.fields.id',
        '    to: orders.APIEndpoint.createOrder.schemas.Money.fields.amount',
        '    type: maps-to',
        '',
      ].join('\n'))

      // Second import: a new operation also references Money, pushing it over the 2+ usage threshold.
      const twoUsePaths = {
        ...singleUsePaths,
        '/orders/refund': {
          post: {
            operationId: 'refundOrder',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Money' } } } },
            responses: {},
          },
        },
      }
      fs.writeFileSync(specPath, moneySpec(twoUsePaths))
      const result = await runImport(importConfig(), makeRuntimeConfig(graphDir))
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `expected no errors: ${JSON.stringify(result.diagnostics)}`)

      const finalGraph = await loadGraph({ graphPath: graphDir })
      assert.ok(finalGraph.nodesById.has('orders.Schema.Money'), 'Money should be promoted to standalone')

      const rewrittenEdges = (finalGraph.edgesByTo.get('orders.Schema.Money.fields.amount') ?? []).filter(e => e.type === 'maps-to')
      assert.equal(rewrittenEdges.length, 1, 'hand-authored edge should have been rewritten to point at the new standalone field')
      assert.equal(rewrittenEdges[0].from, 'orders.DomainModel.order.schemas.order.fields.id')

      const staleEdges = (finalGraph.edgesByTo.get('orders.APIEndpoint.createOrder.schemas.Money.fields.amount') ?? []).filter(e => e.type === 'maps-to')
      assert.equal(staleEdges.length, 0, 'no maps-to edge should still point at the old inline field')
    } finally {
      cleanup()
    }
  })
})
