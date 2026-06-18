import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fetchRegistry, findPack, resolveRef } from '../src/pack/registry.js'
import type { Registry } from '../src/pack/registry.js'

const sampleRegistry: Registry = {
  version: '1.0',
  packs: [
    { name: 'core', description: 'Core', repo: 'https://github.com/a/b', path: '.corum/packs/core' },
    { name: 'domain', description: 'Domain', repo: 'https://github.com/a/b', path: '.corum/packs/domain' },
  ],
}

function mockFetchOk(body: string): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({ ok: true, text: async () => body, json: async () => JSON.parse(body) }) as unknown as Response
}

function mockFetchFail(status: number): typeof fetch {
  return async (_url: string | URL | Request) =>
    ({ ok: false, status, statusText: 'Error' }) as unknown as Response
}

describe('fetchRegistry', () => {
  it('parses a registry YAML response', async () => {
    const yaml = `version: "1.0"\npacks:\n  - name: core\n    description: Core\n    repo: https://github.com/a/b\n    path: .corum/packs/core\n`
    const result = await fetchRegistry('https://github.com/a/b/packs/registry.yaml', mockFetchOk(yaml))
    assert.equal(result.version, '1.0')
    assert.equal(result.packs.length, 1)
    assert.equal(result.packs[0].name, 'core')
  })

  it('throws if fetch fails', async () => {
    await assert.rejects(
      () => fetchRegistry('https://github.com/a/b/packs/registry.yaml', mockFetchFail(404)),
      /404/,
    )
  })


})

describe('findPack', () => {
  it('returns matching pack', () => {
    const pack = findPack(sampleRegistry, 'domain')
    assert.equal(pack.name, 'domain')
  })

  it('throws with helpful message for unknown pack', () => {
    assert.throws(
      () => findPack(sampleRegistry, 'unknown'),
      /pack "unknown" not found in registry/i,
    )
  })
})

describe('resolveRef', () => {
  it('returns specified ref without calling the api', async () => {
    const mockFetch = async () => {
      throw new Error('should not be called')
    }
    const ref = await resolveRef('a', 'b', 'v1.2.3', mockFetch as unknown as typeof fetch)
    assert.equal(ref, 'v1.2.3')
  })

  it('fetches latest release tag when no ref specified', async () => {
    const mockFetch = async (_url: string | URL | Request) =>
      ({ ok: true, json: async () => ([{ name: 'v0.1.6' }]) }) as unknown as Response
    const ref = await resolveRef('atolis-hq', 'corum', undefined, mockFetch)
    assert.equal(ref, 'v0.1.6')
  })

  it('throws if tags api fails', async () => {
    await assert.rejects(
      () => resolveRef('a', 'b', undefined, mockFetchFail(404)),
      /404/,
    )
  })

  it('throws if the repository has no tags', async () => {
    const mockFetch: typeof fetch = async () =>
      ({ ok: true, json: async () => ([]) }) as unknown as Response

    await assert.rejects(
      () => resolveRef('atolis-hq', 'corum', undefined, mockFetch),
      /no tags found/i,
    )
  })
})
