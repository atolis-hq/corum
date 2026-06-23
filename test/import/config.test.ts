import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig, buildAsyncAPIConfig } from '../../src/import/config.js'

describe('loadImportConfig', () => {
  it('parses a valid config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'imports.yaml')
    fs.writeFileSync(filePath, `
imports:
  - adapter: openapi
    spec: ./orders.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0
`)
    const config = loadImportConfig(filePath)
    assert.equal(config.imports.length, 1)
    assert.equal(config.imports[0].adapter, 'openapi')
    assert.equal(config.imports[0].spec, './orders.yaml')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws on invalid YAML', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'bad.yaml')
    fs.writeFileSync(filePath, `{ bad yaml: [`)
    assert.throws(() => loadImportConfig(filePath), /Failed to parse/)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws when imports array is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'bad.yaml')
    fs.writeFileSync(filePath, `name: foo`)
    assert.throws(() => loadImportConfig(filePath), /Invalid import config/)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('buildOpenAPIConfig', () => {
  it('builds uri-segment config with segment index', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'uri-segment', 0)
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'uri-segment', segment: 0 },
    })
  })

  it('builds uri-segment config with regex pattern', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'uri-segment', undefined, '^/([^/]+)/')
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'uri-segment', pattern: '^/([^/]+)/' },
    })
  })

  it('builds hardcoded config', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'hardcoded', undefined, undefined, 'legacy')
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'hardcoded', component: 'legacy' },
    })
  })

  it('throws when hardcoded strategy missing component', () => {
    assert.throws(() => buildOpenAPIConfig('./spec.yaml', 'hardcoded'), /--component required/)
  })
})

describe('buildAsyncAPIConfig', () => {
  it('builds channel-segment config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'channel-segment', { separator: '.', segment: 0 })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'channel-segment', separator: '.', segment: 0 },
    })
  })

  it('builds hardcoded config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'hardcoded', { value: 'orders' })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'hardcoded', value: 'orders' },
    })
  })

  it('builds channel-pattern config', () => {
    const entry = buildAsyncAPIConfig('./events.yaml', 'channel-pattern', { pattern: '^([a-z]+)\\.' })
    assert.deepEqual(entry, {
      adapter: 'asyncapi',
      spec: './events.yaml',
      componentMapping: { strategy: 'channel-pattern', pattern: '^([a-z]+)\\.' },
    })
  })

  it('throws when hardcoded strategy missing value', () => {
    assert.throws(() => buildAsyncAPIConfig('./events.yaml', 'hardcoded', {}), /--component required/)
  })
})
