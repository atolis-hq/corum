import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSpec } from '../../../src/adapters/corum/parser.js'

function writeTmp(content: string): { filePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-parser-'))
  const filePath = path.join(dir, 'test.corum.yaml')
  fs.writeFileSync(filePath, content)
  return { filePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('parseSpec', () => {
  it('returns document for a valid interchange file', () => {
    const { filePath, cleanup } = writeTmp(`
corumInterchange: "1.0"
nodes:
  - id: orders.DomainEvent.OrderPlaced
    template: DomainEvent
    properties: {}
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.equal(document.corumInterchange, '1.0')
    assert.equal(document.nodes.length, 1)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })

  it('returns null and error diagnostic when corumInterchange key is missing', () => {
    const { filePath, cleanup } = writeTmp(`
nodes:
  - id: orders.DomainEvent.OrderPlaced
    template: DomainEvent
    properties: {}
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is missing', () => {
    const { filePath, cleanup } = writeTmp(`corumInterchange: "1.0"`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns document with warning for unknown version', () => {
    const { filePath, cleanup } = writeTmp(`
corumInterchange: "2.0"
nodes: []
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('2.0')))
    cleanup()
  })

  it('returns null and error diagnostic for invalid YAML', () => {
    const { filePath, cleanup } = writeTmp(`{ bad yaml: [`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when file does not exist', () => {
    const { document, diagnostics } = parseSpec('/nonexistent/path.corum.yaml')
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
  })
})
