import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { decode as decodeToon } from '@toon-format/toon'
import { createMcpHandlers } from '../src/mcp/index.js'
import { loadGraph } from '../src/loader/index.js'
import type { Graph } from '../src/schema/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('MCP handlers', () => {
  let graph: Graph

  before(async () => {
    graph = await loadGraph({ graphPath: fixtureGraphDir })
  })

  describe('list_nodes', () => {
    it('returns all nodes with no filter', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 45)
      assert.ok('id' in nodes[0])
      assert.ok('template' in nodes[0])
      assert.ok('state' in nodes[0])
      assert.ok(!('properties' in nodes[0]))
    })

    it('filters by template', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].id, 'orders.APIEndpoint.create-order')
    })

    it('filters by component', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ component: 'orders', format: 'json' })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes.length, 45)
    })

    it('returns YAML by default', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint' })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].id, 'orders.APIEndpoint.create-order')
    })

    it('returns TOON output using the toon format', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', format: 'toon' })
      assert.match(result.content[0].text, /^\[1\]\{id,template,component,state,stability\}:/)
    })

    it('TOON output round trips through the official library', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', format: 'toon' })
      const nodes = decodeToon(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes.length, 1)
      assert.equal(nodes[0].id, 'orders.APIEndpoint.create-order')
      assert.equal(nodes[0].template, 'APIEndpoint')
    })

    it('applies compact keys to JSON output when requested', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', format: 'json', compact_keys: true })
      const nodes = JSON.parse(result.content[0].text)
      assert.equal(nodes[0].i, 'orders.APIEndpoint.create-order')
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.equal(nodes[0].cp, 'orders')
      assert.equal(nodes[0].st, 'stable')
      assert.ok(!('id' in nodes[0]))
      assert.ok(!('component' in nodes[0]))
      assert.ok(!('stability' in nodes[0]))
    })

    it('applies compact keys to YAML output when requested', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', compactKeys: true })
      const nodes = parseYaml(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes[0].i, 'orders.APIEndpoint.create-order')
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.equal(nodes[0].cp, 'orders')
      assert.ok(!('id' in nodes[0]))
    })

    it('applies compact keys to TOON output when requested', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ template: 'APIEndpoint', format: 'toon', compact_keys: true })
      const nodes = decodeToon(result.content[0].text) as Array<Record<string, unknown>>
      assert.equal(nodes[0].i, 'orders.APIEndpoint.create-order')
      assert.equal(nodes[0].t, 'APIEndpoint')
      assert.equal(nodes[0].cp, 'orders')
      assert.ok(!('id' in nodes[0]))
      assert.match(result.content[0].text, /^\[1\]\{i,t,cp,s,st\}:/)
    })

    it('returns error for invalid format', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_nodes({ format: 'xml' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Invalid output format'))
      assert.ok(result.content[0].text.includes('toon'))
    })
  })

  describe('list_templates', () => {
    it('returns template summaries with no filter', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_templates({ format: 'json' })
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

    it('returns YAML by default', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_templates({})
      const templates = parseYaml(result.content[0].text) as Array<Record<string, unknown>>

      assert.ok(templates.some(template => template.name === 'DomainModel'))
    })

    it('applies compact keys to JSON output when requested', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.list_templates({ format: 'json', compact_keys: true })
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
    it('returns full template details by name', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_template({ name: 'DomainModel', format: 'json' })
      const template = JSON.parse(result.content[0].text)

      assert.equal(template.name, 'DomainModel')
      assert.equal(template.version, '1.0.0')
      assert.equal(template.abstract, false)
      assert.ok('properties' in template)
      assert.ok('schemas' in template)
      assert.ok('edge-types' in template)
    })

    it('applies compact keys to JSON output when requested', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_template({ name: 'DomainModel', format: 'json', compact_keys: true })
      const template = JSON.parse(result.content[0].text)

      assert.equal(template.name, 'DomainModel')
      assert.equal(template.v, '1.0.0')
      assert.equal(template.a, false)
      assert.ok(!('version' in template))
      assert.ok(!('abstract' in template))
    })

    it('returns error message for unknown template', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_template({ name: 'MissingTemplate' })

      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('Template not found'))
      assert.ok(result.content[0].text.includes('MissingTemplate'))
    })
  })

  describe('get_cluster', () => {
    it('returns full cluster for DomainModel', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
      const cluster = JSON.parse(result.content[0].text)
      assert.equal(cluster.root.id, 'orders.DomainModel.order')
      assert.equal(cluster.children.length, 20)
      assert.ok(Array.isArray(cluster.edges))
    })

    it('returns error message for unknown node', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_cluster({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
      assert.ok(result.content[0].text.includes('not found'))
    })
  })

  describe('get_linked_fields', () => {
    it('returns 7 maps-to edges for DomainModel', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_linked_fields({ node_id: 'orders.DomainModel.order', format: 'json' })
      const linked = JSON.parse(result.content[0].text)
      assert.equal(linked.edges.length, 7)
      assert.ok(Array.isArray(linked.nodes))
    })

    it('returns error message for unknown node', () => {
      const handlers = createMcpHandlers(graph)
      const result = handlers.get_linked_fields({ node_id: 'nonexistent.Node.id' })
      assert.ok(result.isError)
    })
  })
})
