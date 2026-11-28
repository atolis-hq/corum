import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { getNamespaces } from '../../src/graph/index.js'
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
  it('persists edge notes and extraction sources through import and another save/load', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const specPath = path.join(graphDir, 'evidence.corum.yaml')
      const document = parseYaml(fs.readFileSync(path.join(specsDir, 'basic.corum.yaml'), 'utf8'))
      const rawEdge = document.edges[0]
      rawEdge.notes = 'Copied by the publishing activity\nvia a child workflow'
      rawEdge.provenance = { extractedFrom: 'src/workflow.ts:42', derivation: 'inferred', derivedBy: 'extractor:workflow' }
      fs.writeFileSync(specPath, stringifyYaml(document))
      const result = await runImport({ imports: [{ adapter: 'corum', spec: specPath }] }, makeRuntimeConfig(graphDir))
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'))
      const edgeId = rawEdge.from + '__' + rawEdge.type + '__' + rawEdge.to
      const check = (graph: Awaited<ReturnType<typeof loadGraph>>) => {
        const edge = graph.edgesByFrom.get(rawEdge.from)?.find(e => e.id === edgeId)
        assert.ok(edge)
        assert.equal(edge.notes, rawEdge.notes)
        assert.equal(edge.extractedFrom, 'src/workflow.ts:42')
        assert.equal(edge.state, 'implemented')
        assert.equal(edge.stability, 'unstable')
      }
      const imported = await loadGraph({ graphPath: graphDir })
      check(imported)
      await saveGraph(imported, { sourceGraphPath: graphDir, outputGraphPath: graphDir })
      check(await loadGraph({ graphPath: graphDir }))
    } finally {
      cleanup()
    }
  })

  it('imports nodes and produces edge from basic.corum.yaml', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'corum',
          spec: path.join(specsDir, 'basic.corum.yaml'),
        }],
      }
      const declaration = '# retained on import\nkind: journey\ndescription: Order journey\n'
      const declarationPath = path.join(graphDir, 'nodes/orders/namespace.yaml')
      fs.writeFileSync(declarationPath, declaration)
      const runtimeConfig = makeRuntimeConfig(graphDir)
      const result = await runImport(config, runtimeConfig)

      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `unexpected errors: ${JSON.stringify(result.diagnostics.filter(d => d.severity === 'error'))}`)
      assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('unresolved-field-type')))
      assert.ok(fs.existsSync(path.join(graphDir, 'nodes/orders/DomainEvents/OrderPlacedDomainEvent.yaml')))
      assert.ok(fs.existsSync(path.join(graphDir, 'nodes/orders/DomainModels/OrderAggregate.yaml')))

      assert.equal(fs.readFileSync(declarationPath, 'utf8'), declaration)
      assert.equal(getNamespaces(await loadGraph({ graphPath: graphDir })).get('orders')?.kind, 'journey')
      const imported = await loadGraph({ graphPath: graphDir })
      const event = imported.nodesById.get('orders.DomainEvent.OrderPlacedDomainEvent')!
      assert.equal(event.properties.payload, 'OrderPlacedDomainEvent')
      assert.ok(imported.nodesById.has('orders.DomainEvent.OrderPlacedDomainEvent.schemas.OrderPlacedDomainEvent.fields.OrderId'))
      assert.equal(event.properties.schema, undefined)
      assert.ok(!imported.diagnostics.some(d => d.message.includes("unknown property 'schema'") && d.message.includes('DomainEvent')))
      assertMatchesExpected(graphDir, 'basic')
    } finally {
      cleanup()
    }
  })

  it('strips transient x-aka from persisted nodes when no deduplication is configured', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    const specPath = path.join(graphDir, 'aka.corum.yaml')
    fs.writeFileSync(specPath, `corum: '1.0'
nodes:
  orders.DomainEvent.AkaEvent:
    type: DomainEvent
    x-aka: [LegacyName]
`)
    try {
      const config: ImportConfig = { imports: [{ adapter: 'corum', spec: specPath }] }
      await runImport(config, makeRuntimeConfig(graphDir))
      const graph = await loadGraph({ graphPath: graphDir })
      const node = graph.nodesById.get('orders.DomainEvent.AkaEvent')
      assert.ok(node, 'node imported')
      assert.ok(!('x-aka' in node.properties), 'x-aka must not be persisted')
    } finally {
      cleanup()
    }
  })

  it('inlines single-cluster edge-only schemas and skips unused schemas', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    const specPath = path.join(graphDir, 'unresolved.corum.yaml')
    fs.writeFileSync(specPath, `corum: '1.0'
nodes:
  _.DomainEvent.OrderPlaced:
    type: DomainEvent
components:
  schemas:
    workers.ReactToPersonCreatedCommand:
      type: object
      properties:
        PersonId:
          type: string
          format: uuid
    NeverUsed:
      type: object
      properties:
        Ignored:
          type: string
edges:
  - type: reads
    from: _.DomainEvent.OrderPlaced
    to: '#/components/schemas/workers.ReactToPersonCreatedCommand'
`)

    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'corum',
          spec: specPath,
        }],
      }
      const runtimeConfig = makeRuntimeConfig(graphDir)
      const result = await runImport(config, runtimeConfig)

      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), `unexpected errors: ${JSON.stringify(result.diagnostics.filter(d => d.severity === 'error'))}`)
      assert.ok(fs.existsSync(path.join(graphDir, 'nodes', '_unresolved', 'DomainEvents', 'OrderPlaced.yaml')))
      assert.ok(fs.existsSync(path.join(graphDir, 'nodes', '_unresolved', 'DomainEvents', 'OrderPlaced.yaml')))

      const rootYaml = fs.readFileSync(path.join(graphDir, 'nodes', '_unresolved', 'DomainEvents', 'OrderPlaced.yaml'), 'utf-8')
      assert.match(rootYaml, /schemas:\n\s+ReactToPersonCreatedCommand:/)
      assert.ok(!fs.existsSync(path.join(graphDir, 'nodes', 'workers', 'Schemas', 'ReactToPersonCreatedCommand.yaml')))
      assert.ok(!fs.existsSync(path.join(graphDir, 'nodes', '_unresolved', 'Schemas', 'NeverUsed.yaml')))
      assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes('Skipping unused schema') && d.message.includes('NeverUsed')))
    } finally {
      cleanup()
    }
  })
})

