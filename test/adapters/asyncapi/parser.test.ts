import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseSpec } from '../../../src/adapters/asyncapi/parser.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
const specsDir = path.join(repoRoot, 'test', 'fixtures', 'asyncapi', 'specs')

describe('parseSpec', () => {
  it('parses an AsyncAPI v3 spec and returns a document', async () => {
    const { document, diagnostics } = await parseSpec(path.join(specsDir, 'petstore-v3.yaml'))
    assert.ok(document, 'document should be defined')
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('parses an AsyncAPI v2 spec and returns a document', async () => {
    const { document, diagnostics } = await parseSpec(path.join(specsDir, 'petstore-v2.yaml'))
    assert.ok(document, 'document should be defined')
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('returns null document and error diagnostic for a missing file', async () => {
    const { document, diagnostics } = await parseSpec('/nonexistent/path/spec.yaml')
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'), 'should have at least one error diagnostic')
  })
})
