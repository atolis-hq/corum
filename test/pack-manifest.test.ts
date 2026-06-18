import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readManifest, upsertPack } from '../src/pack/manifest.js'
import type { InstalledPack } from '../src/pack/manifest.js'

const entry: InstalledPack = {
  name: 'core',
  repo: 'https://github.com/atolis-hq/corum',
  path: '.corum/packs/core',
  ref: 'v0.1.6',
  installedAt: '2026-06-18T00:00:00.000Z',
}

describe('readManifest', () => {
  it('returns an empty manifest if the file does not exist', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifest = await readManifest(path.join(dir, 'packs.yaml'))
      assert.deepEqual(manifest, { packs: [] })
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})

describe('upsertPack', () => {
  it('creates a new manifest with one entry', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 1)
      assert.equal(manifest.packs[0].name, 'core')
      assert.equal(manifest.packs[0].ref, 'v0.1.6')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('updates existing entry by name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      await upsertPack(manifestPath, { ...entry, ref: 'v0.2.0' })
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 1)
      assert.equal(manifest.packs[0].ref, 'v0.2.0')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('appends a new entry without affecting existing ones', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    try {
      const manifestPath = path.join(dir, 'packs.yaml')
      await upsertPack(manifestPath, entry)
      await upsertPack(manifestPath, { ...entry, name: 'domain', path: '.corum/packs/domain' })
      const manifest = await readManifest(manifestPath)
      assert.equal(manifest.packs.length, 2)
      assert.equal(manifest.packs[0].name, 'core')
      assert.equal(manifest.packs[1].name, 'domain')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
