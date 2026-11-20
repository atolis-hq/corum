import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { matchKeysFor } = await import(pathToFileURL(path.join(process.cwd(), 'web', 'sdk', 'match-keys.js')).href)

const templates = new Map<string, { name: string; extends?: string; role?: string }>([
  ['Schema', { name: 'Schema', role: 'type-container' }],
  ['AvroSchema', { name: 'AvroSchema', extends: 'Schema' }],
  ['Plain', { name: 'Plain' }],
])

describe('matchKeysFor', () => {
  it('includes the template, its extends chain and the resolved role', () => {
    assert.deepEqual(matchKeysFor('AvroSchema', templates), ['AvroSchema', 'Schema', 'type-container'])
  })

  it('has no role entry when none resolves', () => {
    assert.deepEqual(matchKeysFor('Plain', templates), ['Plain'])
  })

  it('tolerates unknown templates and extends cycles', () => {
    assert.deepEqual(matchKeysFor('Nope', templates), ['Nope'])
    const cyclic = new Map([['A', { name: 'A', extends: 'B' }], ['B', { name: 'B', extends: 'A' }]])
    assert.deepEqual(matchKeysFor('A', cyclic), ['A', 'B'])
  })
})