describe('corum import — pack edge vocabulary', () => {
  it('persists custom edges, skips unknown types, and retains endpoint lint constraints', async () => {
    const { graphDir, cleanup } = await setupGraphDir()
    try {
      const packDir = path.join(graphDir, 'custom-pack')
      fs.mkdirSync(path.join(packDir, 'templates'), { recursive: true })
      fs.writeFileSync(path.join(packDir, 'pack.yaml'), 'name: custom\nversion: "1.0.0"\nrequires: [core]\ntemplates: [Worker]\n')
      fs.writeFileSync(path.join(packDir, 'edge-types.yaml'), 'edge-types:\n  updates:\n    category: semantic\n')
      fs.writeFileSync(path.join(packDir, 'templates/Worker.yaml'), 'name: Worker\ninfo:\n  version: "1.0.0"\nedge-types:\n  incoming: [updates]\n  outgoing: [updates]\n')
      const graphYamlPath = path.join(graphDir, 'graph.yaml')
      const graphYaml = parseYaml(fs.readFileSync(graphYamlPath, 'utf8'))
      graphYaml.templatePacks.push({ name: 'custom', path: './custom-pack' })
      fs.writeFileSync(graphYamlPath, stringifyYaml(graphYaml))
      const specPath = path.join(graphDir, 'custom.corum.yaml')
      fs.writeFileSync(specPath, stringifyYaml({
        corum: '1.0',
        nodes: {
          'custom.Worker.source': { type: 'Worker' },
          'custom.Worker.target': { type: 'Worker' },
          'custom.ReadModel.target': { type: 'ReadModel' },
        },
        edges: [
          { type: 'updates', from: 'custom.Worker.source', to: 'custom.Worker.target' },
          { type: 'updates', from: 'custom.Worker.source', to: 'custom.ReadModel.target' },
          { type: 'undeclared', from: 'custom.Worker.source', to: 'custom.Worker.target' },
        ],
      }))
      const result = await runImport({ imports: [{ adapter: 'corum', spec: specPath }] }, makeRuntimeConfig(graphDir))
      assert.ok(!result.diagnostics.some(d => d.severity === 'error'), JSON.stringify(result.diagnostics))
      assert.ok(!result.diagnostics.some(d => d.message.includes("Unknown edge type 'updates'")))
      assert.ok(result.diagnostics.some(d => d.severity === 'warning' && d.message.includes("Unknown edge type 'undeclared'")))
      const graph = await loadGraph({ graphPath: graphDir })
      const edges = graph.edgesByFrom.get('custom.Worker.source') ?? []
      assert.equal(edges.filter(e => e.type === 'updates').length, 2)
      assert.ok(!edges.some(e => e.type === 'undeclared'))
      assert.ok(!graph.diagnostics.some(d => d.nodeId === 'custom.Worker.target' && d.message.includes('updates')))
      assert.ok(graph.diagnostics.some(d => d.nodeId === 'custom.ReadModel.target' && d.message.includes("edge type 'updates' is not declared as incoming")))
    } finally {
      cleanup()
    }
  })
})

describe('edge type schema contracts', () => {
  it('allows pack names while enforcing the edge name grammar in both schemas', () => {
    const interchange = parseYaml(fs.readFileSync(path.join(repoRoot, '.corum/packs/extract/interchange.schema.yaml'), 'utf8'))
    const template = parseYaml(fs.readFileSync(path.join(repoRoot, '.corum/packs/core/template.schema.yaml'), 'utf8'))
    for (const schema of [interchange.properties.edges.items.properties.type, template.$defs.EdgeType]) {
      assert.equal(schema.type, 'string')
      assert.equal(schema.enum, undefined)
      const pattern = new RegExp(schema.pattern)
      for (const name of ['updates', 'custom-edge2', 'calls']) assert.ok(pattern.test(name), name)
      for (const name of ['', 'Updates', 'has_field', 'two.words', '1edge']) assert.ok(!pattern.test(name), name)
    }
  })
})
