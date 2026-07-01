import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as git from 'isomorphic-git'
import { parse as parseYaml } from 'yaml'
import { decode as decodeToon } from '@toon-format/toon'
import { createMcpHandlers } from '../src/mcp/index.js'
import { loadGraph } from '../src/loader/index.js'
import type { Graph } from '../src/schema/index.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'

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
    it('returns full cluster for DomainModel', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
      const cluster = JSON.parse(result.content[0].text)
      assert.equal(cluster.root.id, 'orders.DomainModel.order')
      assert.equal(cluster.descendants.length, 22)
      assert.ok(Array.isArray(cluster.edges))
      assert.ok(Array.isArray(cluster.includedNodes))
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
    it('returns downstream lineage with annotations', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_lineage({
        node_ids: ['orders.DomainModel.order.operations.place'],
        format: 'json',
      })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data.nodes))
      assert.ok(Array.isArray(data.edges))
      assert.ok(data.nodes.some((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed'))
      const placed = data.nodes.find((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed')
      assert.equal(placed.depth, 1)
      assert.equal(placed.via_edge_type, 'produces')
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
    it('returns semantic nodes and edges without structural templates', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(Array.isArray(data.nodes))
      assert.ok(Array.isArray(data.edges))
      const structural = ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping']
      assert.ok(data.nodes.every((n: Record<string, unknown>) => !structural.includes(n.template as string)))
      assert.ok(data.edges.every((e: Record<string, unknown>) => !['has-field', 'has-value', 'renamed-from'].includes(e.type as string)))
    })

    it('filter by template restricts nodes', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_graph({ filter: { templates: ['DomainModel'] }, format: 'json' })
      const data = JSON.parse(result.content[0].text)
      assert.ok(data.nodes.every((n: Record<string, unknown>) => n.template === 'DomainModel'))
    })
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
