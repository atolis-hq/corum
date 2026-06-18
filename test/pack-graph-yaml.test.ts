import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'yaml'
import { registerPackInGraph } from '../src/pack/graph-yaml.js'

const minimalGraph = `schema-version: '1.0'\nname: My Graph\ntemplatePacks: []\ncomponents: []\n`

describe('registerPackInGraph', () => {
  it('appends a templatePacks entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8')) as { templatePacks: Array<{ name: string; path: string }> }
      assert.equal(parsed.templatePacks.length, 1)
      assert.deepEqual(parsed.templatePacks[0], { name: 'core', path: '../packs/core' })
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('does not duplicate an existing entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8')) as { templatePacks: Array<{ name: string; path: string }> }
      assert.equal(parsed.templatePacks.length, 1)
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('appends multiple packs independently', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const graphPath = path.join(dir, 'graph.yaml')
      fs.writeFileSync(graphPath, minimalGraph)
      await registerPackInGraph(graphPath, 'core', '../packs/core')
      await registerPackInGraph(graphPath, 'domain', '../packs/domain')
      const parsed = parse(fs.readFileSync(graphPath, 'utf8')) as { templatePacks: Array<{ name: string; path: string }> }
      assert.equal(parsed.templatePacks.length, 2)
      assert.equal(parsed.templatePacks[0].name, 'core')
      assert.equal(parsed.templatePacks[1].name, 'domain')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
