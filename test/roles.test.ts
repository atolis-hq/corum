import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPacks } from '../src/loader/pack-loader.js'
import { loadClusters } from '../src/loader/cluster-loader.js'
import { getTemplateRole, templateHasRole, getStructuralTemplates, getDataTemplates } from '../src/graph/roles.js'
import { getLinkedFields, getClusterView } from '../src/graph/index.js'
import { collapseClusterSchemas } from '../src/graph/schema-collapse.js'
import type { Diagnostic, Graph } from '../src/schema/index.js'
import type { ContentMap } from '../src/source/index.js'
import { FileGraphSource } from '../src/source/file-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

const AVRO_SCHEMA_TEMPLATE = [
  'name: AvroSchema',
  'extends: Schema',
  'info:',
  '  version: "1.0.0"',
].join('\n') + '\n'

const PIPELINE_TEMPLATE = [
  'name: Pipeline',
  'info:',
  '  version: "1.0.0"',
  'payloads:',
  '  item-template: AvroSchema',
].join('\n') + '\n'

const PIPELINE_CLUSTER = [
  'id: data.Pipeline.orders-feed',
  'template: Pipeline',
  'schemaVersion: "1.0"',
  'metadata:',
  '  component: data',
  '  lastModifiedAt: "2026-01-01"',
  'payloads:',
  '  order-record:',
  '    fields:',
  '      id:',
  '        type: string',
  '      amount:',
  '        type: number',
].join('\n') + '\n'

async function fixturePackContent(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadPackContent(await source.defaultBranch())
}

async function loadCustomPackGraph(): Promise<{ graph: Graph; diagnostics: Diagnostic[] }> {
  const diagnostics: Diagnostic[] = []
  const packContent = await fixturePackContent()
  packContent.set('custom/templates/AvroSchema.yaml', AVRO_SCHEMA_TEMPLATE)
  packContent.set('custom/templates/Pipeline.yaml', PIPELINE_TEMPLATE)
  const templates = loadPacks(packContent, diagnostics)

  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  const graphContent = await source.loadGraphContent(await source.defaultBranch())
  graphContent.set('components/data/pipeline.yaml', PIPELINE_CLUSTER)

  const clusterResult = loadClusters(graphContent, templates, diagnostics)
  const graph: Graph = {
    nodesById: clusterResult.nodes,
    edgesByFrom: clusterResult.edgesByFrom,
    edgesByTo: clusterResult.edgesByTo,
    templates,
    diagnostics,
  }
  return { graph, diagnostics }
}

describe('template roles', () => {
  it('core templates declare their roles', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await fixturePackContent(), diagnostics)
    assert.equal(getTemplateRole(templates, 'Field'), 'field')
    assert.equal(getTemplateRole(templates, 'EnumValue'), 'value')
    assert.equal(getTemplateRole(templates, 'Schema'), 'type-container')
    assert.equal(getTemplateRole(templates, 'EnumDefinition'), 'enum-container')
    assert.equal(getTemplateRole(templates, 'Mapping'), 'mapping')
    assert.equal(getTemplateRole(templates, 'DomainModel'), undefined)
  })

  it('resolves roles through the extends chain', async () => {
    const diagnostics: Diagnostic[] = []
    const packContent = await fixturePackContent()
    packContent.set('custom/templates/AvroSchema.yaml', AVRO_SCHEMA_TEMPLATE)
    const templates = loadPacks(packContent, diagnostics)

    assert.equal(getTemplateRole(templates, 'AvroSchema'), 'type-container')
    assert.ok(templateHasRole(templates, 'AvroSchema', 'type-container'))
  })

  it('derives structural and data template sets from roles', async () => {
    const diagnostics: Diagnostic[] = []
    const packContent = await fixturePackContent()
    packContent.set('custom/templates/AvroSchema.yaml', AVRO_SCHEMA_TEMPLATE)
    const templates = loadPacks(packContent, diagnostics)

    const structural = getStructuralTemplates(templates)
    for (const name of ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping', 'AvroSchema']) {
      assert.ok(structural.has(name), `${name} should be structural`)
    }
    assert.ok(!structural.has('DomainModel'))

    const data = getDataTemplates(templates)
    assert.ok(data.has('Schema'))
    assert.ok(data.has('EnumDefinition'))
    assert.ok(data.has('AvroSchema'))
    assert.ok(!data.has('Field'))
  })
})

describe('role-driven engine behaviour for pack templates', () => {
  it('generates has-field containment edges for role-field children of a subclassed schema', async () => {
    const { graph, diagnostics } = await loadCustomPackGraph()
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)

    const schemaId = 'data.Pipeline.orders-feed.payloads.order-record'
    assert.ok(graph.nodesById.has(schemaId), 'expected AvroSchema child node')
    const fieldId = `${schemaId}.fields.id`
    assert.ok(graph.nodesById.has(fieldId), 'expected field grandchild node')

    const edges = graph.edgesByFrom.get(schemaId) ?? []
    assert.ok(
      edges.some(e => e.type === 'has-field' && e.to === fieldId),
      'expected has-field edge from AvroSchema child to its field',
    )
  })

  it('collapses subclassed schemas under custom section names', async () => {
    const { graph } = await loadCustomPackGraph()
    const cluster = getClusterView(graph, 'data.Pipeline.orders-feed')
    const collapsed = collapseClusterSchemas(graph, cluster)

    assert.ok(collapsed.schemas['order-record'], 'expected collapsed schema entry for AvroSchema child')
    assert.deepEqual(collapsed.schemas['order-record'].id, { type: 'string' })
    assert.equal(collapsed.descendants.length, 0, 'structural children should be collapsed away')
  })

  it('getLinkedFields matches subclassed field templates via roles', async () => {
    const diagnostics: Diagnostic[] = []
    const packContent = await fixturePackContent()
    packContent.set('custom/templates/AvroSchema.yaml', AVRO_SCHEMA_TEMPLATE)
    packContent.set('custom/templates/Pipeline.yaml', PIPELINE_TEMPLATE)
    const templates = loadPacks(packContent, diagnostics)

    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graphContent = await source.loadGraphContent(await source.defaultBranch())
    graphContent.set('components/data/pipeline.yaml', PIPELINE_CLUSTER)
    const clusterResult = loadClusters(graphContent, templates, diagnostics)

    const fieldId = 'data.Pipeline.orders-feed.payloads.order-record.fields.id'
    const targetId = 'orders.DomainModel.order.schemas.order.fields.id'
    const mapsTo = {
      id: `${fieldId}__maps-to__${targetId}`,
      from: fieldId,
      to: targetId,
      type: 'maps-to',
      state: 'proposed' as const,
      stability: 'unstable' as const,
    }
    const edgesByFrom = new Map(clusterResult.edgesByFrom)
    edgesByFrom.set(fieldId, [...(edgesByFrom.get(fieldId) ?? []), mapsTo])
    const edgesByTo = new Map(clusterResult.edgesByTo)
    edgesByTo.set(targetId, [...(edgesByTo.get(targetId) ?? []), mapsTo])

    const graph: Graph = {
      nodesById: clusterResult.nodes,
      edgesByFrom,
      edgesByTo,
      templates,
      diagnostics,
    }

    const linked = getLinkedFields(graph, 'data.Pipeline.orders-feed.payloads.order-record')
    assert.ok(
      linked.edges.some(e => e.id === mapsTo.id),
      'expected maps-to edge found via role-field child of a subclassed schema',
    )
  })
})
