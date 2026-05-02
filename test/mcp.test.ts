import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { decode as decodeToon } from '@toon-format/toon'
import { createMcpHandlers } from '../src/mcp/index.js'
import { loadGraph } from '../src/loader/index.js'
import type { Graph } from '../src/schema/index.js'
import { FileGraphSource } from '../src/source/file-source.js'

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
      const result = await handlers.list_nodes({ template: 'APIEndpoint', format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some((n: Record<string, unknown>) => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('filters by component', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ component: 'orders', format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 113)
    })

    it('returns YAML by default', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ template: 'APIEndpoint' })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('returns TOON output using the toon format', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ template: 'APIEndpoint', format: 'toon' })
      assert.match(result.content[0].text, /^\[\d+\]\{id,template,component,state,stability\}:/)
    })

    it('TOON output round trips through the official library', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ template: 'APIEndpoint', format: 'toon' })
      const nodes = decodeToon(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.equal(nodes[0].template, 'APIEndpoint')
      assert.ok(nodes.some(n => n.id === 'orders.APIEndpoint.create-order'))
    })

    it('applies compact keys to JSON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ template: 'APIEndpoint', format: 'json', compact_keys: true })
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
      const result = await handlers.list_nodes({ template: 'APIEndpoint', compactKeys: true })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 5)
      assert.ok(nodes.some(n => n.i === 'orders.APIEndpoint.create-order'))
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.ok(nodes.some(n => n.cp === 'orders'))
      assert.ok(!('id' in nodes[0]))
    })

    it('applies compact keys to TOON output when requested', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.list_nodes({ template: 'APIEndpoint', format: 'toon', compact_keys: true })
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
      const result = await handlers.list_nodes({ branch, component: 'orders', format: 'json' })
      const nodes = JSON.parse(result.content[0].text)

      assert.equal(nodes.length, 113)
      assert.ok(nodes.every((node: Record<string, unknown>) => node.component === 'orders'))
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
      assert.equal(cluster.children.length, 22)
      assert.ok(Array.isArray(cluster.edges))
    })

    it('returns error message for unknown node', async () => {
      const handlers = createMcpHandlers(graph)
      const result = await handlers.get_cluster({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('not found'))
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
  })
})
