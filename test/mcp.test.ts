import { afterEach, describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as git from 'isomorphic-git'
import { parse as parseYaml } from 'yaml'
import { decode as decodeToon } from '@toon-format/toon'
import { createMcpHandlers, ensureGraphLoaded, getMcpToolDefinitions } from '../src/mcp/index.js'
import { USAGE_GUIDE_PROMPT } from '../src/mcp/prompts/usage-guide.js'
import { loadGraph } from '../src/loader/index.js'
import type { Graph } from '../src/schema/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'
import { createMultiGraphCache, startWebServer, type WebServerHandle } from '../src/web/server.js'
import type { ContentMap, GraphSource } from '../src/source/index.js'
import { discardSession, getActiveSession } from '../src/mutate/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('MCP handlers', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  describe('list_nodes', () => {
    it('returns all nodes with no filter', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 151)
      assert.ok('id' in nodes[0])
      assert.ok('template' in nodes[0])
      assert.ok('state' in nodes[0])
      assert.ok(!('properties' in nodes[0]))
      assert.ok(!('schemaVersion' in nodes[0]))
      assert.ok(!('lastModifiedAt' in nodes[0]))
      assert.ok(!('extractedFrom' in nodes[0]))
      assert.ok(!('derivation' in nodes[0]))
      assert.ok(!('derivedBy' in nodes[0]))
    })

    it('includes provenance when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({
        filter: { templates: ['DomainModel'] },
        include_provenance: true,
        format: 'json',
      })
      const nodes = JSON.parse(result.content[0].text)

      assert.ok(nodes.length > 0)
      assert.ok(!('schemaVersion' in nodes[0]))
      assert.equal(nodes[0].lastModifiedAt, '2026-04-23')
    })

    it('filters by template', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some((n: Record<string, unknown>) => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('filters by component', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { component: 'orders' }, format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 113)
    })

    it('returns YAML by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] } })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('returns TOON output using the toon format', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, format: 'toon' })
      assert.match(result.content[0].text, /^\[\d+\]\{id,template,component,state,stability\}:/)
    })

    it('TOON output round trips through the official library', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, format: 'toon' })
      const nodes = decodeToon(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.equal(nodes[0].template, 'APIEndpoint')
      assert.ok(nodes.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('applies compact keys to JSON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, format: 'json', compact_keys: true })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 5)
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.ok(nodes.some((n: Record<string, unknown>) => n.i === 'orders.APIEndpoint.create-order'))
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.ok(nodes.some((n: Record<string, unknown>) => n.cp === 'orders'))
      assert.equal(nodes[0].st, 'stable')
      assert.ok(!('id' in nodes[0]))
      assert.ok(!('component' in nodes[0]))
      assert.ok(!('stability' in nodes[0]))
    })

    it('applies compact keys to YAML output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, compactKeys: true })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some(n => n.i === 'orders.APIEndpoint.create-order'))
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.ok(nodes.some(n => n.cp === 'orders'))
      assert.ok(!('id' in nodes[0]))
    })

    it('applies compact keys to TOON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ filter: { templates: ['APIEndpoint'] }, format: 'toon', compact_keys: true })
      const nodes = decodeToon(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some(n => n.i === 'orders.APIEndpoint.create-order'))
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.ok(nodes.some(n => n.cp === 'orders'))
      assert.ok(!('id' in nodes[0]))
      assert.match(result.content[0].text, /^\[\d+\]\{i,t,cp,s,st\}:/)
    })

    it('returns error for invalid format', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ format: 'xml' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Invalid output format'))
      assert.ok(result.content[0].text.includes('toon'))
    })

    it('uses a requested branch from a source-backed graph', async () => {
      const source = new FileGraphSource({ graphDir: fixtureGraphDir })
      const branch = await source.defaultBranch()
      const handlers = createMcpHandlers(graph, source)
      const result = await handlers.list_nodes({ branch, filter: { component: 'orders' }, format: 'json' })
      const nodes = JSON.parse(result.content[0].text)

      assert.equal(nodes.length, 113)
      assert.ok(nodes.every((node: Record<string, unknown>) => node.component === 'orders'))
    })

    it('lists nodes from the selected source-backed branch', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-'))
      try {
        await createMultiBranchRepo(tmpDir)
        const source = new GitGraphSource({ localPath: tmpDir })
        const mainGraph = await loadGraph({ source, strict: false })
        const handlers = createMcpHandlers(mainGraph, source)

        const defaultResult = await handlers.list_nodes({ format: 'json' })
        const defaultNodes = JSON.parse(defaultResult.content[0].text) as Array<Record<string, unknown>>
        const branchResult = await handlers.list_nodes({ branch: 'feat/add-payment', format: 'json' })
        const branchNodes = JSON.parse(branchResult.content[0].text) as Array<Record<string, unknown>>

        assert.ok(!defaultNodes.some(node => node.id === 'orders.DomainModel.payment'))
        assert.ok(branchNodes.some(node => node.id === 'orders.DomainModel.payment'))
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('branch tools', () => {
    it('list_branches returns an error without a graph source', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_branches({})

      assert.equal(result.isError, true)
      assert.ok(result.content[0].text.includes('GraphSource'))
    })

    it('diff_branch returns an error without a graph source', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.diff_branch({ branch: 'main' })

      assert.equal(result.isError, true)
      assert.ok(result.content[0].text.includes('GraphSource'))
    })

    it('list_branches returns the loaded default branch from FileGraphSource', async () => {
      const source = new FileGraphSource({ graphDir: fixtureGraphDir })
      const expectedBranch = await source.defaultBranch()
      const handlers = createMcpHandlers(graph, source)
      const result = await handlers.list_branches({ format: 'json' })
      const branches = JSON.parse(result.content[0].text)

      assert.deepEqual(branches, [{ ref: expectedBranch, status: 'loaded', isDefault: true }])
    })

    it('diff_branch returns added nodes from a source-backed branch', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-'))
      try {
        await createMultiBranchRepo(tmpDir)
        const source = new GitGraphSource({ localPath: tmpDir })
        const mainGraph = await loadGraph({ source, strict: false })
        const handlers = createMcpHandlers(mainGraph, source)
        const result = await handlers.diff_branch({ branch: 'feat/add-payment', format: 'json' })
        const diff = JSON.parse(result.content[0].text) as { added: Array<Record<string, unknown>> }

        assert.ok(diff.added.some(node => node.id === 'orders.DomainModel.payment'))
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('list_templates', () => {
    it('returns template summaries with no filter', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_templates({ format: 'json' })
      const templates = JSON.parse(result.content[0].text)
      const domainModel = templates.find((template: Record<string, unknown>) => template.name === 'DomainModel')

      assert.ok(templates.length > 0)
      assert.equal(domainModel.name, 'DomainModel')
      assert.equal(domainModel.version, '1.0.0')
      assert.equal(domainModel.abstract, false)
      assert.equal(domainModel.core, false)
      assert.ok(typeof domainModel.description === 'string')
      assert.ok(!('properties' in domainModel))
    })

    it('returns YAML by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_templates({})
      const templates = parseYaml(result.content[0].text) as Array<Record<string, unknown>>

      assert.ok(templates.some(template => template.name === 'DomainModel'))
    })

    it('applies compact keys to JSON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_templates({ format: 'json', compact_keys: true })
      const templates = JSON.parse(result.content[0].text)
      const domainModel = templates.find((template: Record<string, unknown>) => template.name === 'DomainModel')

      assert.equal(domainModel.name, 'DomainModel')
      assert.equal(domainModel.v, '1.0.0')
      assert.equal(domainModel.a, false)
      assert.equal(domainModel.c, false)
      assert.ok(!('version' in domainModel))
      assert.ok(!('abstract' in domainModel))
      assert.ok(!('core' in domainModel))
    })
  })

  describe('get_template', () => {
    it('returns full template details by name', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_template({ name: 'DomainModel', format: 'json' })
      const template = JSON.parse(result.content[0].text)

      assert.equal(template.name, 'DomainModel')
      assert.equal(template.info.version, '1.0.0')
      assert.equal(template.info.abstract, false)
      assert.ok('properties' in template)
      assert.ok('schemas' in template)
      assert.ok('edge-types' in template)
    })

    it('applies compact keys to JSON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_template({ name: 'DomainModel', format: 'json', compact_keys: true })
      const template = JSON.parse(result.content[0].text)

      assert.equal(template.name, 'DomainModel')
      assert.equal(template.info.v, '1.0.0')
      assert.equal(template.info.a, false)
      assert.ok(!('version' in template))
      assert.ok(!('abstract' in template))
    })

    it('returns error message for unknown template', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_template({ name: 'MissingTemplate' })

      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Template not found'))
      assert.ok(result.content[0].text.includes('MissingTemplate'))
    })
  })

  describe('get_cluster', () => {
    it('returns full cluster for DomainModel with collapse_schemas: false', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json', collapse_schemas: false, include_edges: true })
      const cluster = JSON.parse(result.content[0].text)
      assert.equal(cluster.root.id, 'orders.DomainModel.order')
      assert.equal(cluster.descendants.length, 22)
      assert.ok(Array.isArray(cluster.edges))
      assert.ok(Array.isArray(cluster.includedNodes))
      assert.ok(!('schemaVersion' in cluster.root))
      assert.ok(!('lastModifiedAt' in cluster.root))
      assert.ok(!('schemaVersion' in cluster.descendants[0]))
    })

    it('collapses schema children into schemas and enums blocks by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
      const cluster = JSON.parse(result.content[0].text)

      // Only invariant and operation descendants remain (16 schema children removed)
      assert.equal(cluster.descendants.length, 6)

      // Schemas block on root
      assert.ok(cluster.root.schemas, 'root should have schemas block')
      assert.ok('order' in cluster.root.schemas, 'primary schema should be present')
      assert.ok('order-line-item' in cluster.root.schemas, 'referenced schema should be present')

      // Primitive field
      assert.deepEqual(cluster.root.schemas['order']['id'], { type: 'uuid' })

      // Nullable field
      assert.equal(cluster.root.schemas['order']['notes'].nullable, true)

      // Local schema ref preserved
      assert.equal(cluster.root.schemas['order']['items'].$ref, '#/schemas/order-line-item')
      assert.equal(cluster.root.schemas['order']['items'].collection, 'array')

      // Local enum ref preserved
      assert.equal(cluster.root.schemas['order']['status'].$ref, '#/enums/order-status')

      // Enums block on root
      assert.ok(cluster.root.enums, 'root should have enums block')
      assert.ok('order-status' in cluster.root.enums)
      assert.deepEqual(cluster.root.enums['order-status'].values, ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'])
    })

    it('annotates field edges on collapsed fields', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
      const cluster = JSON.parse(result.content[0].text)

      // orders.DomainModel.order.schemas.order.fields.id has inbound maps-to edges from
      // several other nodes — those are on the source fields, not this field. But the field
      // itself has no outbound maps-to edges in the fixture, so edges should be absent.
      assert.ok(!cluster.root.schemas['order']['id'].edges)
    })

    it('includes cluster provenance when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({
        node_id: 'orders.DomainModel.order',
        include_provenance: true,
        format: 'json',
      })
      const cluster = JSON.parse(result.content[0].text)

      assert.ok(!('schemaVersion' in cluster.root))
      assert.equal(cluster.root.lastModifiedAt, '2026-04-23')
    })

    it('excludes edges by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
      const cluster = JSON.parse(result.content[0].text)
      assert.ok(!('edges' in cluster), 'edges should be absent by default')
    })

    it('includes edges when include_edges: true', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json', include_edges: true })
      const cluster = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(cluster.edges))
      assert.ok(cluster.edges.length > 0)
      assert.ok(!('id' in cluster.edges[0]), 'edge id should be absent by default')
      assert.ok(!('state' in cluster.edges[0]), 'edge state should be absent by default')
      assert.ok(!('stability' in cluster.edges[0]), 'edge stability should be absent by default')
      assert.ok('from' in cluster.edges[0])
      assert.ok('to' in cluster.edges[0])
      assert.ok('type' in cluster.edges[0])
    })

    it('includes edge ids when include_edge_ids: true', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json', include_edges: true, include_edge_ids: true })
      const cluster = JSON.parse(result.content[0].text)
      assert.ok('id' in cluster.edges[0])
    })

    it('excludes descendants when include_descendants: false', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json', include_descendants: false })
      const cluster = JSON.parse(result.content[0].text)
      assert.ok(!('descendants' in cluster), 'descendants should be absent')
      assert.ok(!('includedNodes' in cluster), 'includedNodes should be absent')
      assert.ok('root' in cluster)
    })

    it('filters descendants by node_types', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json', node_types: ['DomainOperation'] })
      const cluster = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(cluster.descendants))
      assert.ok(cluster.descendants.every((n: Record<string, unknown>) => n.template === 'DomainOperation'))
    })

    it('returns error message for unknown node', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('not found'))
    })

    it('returns an error for unknown edge types', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({
        node_id: 'orders.DomainModel.order',
        edge_types: ['consumes'],
        format: 'json',
      })

      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Unknown edge type'))
    })

    it('loads a cluster from a source-backed branch', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-'))
      try {
        await createMultiBranchRepo(tmpDir)
        const source = new GitGraphSource({ localPath: tmpDir })
        const mainGraph = await loadGraph({ source, strict: false })
        const handlers = createMcpHandlers(mainGraph, source)
        const result = await handlers.get_cluster({
          branch: 'feat/add-payment',
          node_id: 'orders.DomainModel.payment',
          format: 'json',
        })
        const cluster = JSON.parse(result.content[0].text)

        assert.equal(result.isError, undefined)
        assert.equal(cluster.root.id, 'orders.DomainModel.payment')
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('get_linked_fields', () => {
    it('returns 23 maps-to edges for DomainModel', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_linked_fields({ node_id: 'orders.DomainModel.order', format: 'json' })
      const linked = JSON.parse(result.content[0].text)
      assert.equal(linked.edges.length, 23)
      assert.ok(Array.isArray(linked.nodes))
      assert.ok(!('schemaVersion' in linked.nodes[0]))
      assert.ok(!('lastModifiedAt' in linked.nodes[0]))
    })

    it('includes linked field node provenance when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_linked_fields({
        node_id: 'orders.DomainModel.order',
        include_provenance: true,
        format: 'json',
      })
      const linked = JSON.parse(result.content[0].text)

      assert.ok(!('schemaVersion' in linked.nodes[0]))
      assert.ok('lastModifiedAt' in linked.nodes[0])
    })

    it('returns error message for unknown node', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_linked_fields({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
    })

    it('loads linked fields from a source-backed branch', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-'))
      try {
        await createMultiBranchRepo(tmpDir)
        const source = new GitGraphSource({ localPath: tmpDir })
        const mainGraph = await loadGraph({ source, strict: false })
        const handlers = createMcpHandlers(mainGraph, source)
        const result = await handlers.get_linked_fields({
          branch: 'feat/add-payment',
          node_id: 'orders.DomainModel.payment',
          format: 'json',
        })
        const linked = JSON.parse(result.content[0].text)

        assert.equal(result.isError, undefined)
        assert.ok(Array.isArray(linked.nodes))
        assert.ok(Array.isArray(linked.edges))
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })

  describe('get_graph_summary', () => {
    it('returns node and component counts', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph_summary({ format: 'json' })
      const summary = JSON.parse(result.content[0].text)
      assert.equal(summary.nodeCount, 151)
      assert.equal(summary.componentCount, 3)
      assert.ok(typeof summary.orphanNodeCount === 'number')
      assert.ok(typeof summary.edgesByType === 'object')
      assert.ok(summary.edgesByType.triggers > 0)
    })
  })

  describe('get_graph_metadata', () => {
    it('returns template, edge, and in-use metadata without static enums by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph_metadata({ format: 'json' })
      const data = JSON.parse(result.content[0].text)

      assert.ok(Array.isArray(data.template_names))
      assert.ok(Array.isArray(data.node_templates_in_use))
      assert.ok(Array.isArray(data.edge_types_in_use))
      assert.ok(!('valid_edge_types' in data))
      assert.ok(!('states' in data))
      assert.ok(!('stabilities' in data))
      assert.ok(!('lineage_directions' in data))
      assert.ok(!('output_formats' in data))
      assert.ok(data.template_names.includes('DomainModel'))
      assert.ok(data.node_templates_in_use.includes('DomainEvent'))
      assert.ok(data.edge_types_in_use.includes('produces'))
    })

    it('includes static enums when include_static_enums is true', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph_metadata({ include_static_enums: true, format: 'json' })
      const data = JSON.parse(result.content[0].text)

      assert.ok(Array.isArray(data.valid_edge_types))
      assert.ok(Array.isArray(data.states))
      assert.ok(Array.isArray(data.stabilities))
      assert.ok(Array.isArray(data.lineage_directions))
      assert.ok(Array.isArray(data.output_formats))
      assert.ok(data.valid_edge_types.includes('has-field'))
      assert.ok(data.states.includes('agreed'))
      assert.ok(data.stabilities.includes('stable'))
      assert.ok(data.lineage_directions.includes('both'))
      assert.ok(data.output_formats.includes('toon'))
    })
  })

  describe('search_nodes', () => {
    it('returns matched root nodes', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.search_nodes({ queries: ['order'], format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data))
      assert.ok(data.length > 0)
      assert.ok(data.some((r: Record<string, unknown>) => {
        const node = r.node as Record<string, unknown>
        return typeof node.id === 'string' && node.id.includes('order')
      }))
      const firstNode = data[0].node as Record<string, unknown>
      assert.ok(!('schemaVersion' in firstNode))
      assert.ok(!('lastModifiedAt' in firstNode))
      assert.ok(!('properties' in firstNode))
    })

    it('includes properties when full_nodes is true', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.search_nodes({ queries: ['order'], full_nodes: true, format: 'json' })
      const data = JSON.parse(result.content[0].text)
      const firstNode = data[0].node as Record<string, unknown>
      assert.ok('properties' in firstNode)
      assert.ok(!('schemaVersion' in firstNode))
    })

    it('includes provenance in search results when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.search_nodes({
        queries: ['order'],
        include_provenance: true,
        format: 'json',
      })
      const data = JSON.parse(result.content[0].text)
      const firstNode = data[0].node as Record<string, unknown>

      assert.ok(!('schemaVersion' in firstNode))
      assert.ok('lastModifiedAt' in firstNode)
    })

    it('respects page_size', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.search_nodes({ queries: ['order'], page_size: 2, format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(data.length <= 2)
    })

    it('returns error when queries missing', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.search_nodes({ format: 'json' })
      assert.ok(result.isError)
    })
  })

  describe('get_lineage', () => {
    it('returns lean downstream lineage without edges by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_lineage({
        node_ids: ['orders.DomainModel.order.operations.place'],
        format: 'json',
      })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data.nodes))
      assert.ok(!('edges' in data))
      assert.ok(data.nodes.some((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed'))
      const placed = data.nodes.find((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed')
      assert.equal(placed.depth, 1)
      assert.equal(placed.via_edge_type, 'produces')
      assert.equal(Object.keys(placed).sort().join(','), 'depth,id,origin_id,via_edge_type,via_node_id')
    })

    it('returns full lineage fields and edges when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_lineage({
        node_ids: ['orders.DomainModel.order.operations.place'],
        lean: false,
        include_edges: true,
        include_provenance: true,
        format: 'json',
      })
      const data = JSON.parse(result.content[0].text)
      const placed = data.nodes.find((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed')

      assert.ok(Array.isArray(data.edges))
      assert.equal(placed.template, 'DomainEvent')
      assert.equal(placed.component, 'orders')
      assert.ok('properties' in placed)
      assert.ok('lastModifiedAt' in placed)
      assert.ok(!('schemaVersion' in placed))
    })

    it('returns an error for unknown edge types', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_lineage({
        node_ids: ['orders.DomainModel.order.operations.place'],
        edge_types: ['consumes'],
        format: 'json',
      })

      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Unknown edge type'))
    })

    it('returns error when node_ids missing', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_lineage({ format: 'json' })
      assert.ok(result.isError)
    })
  })

  describe('get_graph', () => {
    it('returns semantic nodes without edges by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data.nodes))
      assert.ok(!('edges' in data))
      const structural = ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping']
      assert.ok(data.nodes.every((n: Record<string, unknown>) => !structural.includes(n.template as string)))
      assert.ok(!('schemaVersion' in data.nodes[0]))
      assert.ok(!('lastModifiedAt' in data.nodes[0]))
    })

    it('includes semantic edges when include_edges is true', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ include_edges: true, format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data.edges))
      assert.ok(data.edges.every((e: Record<string, unknown>) => !['has-field', 'has-value', 'renamed-from'].includes(e.type as string)))
    })

    it('includes graph node provenance when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ include_provenance: true, format: 'json' })
      const data = JSON.parse(result.content[0].text)

      assert.ok(!('schemaVersion' in data.nodes[0]))
      assert.ok('lastModifiedAt' in data.nodes[0])
    })

    it('filter by template restricts nodes', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ filter: { templates: ['DomainModel'] }, format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(data.nodes.every((n: Record<string, unknown>) => n.template === 'DomainModel'))
    })

    it('supports component, state, and stability filters', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({
        filter: { component: 'payments', state: 'agreed', stability: 'stable' },
        format: 'json',
      })
      const data = JSON.parse(result.content[0].text)

      assert.ok(data.nodes.length > 0)
      assert.ok(data.nodes.every((n: Record<string, unknown>) => n.component === 'payments'))
      assert.ok(data.nodes.every((n: Record<string, unknown>) => n.state === 'agreed'))
      assert.ok(data.nodes.every((n: Record<string, unknown>) => n.stability === 'stable'))
    })
  })

  describe('usage guide prompt', () => {
    it('mentions supported formats, graph incompleteness, and avoids mojibake', () => {
      assert.match(USAGE_GUIDE_PROMPT, /format "json"/)
      assert.match(USAGE_GUIDE_PROMPT, /Missing edges do not prove no relationship exists\./)
      assert.match(USAGE_GUIDE_PROMPT, /naming, shared component context, schema similarity, and lineage adjacency as hypotheses/i)
      assert.match(USAGE_GUIDE_PROMPT, /format "toon"/)
      assert.doesNotMatch(USAGE_GUIDE_PROMPT, /â/)
      assert.doesNotMatch(USAGE_GUIDE_PROMPT, /component list/)
    })
  })

  describe('usage guide workflow additions', () => {
    it('mentions recommended MCP workflow and provenance guidance', () => {
      assert.match(USAGE_GUIDE_PROMPT, /Call get_graph_metadata first/i)
      assert.match(USAGE_GUIDE_PROMPT, /Avoid list_nodes for discovery/i)
      assert.match(USAGE_GUIDE_PROMPT, /batched together/i)
      assert.match(USAGE_GUIDE_PROMPT, /include_provenance: true/i)
    })
  })

  describe('ensureGraphLoaded (startup load failure recovery)', () => {
    it('does not call the loader when there is no existing loadError', async () => {
      let calls = 0
      const result = await ensureGraphLoaded(graph, undefined, async () => {
        calls += 1
        return graph
      })

      assert.equal(result, undefined)
      assert.equal(calls, 0)
    })

    it('retries the load when loadError is set, and clears the error on success', async () => {
      const staleGraph: Graph = {
        nodesById: new Map(),
        edgesByFrom: new Map(),
        edgesByTo: new Map(),
        templates: new Map(),
        diagnostics: [],
      }
      let calls = 0
      const result = await ensureGraphLoaded(staleGraph, 'previous failure', async () => {
        calls += 1
        return graph
      })

      assert.equal(result, undefined)
      assert.equal(calls, 1)
      assert.equal(staleGraph.nodesById.size, graph.nodesById.size)
      assert.ok(staleGraph.nodesById.size > 0)
    })

    it('returns a fresh error and leaves the graph untouched when the retry also fails', async () => {
      const staleGraph: Graph = {
        nodesById: new Map(),
        edgesByFrom: new Map(),
        edgesByTo: new Map(),
        templates: new Map(),
        diagnostics: [],
      }
      const result = await ensureGraphLoaded(staleGraph, 'previous failure', async () => {
        throw new Error('still broken')
      })

      assert.match(result ?? '', /still broken/)
      assert.equal(staleGraph.nodesById.size, 0)
    })

    it('invokes onReload only when the retry succeeds', async () => {
      let reloadCount = 0
      await ensureGraphLoaded(graph, 'previous failure', async () => graph, () => { reloadCount += 1 })
      assert.equal(reloadCount, 1)

      reloadCount = 0
      await ensureGraphLoaded(graph, 'previous failure', async () => { throw new Error('nope') }, () => { reloadCount += 1 })
      assert.equal(reloadCount, 0)
    })
  })

  describe('branch-scoped cache reuse', () => {
    it('without a cache, each branch-scoped list_nodes call reloads all branches from the source', async () => {
      const source = new CountingBranchSource()
      const handlers = createMcpHandlers(graph, source)

      await handlers.list_nodes({ branch: 'main' })
      await handlers.list_nodes({ branch: 'main' })

      assert.equal(source.loadCount, 2)
    })

    it('with a MultiGraphCache, branch-scoped list_nodes calls reuse the cached load', async () => {
      const source = new CountingBranchSource()
      const cache = createMultiGraphCache(source)
      const handlers = createMcpHandlers(graph, source, cache)

      await handlers.list_nodes({ branch: 'main' })
      await handlers.list_nodes({ branch: 'main' })
      await handlers.get_graph_summary({ branch: 'main' })
      await handlers.list_branches({})
      await handlers.diff_branch({ branch: 'main' })

      assert.equal(source.loadCount, 1)
    })

    it('invalidating the cache forces the next branch-scoped call to reload', async () => {
      const source = new CountingBranchSource()
      const cache = createMultiGraphCache(source)
      const handlers = createMcpHandlers(graph, source, cache)

      await handlers.list_nodes({ branch: 'main' })
      cache.invalidate()
      await handlers.list_nodes({ branch: 'main' })

      assert.equal(source.loadCount, 2)
    })
  })

  describe('tool definitions', () => {
    it('advertises the lean lineage and discovery-first workflow', () => {
      const tools = getMcpToolDefinitions()
      const metadata = tools.find((tool: { name: string }) => tool.name === 'get_graph_metadata')
      const cluster = tools.find((tool: { name: string }) => tool.name === 'get_cluster')
      const search = tools.find((tool: { name: string }) => tool.name === 'search_nodes')
      const lineage = tools.find((tool: { name: string }) => tool.name === 'get_lineage')

      assert.ok(metadata)
      assert.ok(cluster)
      assert.ok(search)
      assert.ok(lineage)
      assert.match(metadata!.description, /Call this first before making traversal queries/i)
      assert.match(cluster!.description, /Not suited for following relationships across the graph; use get_lineage/i)
      assert.match(search!.description, /Prefer this over list_nodes/i)
      assert.match(lineage!.description, /Pass multiple node_ids to expand all origins in parallel/i)
      assert.match(lineage!.description, /Event fan-out/i)
      assert.equal((lineage!.inputSchema.properties.include_provenance as { description: string }).description, 'Include provenance fields on returned nodes. Default false.')
      assert.equal((lineage!.inputSchema.properties.lean as { description: string }).description, 'Return minimal lineage node shape. Default true.')
      assert.equal((lineage!.inputSchema.properties.include_edges as { description: string }).description, 'Include the edges list in the response. Default false.')
    })
  })
})

