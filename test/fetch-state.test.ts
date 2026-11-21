import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { createFetchController, identityOf } = await import(pathToFileURL(path.join(process.cwd(), 'web', 'sdk', 'fetch-state.js')).href)

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const tick = () => new Promise(resolve => setImmediate(resolve))

describe('createFetchController', () => {
  it('starts idle, loads data, and reports loading then data', async () => {
    const seen: unknown[] = []
    const c = createFetchController((state: unknown) => seen.push(state))
    assert.deepEqual(c.state(), { identity: null, data: null, error: null, loading: true })
    const d = deferred<string>()
    c.load('a', () => d.promise)
    assert.equal(c.state().loading, true)
    d.resolve('one')
    await tick()
    assert.deepEqual(c.state(), { identity: 'a', data: 'one', error: null, loading: false })
    assert.ok(seen.length >= 2)
  })

  it('reports an error without throwing and keeps no data', async () => {
    const c = createFetchController(() => {})
    c.load('a', () => Promise.reject(new Error('boom')))
    await tick()
    assert.equal(c.state().loading, false)
    assert.equal(c.state().data, null)
    assert.equal(c.state().error.message, 'boom')
  })

  it('ignores a stale response that resolves after a newer load', async () => {
    const c = createFetchController(() => {})
    const first = deferred<string>()
    const second = deferred<string>()
    c.load('a', () => first.promise)
    c.load('b', () => second.promise)
    second.resolve('two')
    await tick()
    first.resolve('one')
    await tick()
    assert.equal(c.state().data, 'two')
    assert.equal(c.state().identity, 'b')
  })

  it('ignores a stale error after a newer load', async () => {
    const c = createFetchController(() => {})
    const first = deferred<string>()
    c.load('a', () => first.promise)
    c.load('a', () => Promise.resolve('fresh'))
    await tick()
    first.reject(new Error('old'))
    await tick()
    assert.equal(c.state().data, 'fresh')
    assert.equal(c.state().error, null)
  })

  it('keeps existing data while reloading the same identity, and clears it for a new identity', async () => {
    const c = createFetchController(() => {})
    c.load('a', () => Promise.resolve('one'))
    await tick()
    const d = deferred<string>()
    c.load('a', () => d.promise)
    assert.deepEqual([c.state().data, c.state().loading], ['one', true])
    c.load('b', () => d.promise)
    assert.deepEqual([c.state().data, c.state().loading], [null, true])
  })

  it('refresh refetches the last request', async () => {
    const c = createFetchController(() => {})
    let n = 0
    c.load('a', () => Promise.resolve(++n))
    await tick()
    c.refresh()
    await tick()
    assert.equal(c.state().data, 2)
  })

  it('ignores results after dispose', async () => {
    let notified = 0
    const c = createFetchController(() => { notified += 1 })
    const d = deferred<string>()
    c.load('a', () => d.promise)
    const before = notified
    c.dispose()
    d.resolve('late')
    await tick()
    assert.equal(notified, before)
  })

  it('turns a synchronous fetcher throw into an error state', async () => {
    const c = createFetchController(() => {})
    c.load('a', () => { throw new Error('sync') })
    await tick()
    assert.equal(c.state().error.message, 'sync')
  })
})

describe('identityOf', () => {
  it('is stable for equal path/params/ref and differs otherwise, ignoring param key order', () => {
    assert.equal(identityOf('cluster', { a: '1', b: '2' }, 'main'), identityOf('cluster', { b: '2', a: '1' }, 'main'))
    assert.notEqual(identityOf('cluster', { a: '1' }, 'main'), identityOf('cluster', { a: '2' }, 'main'))
    assert.notEqual(identityOf('cluster', {}, 'main'), identityOf('cluster', {}, 'dev'))
    assert.notEqual(identityOf('cluster', {}, null), identityOf('other', {}, null))
    assert.equal(identityOf('x', [['a', '1'], ['a', '2']], null), identityOf('x', new URLSearchParams('a=1&a=2'), null))
  })
})
