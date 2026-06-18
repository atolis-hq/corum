import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadProjectConfig } from '../src/source/config-file.js'

describe('loadProjectConfig', () => {
  it('returns empty object when no config file exists', () => {
    const result = loadProjectConfig(os.tmpdir())
    assert.deepEqual(result, {})
  })

  it('loads config from .corum/config.yaml in cwd', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'source: git\ngit_branch: develop\n')
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.source, 'git')
      assert.equal(result.git_branch, 'develop')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('finds config file in a parent directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(root, '.corum'))
    fs.writeFileSync(path.join(root, '.corum', 'config.yaml'), 'graph: /custom/graph\n')
    const nested = path.join(root, 'subdir', 'deep')
    fs.mkdirSync(nested, { recursive: true })
    try {
      const result = loadProjectConfig(nested)
      assert.equal(result.graph, '/custom/graph')
    } finally {
      fs.rmSync(root, { recursive: true })
    }
  })

  it('returns empty object when config file is all comments', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), '# all commented out\n')
    try {
      const result = loadProjectConfig(dir)
      assert.deepEqual(result, {})
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('parses git_poll_seconds as a number', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'git_poll_seconds: 60\n')
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.git_poll_seconds, 60)
      assert.equal(typeof result.git_poll_seconds, 'number')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('loads pack_registry as a string', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(
      path.join(dir, '.corum', 'config.yaml'),
      'pack_registry: https://github.com/atolis-hq/corum/packs/registry.yaml\n',
    )
    try {
      const result = loadProjectConfig(dir)
      assert.equal(result.pack_registry, 'https://github.com/atolis-hq/corum/packs/registry.yaml')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })
})
