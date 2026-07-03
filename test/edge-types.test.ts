import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEdgeTypes } from '../src/loader/edge-type-loader.js'
import { loadPacks } from '../src/loader/pack-loader.js'
import { loadClusters } from '../src/loader/cluster-loader.js'
import { loadEdges } from '../src/loader/edge-loader.js'
import { serializeGraph } from '../src/writer/graph-writer.js'
import { CORE_EDGE_TYPES } from '../src/loader/constants.js'
import type { Diagnostic, Graph } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'
import { FileGraphSource } from '../src/source/file-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

const PRECEDES_PACK_YAML = [
  'edge-types:',
  '  precedes:',
  '    category: semantic',
  '    description: Sequential ordering between journey steps',
  '    properties:',
  '      type: object',
  '      properties:',
  '        order: { type: integer }',
].join('\n') + '\n'

async function fixturePackContent(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadPackContent(await source.defaultBranch())
}

async function fixtureGraphContent(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadGraphContent(await source.defaultBranch())
}

describe('edge type loader', () => {
  it('includes the core edge types by default', () => {
    const diagnostics: Diagnostic[] = []
    const edgeTypes = loadEdgeTypes(new Map(), diagnostics)
    assert.equal(diagnostics.length, 0)
    assert.equal(edgeTypes.get('has-field')?.category, 'structural')
    assert.equal(edgeTypes.get('reads')?.category, 'semantic')
    assert.equal(edgeTypes.get('uses-type')?.category, 'semantic')
    assert.equal(edgeTypes.get('derived-from')?.category, 'lineage')
  })

  it('loads pack-declared edge types with category and properties schema', () => {
    const diagnostics: Diagnostic[] = []
    const content: ContentMap = new Map([['journeys/edge-types.yaml', PRECEDES_PACK_YAML]])
    const edgeTypes = loadEdgeTypes(content, diagnostics)

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    const precedes = edgeTypes.get('precedes')
    assert.ok(precedes, 'expected pack-declared edge type')
    assert.equal(precedes.category, 'semantic')
    assert.ok(precedes.properties, 'expected properties schema carried on the definition')
  })

  it('warns and keeps the core definition when a pack redeclares a core edge type', () => {
    const diagnostics: Diagnostic[] = []
    const content: ContentMap = new Map([[
      'evil/edge-types.yaml',
      'edge-types:\n  reads:\n    category: structural\n',
    ]])
    const edgeTypes = loadEdgeTypes(content, diagnostics)

    assert.ok(diagnostics.some(d => d.severity === 'warning' && /reads/.test(d.message)))
    assert.equal(edgeTypes.get('reads')?.category, 'semantic')
  })

  it('rejects invalid categories with a diagnostic', () => {
    const diagnostics: Diagnostic[] = []
    const content: ContentMap = new Map([[
      'p/edge-types.yaml',
      'edge-types:\n  zaps:\n    category: nonsense\n',
    ]])
    const edgeTypes = loadEdgeTypes(content, diagnostics)

    assert.ok(diagnostics.some(d => d.severity === 'error' && /zaps/.test(d.message)))
    assert.ok(!edgeTypes.has('zaps'))
  })

  it('rejects edge type names that violate the id grammar', () => {
    const diagnostics: Diagnostic[] = []
    const content: ContentMap = new Map([[
      'p/edge-types.yaml',
      'edge-types:\n  "bad__type":\n    category: semantic\n',
    ]])
    const edgeTypes = loadEdgeTypes(content, diagnostics)

    assert.ok(diagnostics.some(d => d.severity === 'error'))
    assert.ok(!edgeTypes.has('bad__type'))
  })
})

