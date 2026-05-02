import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { GhostState, OverlayNode, BranchGraph, MultiGraph } from '../src/schema/index.js'

describe('schema types (compile check)', () => {
  it('GhostState covers all expected values', () => {
    const states: GhostState[] = [
      'local', 'local-modified', 'shared',
      'default-only', 'ghost-single', 'ghost-consensus', 'ghost-conflict',
    ]
    assert.equal(states.length, 7)
  })
})
