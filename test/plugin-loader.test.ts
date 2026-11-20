import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const hostDir = path.join(process.cwd(), 'web', 'host')
const sdkDir = path.join(process.cwd(), 'web', 'sdk')
const load = (dir: string, file: string) => import(pathToFileURL(path.join(dir, file)).href)

const { loadPlugins } = await load(hostDir, 'plugin-loader.js')
const { createRegistry } = await load(sdkDir, 'registry.js')

function status(id: string, main = './index.js', extra: Record<string, unknown> = {}) {
  return {
    id,
    origin: 'builtin',
    version: '1.0.0',
    status: 'enabled',
    manifest: {
      id,
      version: '1.0.0',
      main,
      contributes: { pages: [{ id: 'home', title: id, mount: 'mount', opens: [] }], nodeActions: [] },
    },
    ...extra,
  }
}

describe('loadPlugins', () => {
  it('registers every entry without importing until load()', async () => {
    const registry = createRegistry()
    const imported: string[] = []
    await loadPlugins({
      fetchPlugins: async () => [status('a'), status('b')],
      importModule: async (url: string) => { imported.push(url); return {} },
      registry,
    })
    assert.equal(registry.plugins().length, 2)
    assert.deepEqual(imported, [])
  })

  it('imports lazily from /plugins/<id>/<main> with ./ normalised, once', async () => {
    const registry = createRegistry()
    const imported: string[] = []
    const mod = { mount() {} }
    await loadPlugins({
      fetchPlugins: async () => [status('a', './dist/main.js')],
      importModule: async (url: string) => { imported.push(url); return mod },
      registry,
    })
    const entry = registry.plugins()[0]
    const [first, second] = await Promise.all([entry.load(), entry.load()])
    assert.equal(first, mod)
    assert.equal(second, mod)
    assert.equal(await entry.load(), mod)
    assert.deepEqual(imported, ['/plugins/a/dist/main.js'])
  })

  it('a rejected import marks that entry unavailable and rethrows; others are unaffected', async () => {
    const registry = createRegistry()
    await loadPlugins({
      fetchPlugins: async () => [status('bad'), status('good')],
      importModule: async (url: string) => {
        if (url.includes('/bad/')) throw new Error('boom')
        return {}
      },
      registry,
    })
    const [bad, good] = registry.plugins()
    await assert.rejects(bad.load(), /boom/)
    assert.equal(bad.status, 'unavailable')
    assert.match(bad.reason, /boom/)
    assert.equal(registry.findPage('bad', 'home'), null)
    await good.load()
    assert.equal(good.status, 'enabled')
    assert.notEqual(registry.findPage('good', 'home'), null)
  })

  it('keeps server-reported disabled/unavailable status and reason', async () => {
    const registry = createRegistry()
    await loadPlugins({
      fetchPlugins: async () => [status('x', './index.js', { status: 'unavailable', reason: 'missing template Foo' })],
      importModule: async () => ({}),
      registry,
    })
    assert.equal(registry.plugins()[0].status, 'unavailable')
    assert.equal(registry.plugins()[0].reason, 'missing template Foo')
  })

  it('fetch failure leaves the registry empty and does not throw', async () => {
    const registry = createRegistry()
    await loadPlugins({
      fetchPlugins: async () => { throw new Error('offline') },
      importModule: async () => ({}),
      registry,
    })
    assert.equal(registry.plugins().length, 0)
  })
})