describe('edge loader — pack-declared types and properties', () => {
  async function loadFixtureWithEdge(edgeYaml: string, extraPackFiles: Array<[string, string]> = []) {
    const diagnostics: Diagnostic[] = []
    const packContent = await fixturePackContent()
    for (const [key, content] of extraPackFiles) packContent.set(key, content)
    const templates = loadPacks(packContent, diagnostics)
    const edgeTypes = loadEdgeTypes(packContent, diagnostics)
    const graphContent = await fixtureGraphContent()
    graphContent.set('edges/test-extra.edges.yaml', edgeYaml)
    const clusterResult = loadClusters(graphContent, templates, diagnostics)
    const edgeResult = loadEdges(graphContent, clusterResult.nodes, diagnostics, edgeTypes)
    return { diagnostics, edgeResult, edgeTypes }
  }

  it('accepts an edge of a pack-declared type and carries its properties', async () => {
    const edgeYaml = [
      'edges:',
      '  - from: orders.DomainModel.order',
      '    to: orders.APIEndpoint.create-order',
      '    type: precedes',
      '    state: proposed',
      '    stability: unstable',
      '    properties:',
      '      order: 1',
    ].join('\n') + '\n'

    const { diagnostics, edgeResult } = await loadFixtureWithEdge(
      edgeYaml,
      [['journeys/edge-types.yaml', PRECEDES_PACK_YAML]],
    )

    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    const edges = edgeResult.edgesByFrom.get('orders.DomainModel.order') ?? []
    const precedes = edges.find(e => e.type === 'precedes')
    assert.ok(precedes, 'expected the precedes edge to load')
    assert.deepEqual(precedes.properties, { order: 1 })
  })

  it('still rejects edge types no pack declares', async () => {
    const edgeYaml = [
      'edges:',
      '  - from: orders.DomainModel.order',
      '    to: orders.APIEndpoint.create-order',
      '    type: zaps',
    ].join('\n') + '\n'

    const { diagnostics } = await loadFixtureWithEdge(edgeYaml)
    assert.ok(diagnostics.some(d => d.severity === 'error' && /zaps/.test(d.message)))
  })
})

describe('writer — edge properties and category-driven structural skip', () => {
  it('serialises edge properties and derives the structural skip from categories', async () => {
    const diagnostics: Diagnostic[] = []
    const packContent = await fixturePackContent()
    packContent.set('journeys/edge-types.yaml', PRECEDES_PACK_YAML)
    const templates = loadPacks(packContent, diagnostics)
    const edgeTypes = loadEdgeTypes(packContent, diagnostics)
    const graphContent = await fixtureGraphContent()
    graphContent.set('edges/test-extra.edges.yaml', [
      'edges:',
      '  - from: orders.DomainModel.order',
      '    to: orders.APIEndpoint.create-order',
      '    type: precedes',
      '    properties:',
      '      order: 2',
    ].join('\n') + '\n')

    const clusterResult = loadClusters(graphContent, templates, diagnostics)
    const edgeResult = loadEdges(graphContent, clusterResult.nodes, diagnostics, edgeTypes)
    const edgesByFrom = new Map(clusterResult.edgesByFrom)
    for (const [key, edges] of edgeResult.edgesByFrom) {
      edgesByFrom.set(key, [...(edgesByFrom.get(key) ?? []), ...edges])
    }
    const graph: Graph = {
      nodesById: clusterResult.nodes,
      edgesByFrom,
      edgesByTo: new Map(),
      templates,
      edgeTypes,
      diagnostics,
      sourceContent: graphContent,
    }

    const contentMap = serializeGraph(graph)
    const edgesYaml = contentMap.get('edges/corum.edges.yaml') ?? ''
    assert.match(edgesYaml, /type: precedes/)
    assert.match(edgesYaml, /order: 2/)
    assert.ok(!/has-field/.test(edgesYaml), 'structural edges must not be written')
  })
})

describe('core edge type definitions', () => {
  it('declares each core type exactly once with a category', () => {
    for (const [name, def] of Object.entries(CORE_EDGE_TYPES)) {
      assert.ok(['structural', 'semantic', 'lineage'].includes(def.category), `${name} has a category`)
    }
    assert.equal(CORE_EDGE_TYPES['renamed-from'].hidden, true)
  })

  it('declares uses-type as a core semantic edge type', () => {
    assert.deepEqual(CORE_EDGE_TYPES['uses-type'], { name: 'uses-type', category: 'semantic' })
  })
})
