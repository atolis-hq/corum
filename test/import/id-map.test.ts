import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { IdResolver, applyRule, parseIdMap } from '../../src/import/id-map.js'

function resolver(maps: string[], nodes: string[], sourceIds: Record<string, string[]> = {}) {
  const set = new Set(nodes)
  return new IdResolver({
    hasNode: id => set.has(id),
    aliases: new Map(),
    sourceIds: new Map(Object.entries(sourceIds).map(([k, v]) => [k, new Set(v)])),
    maps: maps.map((text, i) => parseIdMap(`map${i}.yaml`, text)),
  })
}

describe('id-map patterns and transforms', () => {
  const rule = (from: string, to: string) => parseIdMap('m.yaml', `rules:\n  - from: "${from}"\n    to: "${to}"\n`).rules[0]

  it('matches literal text with named captures and applies transforms', () => {
    const r = rule('clr:{area}.Contracts.{type}#{field}', 'openapi:{area|lower}/schema/{type}/{field|camel}')
    assert.equal(applyRule(r, 'clr:Orders.Contracts.CreateOrderRequest#CustomerId'), 'openapi:orders/schema/CreateOrderRequest/customerId')
    assert.equal(applyRule(r, 'clr:Orders.Other.X#Y'), undefined)
  })

  it('kebab and pascal', () => {
    const r = rule('a:{x}', 'b:{x|kebab}/{x|pascal}')
    assert.equal(applyRule(r, 'a:orderLineItem'), 'b:order-line-item/OrderLineItem')
    assert.equal(applyRule(r, 'a:HTTPServer'), 'b:http-server/HTTPServer')
  })

  it('captures exclude dots, hashes, slashes and whitespace', () => {
    const r = rule('a:{x}', 'b:{x}')
    assert.equal(applyRule(r, 'a:one.two'), undefined)
    assert.equal(applyRule(r, 'a:one#two'), undefined)
    assert.equal(applyRule(r, 'a:one/two'), undefined)
    assert.equal(applyRule(r, 'a:one two'), undefined)
  })

  it('rejects unknown transforms, unknown captures and unknown keys', () => {
    assert.throws(() => rule('a:{x}', 'b:{x|shout}'), /unknown transform/)
    assert.throws(() => rule('a:{x}', 'b:{y}'), /does not define/)
    assert.throws(() => parseIdMap('m.yaml', 'rules:\n  - from: a\n    to: b\n    extra: 1\n'), /unknown key/)
    assert.throws(() => parseIdMap('m.yaml', 'rules:\n  - from: a\n'), /"to"/)
    assert.throws(() => parseIdMap('m.yaml', 'other: 1\n'), /unknown key/)
  })
})

describe('IdResolver precedence', () => {
  const nodes = ['orders.Schema.A', 'orders.Schema.B']
  const ids = { 'spec:a': ['orders.Schema.A'], 'spec:b': ['orders.Schema.B'] }

  it('an exact Corum ID wins over everything', () => {
    const r = resolver(['exact:\n  orders.Schema.A: spec:b\n'], nodes, ids)
    assert.deepEqual(r.resolve('orders.Schema.A'), { kind: 'resolved', target: 'orders.Schema.A', via: 'node' })
  })

  it('a registered source ID resolves before maps', () => {
    const r = resolver(['exact:\n  spec:a: spec:b\n'], nodes, ids)
    assert.equal(r.resolve('spec:a').kind === 'resolved' && (r.resolve('spec:a') as { target: string }).target, 'orders.Schema.A')
  })

  it('an exact entry in a later file overrides a rule in an earlier file, with no ambiguity', () => {
    const r = resolver(
      ['rules:\n  - from: "clr:{n}"\n    to: "spec:a"\n', 'exact:\n  clr:x: spec:b\n'],
      nodes, ids,
    )
    assert.deepEqual(r.resolve('clr:x'), { kind: 'resolved', target: 'orders.Schema.B', via: 'exact' })
    const { summary, diagnostics } = r.finish()
    assert.equal(summary.rules[0].overridden, 1)
    assert.equal(diagnostics.length, 0)
  })

  it('between exact entries the earliest file wins and the later one is warned about', () => {
    const r = resolver(['exact:\n  clr:x: spec:a\n', 'exact:\n  clr:x: spec:b\n'], nodes, ids)
    assert.equal((r.resolve('clr:x') as { target: string }).target, 'orders.Schema.A')
    assert.ok(r.finish().diagnostics.some(d => d.message.includes('earlier file wins')))
  })

  it('rules with distinct targets are ambiguous, even across files', () => {
    const r = resolver(
      ['rules:\n  - from: "clr:{n}"\n    to: "spec:a"\n', 'rules:\n  - from: "clr:{n}"\n    to: "spec:b"\n'],
      nodes, ids,
    )
    const res = r.resolve('clr:x')
    assert.equal(res.kind, 'ambiguous')
    assert.deepEqual((res as { candidates: string[] }).candidates, ['orders.Schema.A', 'orders.Schema.B'])
  })

  it('rules producing the same target resolve without a warning', () => {
    const r = resolver(
      ['rules:\n  - from: "clr:{n}"\n    to: "spec:a"\n  - from: "clr:{n}"\n    to: "orders.Schema.A"\n'],
      nodes, ids,
    )
    assert.equal((r.resolve('clr:x') as { target: string }).target, 'orders.Schema.A')
    assert.equal(r.finish().diagnostics.length, 0)
  })

  it('a rule candidate only counts when it resolves', () => {
    const r = resolver(['rules:\n  - from: "clr:{n}"\n    to: "spec:missing/{n}"\n'], nodes, ids)
    assert.equal(r.resolve('clr:x').kind, 'unresolved')
  })

  it('warns about rules that matched nothing', () => {
    const r = resolver(['rules:\n  - from: "zzz:{n}"\n    to: "spec:a"\n'], nodes, ids)
    assert.ok(r.finish().diagnostics.some(d => d.message.includes('matched no reference')))
  })
})
