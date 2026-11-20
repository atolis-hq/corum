import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const script = fs.readFileSync(path.join(process.cwd(), 'web', 'router.js'), 'utf8')
const sandbox = {
  module: { exports: {} as Record<string, unknown> },
  exports: {},
  URLSearchParams,
}
vm.runInNewContext(script, sandbox)
const { parseRoute, buildRoute } = sandbox.module.exports as {
  parseRoute: (hash: string) => { branch: string | null; pathname: string; params: URLSearchParams; plugin: { id: string; page: string | null } | null }
  buildRoute: (opts: { pathname: string; params: Record<string, string>; branch: string | null }) => string
}

describe('parseRoute', () => {
  it('plain hash - no branch prefix (filesystem mode)', () => {
    const r = parseRoute('#/dashboard')
    assert.equal(r.branch, null)
    assert.equal(r.pathname, '/dashboard')
    assert.equal(r.params.toString(), '')
  })

  it('plain hash with query params', () => {
    const r = parseRoute('#/node?id=orders.Order')
    assert.equal(r.branch, null)
    assert.equal(r.pathname, '/node')
    assert.equal(r.params.get('id'), 'orders.Order')
  })

  it('branch-prefixed hash (git mode)', () => {
    const r = parseRoute('#/main/node?id=orders.Order')
    assert.equal(r.branch, 'main')
    assert.equal(r.pathname, '/node')
    assert.equal(r.params.get('id'), 'orders.Order')
  })

  it('decodes percent-encoded slashes in branch name', () => {
    const r = parseRoute('#/feat%2Fcheckout-v2/node?id=orders.Order')
    assert.equal(r.branch, 'feat/checkout-v2')
    assert.equal(r.pathname, '/node')
  })

  it('empty hash falls back to /dashboard with null branch', () => {
    const r = parseRoute('')
    assert.equal(r.branch, null)
    assert.equal(r.pathname, '/dashboard')
  })

  it('bare hash falls back to /dashboard', () => {
    const r = parseRoute('#')
    assert.equal(r.branch, null)
    assert.equal(r.pathname, '/dashboard')
  })

  it('branch-prefixed dashboard', () => {
    const r = parseRoute('#/main/dashboard')
    assert.equal(r.branch, 'main')
    assert.equal(r.pathname, '/dashboard')
  })
})

describe('parseRoute plugin routes', () => {
  it('plugin page without branch', () => {
    const r = parseRoute('#/p/journeys/map?id=a')
    assert.equal(r.branch, null)
    assert.equal(r.pathname, '/p/journeys/map')
    assert.equal(r.plugin?.id, 'journeys')
    assert.equal(r.plugin?.page, 'map')
    assert.equal(r.params.get('id'), 'a')
  })

  it('plugin page with branch prefix', () => {
    const r = parseRoute('#/main/p/journeys/map')
    assert.equal(r.branch, 'main')
    assert.equal(r.pathname, '/p/journeys/map')
    assert.equal(r.plugin?.id, 'journeys')
    assert.equal(r.plugin?.page, 'map')
  })

  it('plugin route without page', () => {
    const r = parseRoute('#/p/journeys')
    assert.equal(r.plugin?.id, 'journeys')
    assert.equal(r.plugin?.page, null)
  })

  it('a plugin whose id is p still routes', () => {
    const r = parseRoute('#/p/p/home')
    assert.equal(r.plugin?.id, 'p')
    assert.equal(r.plugin?.page, 'home')
  })

  it('non-plugin routes have null plugin', () => {
    assert.equal(parseRoute('#/dashboard').plugin, null)
    assert.equal(parseRoute('#/main/node?id=x').plugin, null)
  })
})

describe('buildRoute', () => {
  it('plugin page routes', () => {
    assert.equal(buildRoute({ pathname: '/p/journeys/map', params: { id: 'x' }, branch: 'main' }), '#/main/p/journeys/map?id=x')
    assert.equal(buildRoute({ pathname: '/p/journeys/map', params: { id: 'x' }, branch: null }), '#/p/journeys/map?id=x')
  })

  it('plain hash when branch is null', () => {
    assert.equal(buildRoute({ pathname: '/dashboard', params: {}, branch: null }), '#/dashboard')
  })

  it('hash with query params, no branch', () => {
    assert.equal(buildRoute({ pathname: '/node', params: { id: 'orders.Order' }, branch: null }), '#/node?id=orders.Order')
  })

  it('branch-prefixed hash', () => {
    assert.equal(buildRoute({ pathname: '/node', params: { id: 'orders.Order' }, branch: 'main' }), '#/main/node?id=orders.Order')
  })

  it('percent-encodes slashes in branch name', () => {
    assert.equal(
      buildRoute({ pathname: '/node', params: { id: 'orders.Order' }, branch: 'feat/checkout-v2' }),
      '#/feat%2Fcheckout-v2/node?id=orders.Order',
    )
  })

  it('branch-prefixed path with no params', () => {
    assert.equal(buildRoute({ pathname: '/dashboard', params: {}, branch: 'main' }), '#/main/dashboard')
  })

  it('roundtrips parseRoute -> buildRoute', () => {
    const original = '#/feat%2Fcheckout-v2/node?id=orders.Order'
    const parsed = parseRoute(original)
    const rebuilt = buildRoute({ pathname: parsed.pathname, params: Object.fromEntries(parsed.params), branch: parsed.branch })
    assert.equal(rebuilt, original)
  })
})