describe('MCP write tools', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  afterEach(() => {
    discardSession()
  })

  it('mutations without an open session return a helpful error pointing at start_changes', async () => {
    const handlers = createMcpHandlers(graph)
    for (const call of [
      handlers.update_node({ id: 'orders.DomainModel.order', state: 'agreed' }),
      handlers.rename_node({ id: 'orders.DomainModel.order', new_name: 'orders2' }),
      handlers.delete_node({ id: 'orders.DomainModel.order' }),
      handlers.apply_cluster({ document: { id: 'x.Y.z' }, mode: 'merge' }),
      handlers.pending_changes({}),
      handlers.commit_changes({}),
      handlers.discard_changes({}),
    ]) {
      const result = await call
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /no working session is open/)
      assert.match(result.content[0].text, /start_changes/)
    }
  })

  it('start_changes without a graph source returns an error', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.start_changes({})
    assert.equal(result.isError, true)
    assert.match(result.content[0].text, /GraphSource/)
  })

  it('runs the full flow: start_changes → apply_cluster → rename_node → pending_changes → commit_changes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-write-'))
    try {
      const source = await createWriteRepo(tmpDir)
      const mainGraph = await loadGraph({ source, strict: false })
      const handlers = createMcpHandlers(mainGraph, source)

      const started = await handlers.start_changes({ branch: 'feat/edit', create: true, format: 'json' })
      assert.equal(started.isError, undefined, started.content[0].text)
      const session = JSON.parse(started.content[0].text)
      assert.equal(session.branch, 'feat/edit')
      assert.equal(session.default_branch, 'main')
      assert.equal(session.autosave, false)

      const applied = await handlers.apply_cluster({
        document: {
          id: 'orders.Schema.customer',
          properties: { description: 'Updated contact' },
          fields: { phone: { type: 'string', nullable: true } },
        },
        mode: 'merge',
        format: 'json',
      })
      assert.equal(applied.isError, undefined, applied.content[0].text)
      const applyResult = JSON.parse(applied.content[0].text)
      assert.deepEqual(applyResult.createdIds, ['orders.Schema.customer.fields.phone'])
      assert.ok(applyResult.updatedIds.includes('orders.Schema.customer'))

      const renamed = await handlers.rename_node({ id: 'orders.Schema.invoice', new_name: 'bill', format: 'json' })
      assert.equal(renamed.isError, undefined, renamed.content[0].text)
      const renameResult = JSON.parse(renamed.content[0].text)
      assert.equal(renameResult.newId, 'orders.Schema.bill')
      assert.equal(renameResult.recordedTrail, true, 'invoice exists on the default branch head')

      // Reads reflect the working session mid-session — with and without a branch arg.
      const midSession = await handlers.list_nodes({ format: 'json' })
      const midNodes = JSON.parse(midSession.content[0].text) as Array<Record<string, unknown>>
      assert.ok(midNodes.some(n => n.id === 'orders.Schema.bill'), 'rename visible to un-branched reads')
      assert.ok(midNodes.some(n => n.id === 'orders.Schema.customer.fields.phone'), 'created child visible')
      assert.ok(!midNodes.some(n => n.id === 'orders.Schema.invoice'))

      const branchRead = await handlers.get_cluster({
        branch: 'feat/edit',
        node_id: 'orders.Schema.customer',
        collapse_schemas: false,
        format: 'json',
      })
      assert.equal(branchRead.isError, undefined, branchRead.content[0].text)
      const cluster = JSON.parse(branchRead.content[0].text)
      assert.equal(cluster.root.properties.description, 'Updated contact')
      assert.ok(cluster.descendants.some((n: Record<string, unknown>) => n.id === 'orders.Schema.customer.fields.phone'))

      const pending = await handlers.pending_changes({ format: 'json' })
      assert.equal(pending.isError, undefined, pending.content[0].text)
      const pendingResult = JSON.parse(pending.content[0].text)
      assert.equal(pendingResult.branch, 'feat/edit')
      assert.equal(pendingResult.journal.length, 2)
      assert.ok(pendingResult.diff.nodes.added >= 2, 'phone + renamed nodes count as added')

      const committed = await handlers.commit_changes({ message: 'design edits', format: 'json' })
      assert.equal(committed.isError, undefined, committed.content[0].text)
      const commitResult = JSON.parse(committed.content[0].text)
      assert.equal(commitResult.committed, true)
      assert.equal(commitResult.message, 'design edits')
      assert.equal(getActiveSession(), null, 'commit closes the session')

      const reloaded = await loadGraph({ source, ref: 'feat/edit', strict: false })
      assert.ok(reloaded.nodesById.has('orders.Schema.bill'))
      assert.ok(reloaded.nodesById.has('orders.Schema.customer.fields.phone'))
      assert.deepEqual(reloaded.nodesById.get('orders.Schema.bill')?.properties.previousNames, ['orders.Schema.invoice'])

      const main = await loadGraph({ source, ref: 'main', strict: false })
      assert.ok(main.nodesById.has('orders.Schema.invoice'), 'default branch untouched')

      // With the session closed, un-branched reads fall back to the base graph.
      const postSession = await handlers.list_nodes({ format: 'json' })
      const postNodes = JSON.parse(postSession.content[0].text) as Array<Record<string, unknown>>
      assert.ok(postNodes.some(n => n.id === 'orders.Schema.invoice'))
      assert.ok(!postNodes.some(n => n.id === 'orders.Schema.bill'))
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('validation failures return linter-style diagnostics so agents can self-correct', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-write-'))
    try {
      const source = await createWriteRepo(tmpDir)
      const mainGraph = await loadGraph({ source, strict: false })
      const handlers = createMcpHandlers(mainGraph, source)

      await handlers.start_changes({ branch: 'feat/diag', create: true, format: 'json' })

      const badEdge = await handlers.create_edge({
        from: 'orders.Schema.invoice',
        to: 'orders.Schema.customer',
        type: 'not-a-type',
        format: 'json',
      })
      assert.equal(badEdge.isError, true)
      const payload = JSON.parse(badEdge.content[0].text)
      assert.ok(Array.isArray(payload.diagnostics))
      assert.equal(payload.diagnostics[0].severity, 'error')
      assert.match(payload.diagnostics[0].message, /unknown edge type/)

      const badNode = await handlers.update_node({ id: 'orders.Schema.ghost', state: 'agreed', format: 'json' })
      assert.equal(badNode.isError, true)
      const nodePayload = JSON.parse(badNode.content[0].text)
      assert.equal(nodePayload.diagnostics[0].nodeId, 'orders.Schema.ghost')

      // Failed mutations leave no pending changes behind.
      const pending = await handlers.pending_changes({ format: 'json' })
      assert.equal(JSON.parse(pending.content[0].text).journal.length, 0)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('discard_changes aborts the session and reads revert to the committed state', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-mcp-write-'))
    try {
      const source = await createWriteRepo(tmpDir)
      const mainGraph = await loadGraph({ source, strict: false })
      const handlers = createMcpHandlers(mainGraph, source)

      await handlers.start_changes({ branch: 'feat/abort', create: true, format: 'json' })
      await handlers.update_node({
        id: 'orders.Schema.invoice',
        properties: { description: 'Never lands' },
        format: 'json',
      })

      const midSession = await handlers.list_nodes({ format: 'json' })
      assert.equal(midSession.isError, undefined)

      const discarded = await handlers.discard_changes({ format: 'json' })
      assert.equal(discarded.isError, undefined, discarded.content[0].text)
      assert.deepEqual(JSON.parse(discarded.content[0].text), { discarded: true, branch: 'feat/abort' })
      assert.equal(getActiveSession(), null)

      const postDiscard = await handlers.get_cluster({ node_id: 'orders.Schema.invoice', collapse_schemas: false, format: 'json' })
      const cluster = JSON.parse(postDiscard.content[0].text)
      assert.equal(cluster.root.properties.description, 'Invoice', 'working change gone after discard')

      const again = await handlers.discard_changes({})
      assert.equal(again.isError, true)
      assert.match(again.content[0].text, /start_changes/)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('advertises the write tools with the load-bearing warnings in their descriptions', () => {
    const tools = getMcpToolDefinitions()
    const names = tools.map(tool => tool.name)
    for (const expected of [
      'start_changes', 'apply_cluster', 'create_node', 'update_node', 'rename_node', 'delete_node',
      'create_edge', 'update_edge', 'delete_edge', 'pending_changes', 'discard_changes', 'commit_changes',
    ]) {
      assert.ok(names.includes(expected), `missing tool definition: ${expected}`)
    }

    const applyCluster = tools.find(tool => tool.name === 'apply_cluster')!
    assert.match(applyCluster.description, /ABSENT owned section means an EMPTY section/i)
    assert.match(applyCluster.description, /ALL of its children are DELETED/i)
    assert.match(applyCluster.description, /NEVER treated as a rename/i)

    const renameNode = tools.find(tool => tool.name === 'rename_node')!
    assert.match(renameNode.description, /record_trail/)
    const deleteNode = tools.find(tool => tool.name === 'delete_node')!
    assert.match(deleteNode.description, /purge/)
    assert.match(deleteNode.description, /soft/i)
    const startChanges = tools.find(tool => tool.name === 'start_changes')!
    assert.match(startChanges.description, /autosave/)
    const commitChanges = tools.find(tool => tool.name === 'commit_changes')!
    assert.match(commitChanges.description, /squash/i)
    const createNode = tools.find(tool => tool.name === 'create_node')!
    assert.match(createNode.description, /proposed/)
    assert.match(createNode.description, /unstable/)
    const diffBranch = tools.find(tool => tool.name === 'diff_branch')!
    assert.match(diffBranch.description, /edits a retired name/)
  })
})

describe('standalone MCP entrypoint', () => {
  it('keeps serving MCP over stdio when the web port is already in use', async () => {
    let webHandle: WebServerHandle | undefined
    let child: ChildProcess | undefined
    try {
      // Occupy a port with a real web server, then point the MCP process's default web port
      // at it via CORUM_WEB_PORT so startWebServer's listen() call inside startMcpServer fails.
      webHandle = await startWebServer(await loadGraph({ graphPath: fixtureGraphDir }), { port: 0, logger: () => {} })

      let stderr = ''
      let exited = false
      child = spawn(process.execPath, [path.join(repoRoot, 'dist/src/mcp/index.js')], {
        env: {
          ...process.env,
          CORUM_GRAPH_PATH: fixtureGraphDir,
          CORUM_WEB_PORT: String(webHandle.port),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      child.on('exit', () => { exited = true })
      child.stderr!.on('data', chunk => { stderr += chunk.toString() })

      const deadline = Date.now() + 5000
      while (!stderr.includes('web server failed to start') && !exited && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      assert.ok(!exited, `MCP process should not exit when the web port is busy; stderr: ${stderr}`)
      assert.match(stderr, /web server failed to start/)

      // Confirm the MCP server is still alive and responsive over stdio despite the web
      // server startup failure — send a tools/list request and wait for a JSON-RPC reply.
      let stdout = ''
      child.stdout!.on('data', chunk => { stdout += chunk.toString() })
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`)

      const rpcDeadline = Date.now() + 5000
      while (!stdout.includes('"tools"') && !exited && Date.now() < rpcDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
      assert.match(stdout, /"tools"/, `expected a tools/list JSON-RPC response over stdio; stdout: ${stdout}`)
    } finally {
      if (child && child.exitCode === null) child.kill()
      if (webHandle) await webHandle.close()
    }
  })
})

async function createMultiBranchRepo(tmpDir: string): Promise<void> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
  const graphDir = path.join(tmpDir, '.corum', 'graph')
  const componentsDir = path.join(graphDir, 'components', 'orders')
  const templatesDir = path.join(graphDir, 'packs', 'test', 'templates')
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(templatesDir, { recursive: true })
  fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'templatePacks:\n  - path: packs/test\n')
  fs.writeFileSync(path.join(templatesDir, 'domain-model.yaml'), `name: DomainModel
info:
  version: "1.0"
`)
  fs.writeFileSync(path.join(componentsDir, 'order.yaml'), clusterYaml('orders.DomainModel.order', 'agreed', 'stable'))

  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/graph.yaml' })
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/packs/test/templates/domain-model.yaml' })
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/order.yaml' })
  await git.commit({ fs, dir: tmpDir, message: 'initial', author: { name: 'Test', email: 'test@test.com' } })

  await git.branch({ fs, dir: tmpDir, ref: 'feat/add-payment', checkout: true })
  fs.writeFileSync(path.join(componentsDir, 'payment.yaml'), clusterYaml('orders.DomainModel.payment', 'proposed', 'unstable'))
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/payment.yaml' })
  await git.commit({ fs, dir: tmpDir, message: 'add payment', author: { name: 'Test', email: 'test@test.com' } })
  await git.checkout({ fs, dir: tmpDir, ref: 'main' })
}

/**
 * Git repo fixture for the write tools: a Schema template with an owned
 * `fields` section (Field children) plus two committed clusters, so
 * apply_cluster/rename/delete exercise owned-section semantics.
 */
async function createWriteRepo(tmpDir: string): Promise<GitGraphSource> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
  const files: Record<string, string> = {
    '.corum/packs/testpack/templates/Schema.yaml': `name: Schema
info:
  version: '1.0.0'
  role: type-container
properties:
  type: object
  additionalProperties: false
  properties:
    description:
      type: string
fields:
  item-template: Field
edge-types:
  outgoing:
    - has-field
    - uses-type
  incoming:
    - uses-type
`,
    '.corum/packs/testpack/templates/Field.yaml': `name: Field
info:
  version: '1.0.0'
  role: field
properties:
  type: object
  additionalProperties: false
  properties:
    type:
      type: string
    nullable:
      type: boolean
edge-types:
  incoming:
    - has-field
  supports:
    - maps-to
`,
    '.corum/graph/graph.yaml': `schemaVersion: '1'\ntemplatePacks:\n  - name: testpack\n    path: ../packs/testpack\n`,
    '.corum/graph/components/orders/Schemas/customer.yaml': `id: orders.Schema.customer
template: Schema
schemaVersion: '1.0'
metadata:
  component: orders
  state: agreed
  stability: stable
  lastModifiedAt: '2026-07-01'
properties:
  description: 'Customer contact'
fields:
  email:
    type: string
    nullable: false
`,
    '.corum/graph/components/orders/Schemas/invoice.yaml': `id: orders.Schema.invoice
template: Schema
schemaVersion: '1.0'
metadata:
  component: orders
  state: proposed
  stability: unstable
  lastModifiedAt: '2026-07-01'
properties:
  description: 'Invoice'
`,
  }
  for (const [rel, content] of Object.entries(files)) {
    const filePath = path.join(tmpDir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, content)
    await git.add({ fs, dir: tmpDir, filepath: rel })
  }
  await git.commit({ fs, dir: tmpDir, message: 'initial', author: { name: 'Test', email: 'test@test.com' } })
  return new GitGraphSource({ localPath: tmpDir })
}

function clusterYaml(id: string, state: string, stability: string): string {
  return `id: ${id}
template: DomainModel
schemaVersion: "1.0"
metadata:
  component: orders
  state: ${state}
  stability: ${stability}
  lastModifiedAt: "2026-01-01"
`
}

class CountingBranchSource implements GraphSource {
  loadCount = 0

  async defaultBranch(): Promise<string> {
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    this.loadCount += 1
    return ['main']
  }

  async loadPackContent(): Promise<ContentMap> {
    return new Map()
  }

  async loadGraphContent(): Promise<ContentMap> {
    return new Map()
  }

  async commit(): Promise<void> {
    throw new Error('not implemented')
  }

  async head(): Promise<string> {
    return 'fake-head'
  }

  async log(): Promise<string[]> {
    return []
  }
}
