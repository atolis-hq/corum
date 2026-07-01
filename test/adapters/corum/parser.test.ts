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
corum: "1.0"
nodes:
  orders.DomainEvent.OrderPlaced:
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.equal(document.corum, '1.0')
    assert.ok('orders.DomainEvent.OrderPlaced' in document.nodes)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })

  it('returns null and error diagnostic when corum key is missing', () => {
    const { filePath, cleanup } = writeTmp(`
nodes:
  orders.DomainEvent.OrderPlaced:
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is missing', () => {
    const { filePath, cleanup } = writeTmp(`corum: "1.0"`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is an array (old format)', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  - id: orders.DomainEvent.OrderPlaced
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns document with warning for unknown version', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "2.0"
nodes: {}
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

  it('parses components.schemas when present', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  orders.Command.PlaceOrderCommand:
    type: Command
    schema:
      $ref: '#/components/schemas/PlaceOrderCommand'
components:
  schemas:
    PlaceOrderCommand:
      type: object
      properties:
        OrderId:
          type: string
          format: uuid
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.ok(document.components?.schemas?.['PlaceOrderCommand'] !== undefined)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })

  it('parses x-aka when present on a node', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  billing.APIEndpoint.GetInvoiceController:
    type: APIEndpoint
    x-aka:
      - GetInvoice
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    const node = document.nodes['billing.APIEndpoint.GetInvoiceController']
    assert.deepEqual(node['x-aka'], ['GetInvoice'])
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })
})
