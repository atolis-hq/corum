import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LoadError, QueryError } from '../src/schema/index.js'

describe('schema error classes', () => {
  it('LoadError.message includes error count', () => {
    const err = new LoadError([
      { severity: 'error', file: 'a.yaml', message: 'bad' },
      { severity: 'error', file: 'b.yaml', message: 'also bad' },
      { severity: 'warning', file: 'c.yaml', message: 'minor' },
    ])
    assert.ok(err instanceof Error)
    assert.ok(err.message.includes('2 error'))
    assert.equal(err.diagnostics.length, 3)
    assert.equal(err.name, 'LoadError')
  })

  it('LoadError with zero errors still constructs', () => {
    const err = new LoadError([{ severity: 'warning', file: 'x.yaml', message: 'warn' }])
    assert.ok(err.message.includes('0 error'))
  })

  it('QueryError is an Error with correct name', () => {
    const err = new QueryError('Node not found: foo.Bar.baz')
    assert.ok(err instanceof Error)
    assert.equal(err.name, 'QueryError')
    assert.equal(err.message, 'Node not found: foo.Bar.baz')
  })
})
