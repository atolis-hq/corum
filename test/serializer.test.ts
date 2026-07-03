import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { parse as parseYaml } from 'yaml'
import { decode as decodeToon } from '@toon-format/toon'
import {
  JsonSerializer,
  YamlSerializer,
  ToonSerializer,
  getSerializer,
  compactKeys,
} from '../src/mcp/serializers.js'

const sample = [
  {
    id: 'orders.APIEndpoint.create-order',
    template: 'APIEndpoint',
    component: 'orders',
    state: 'agreed',
    stability: 'stable',
  },
]

describe('MCP serializers', () => {
  it('JsonSerializer serializes with JSON.stringify', () => {
    const text = new JsonSerializer().serialize(sample)
    assert.deepEqual(JSON.parse(text), sample)
    assert.ok(text.includes('\n  {'))
  })

  it('YamlSerializer serializes with yaml library output', () => {
    const text = new YamlSerializer().serialize(sample)
    assert.deepEqual(parseYaml(text), sample)
    assert.match(text, /^- id: orders\.APIEndpoint\.create-order/m)
  })

  it('ToonSerializer serializes with the TOON library', () => {
    const text = new ToonSerializer().serialize(sample)
    assert.deepEqual(decodeToon(text), sample)
    assert.match(text, /^\[1\]\{id,template,component,state,stability\}:/)
  })

  it('getSerializer resolves yaml by default and rejects old LEAN format', () => {
    assert.ok(getSerializer(undefined) instanceof YamlSerializer)
    assert.ok(getSerializer('json') instanceof JsonSerializer)
    assert.ok(getSerializer('yaml') instanceof YamlSerializer)
    assert.ok(getSerializer('toon') instanceof ToonSerializer)
    assert.throws(() => getSerializer('LEAN'), /Invalid output format/)
  })

  it('compactKeys maps common graph keys recursively without changing source data', () => {
    const source = {
      id: 'root',
      template: 'DomainModel',
      component: 'orders',
      state: 'agreed',
      stability: 'stable',
      schemaVersion: '1',
      lastModifiedAt: '2026-04-17',
      extractedFrom: 'file.yaml',
      properties: { description: 'Order' },
      root: { id: 'child' },
      children: [{ id: 'grandchild' }],
      edges: [{ from: 'a', to: 'b', type: 'reads', notes: 'edge note' }],
      nodes: [{ id: 'n' }],
    }

    assert.deepEqual(compactKeys(source), {
      i: 'root',
      t: 'DomainModel',
      cp: 'orders',
      s: 'agreed',
      st: 'stable',
      sv: '1',
      lm: '2026-04-17',
      xf: 'file.yaml',
      p: { description: 'Order' },
      r: { i: 'child' },
      ch: [{ i: 'grandchild' }],
      e: [{ fr: 'a', to: 'b', ty: 'reads', nt: 'edge note' }],
      n: [{ i: 'n' }],
    })
    assert.equal(source.id, 'root')
    assert.deepEqual(source.edges[0], { from: 'a', to: 'b', type: 'reads', notes: 'edge note' })
  })

  it('compactKeys leaves user-authored property data untouched', () => {
    const source = {
      id: 'orders.Schema.order.fields.id',
      template: 'Field',
      properties: {
        type: 'string',
        notes: 'primary key',
        nested: { id: 'user-value', from: 'somewhere', version: 2 },
      },
    }

    assert.deepEqual(compactKeys(source), {
      i: 'orders.Schema.order.fields.id',
      t: 'Field',
      p: {
        type: 'string',
        notes: 'primary key',
        nested: { id: 'user-value', from: 'somewhere', version: 2 },
      },
    })
  })
})
