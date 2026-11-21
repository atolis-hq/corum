import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolvePluginAsset } from '../src/web/plugins/assets.js'

describe('resolvePluginAsset', () => {
  let tmp: string
  let dir: string
  let symlinkOk = true

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-assets-'))
    dir = path.join(tmp, 'plugin')
    fs.mkdirSync(path.join(dir, 'lib'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'plugin.yaml'), 'id: x\n')
    fs.writeFileSync(path.join(dir, 'foo.yaml'), 'a: 1\n')
    fs.writeFileSync(path.join(dir, 'foo.yml'), 'a: 1\n')
    fs.writeFileSync(path.join(dir, 'index.js'), 'export {}\n')
    fs.writeFileSync(path.join(dir, 'lib', 'util.mjs'), 'export {}\n')
    fs.writeFileSync(path.join(dir, 'style.css'), 'a{}\n')
    fs.writeFileSync(path.join(dir, 'data.json'), '{}\n')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x\n')
    fs.writeFileSync(path.join(tmp, 'secret.js'), 'secret\n')
    fs.mkdirSync(path.join(tmp, 'outside'))
    fs.writeFileSync(path.join(tmp, 'outside', 'x.js'), 'secret\n')
    try {
      fs.symlinkSync(path.join(tmp, 'secret.js'), path.join(dir, 'link.js'), 'file')
      fs.symlinkSync(path.join(tmp, 'outside'), path.join(dir, 'linkdir'), 'junction')
    } catch {
      symlinkOk = false
    }
  })

  after(() => fs.rmSync(tmp, { recursive: true, force: true }))

  it('serves allowed extensions with content types', () => {
    const js = resolvePluginAsset(dir, 'index.js')
    assert.ok(js)
    assert.equal(js.contentType, 'text/javascript; charset=utf-8')
    assert.equal(js.file, fs.realpathSync(path.join(dir, 'index.js')))
    assert.ok(js.etag.length > 0)
    assert.equal(resolvePluginAsset(dir, 'lib/util.mjs')?.contentType, 'text/javascript; charset=utf-8')
    assert.equal(resolvePluginAsset(dir, 'style.css')?.contentType, 'text/css; charset=utf-8')
    assert.equal(resolvePluginAsset(dir, 'data.json')?.contentType, 'application/json; charset=utf-8')
  })

  it('etag is stable and changes when the file changes', () => {
    const a = resolvePluginAsset(dir, 'index.js')
    const b = resolvePluginAsset(dir, 'index.js')
    assert.equal(a?.etag, b?.etag)
    const target = path.join(dir, 'etag.js')
    fs.writeFileSync(target, 'a')
    const first = resolvePluginAsset(dir, 'etag.js')?.etag
    fs.writeFileSync(target, 'abcdef')
    assert.notEqual(resolvePluginAsset(dir, 'etag.js')?.etag, first)
  })

  const rejected = [
    '../plugin.yaml',
    '../secret.js',
    '%2e%2e/secret.js',
    '%2e%2e%2fsecret.js',
    'lib/../../secret.js',
    '..\\secret.js',
    '/etc/passwd',
    'plugin.yaml',
    'foo.yaml',
    'foo.yml',
    'notes.txt',
    'missing.js',
    'lib',
    '',
    'index.js\0.png',
    '%00',
  ]
  for (const request of rejected) {
    it(`rejects ${JSON.stringify(request)}`, () => {
      assert.equal(resolvePluginAsset(dir, request), null)
    })
  }

  it('rejects a symlink that escapes the plugin directory', t => {
    if (!symlinkOk) return t.skip('symlinks unavailable')
    assert.equal(resolvePluginAsset(dir, 'link.js'), null)
    assert.equal(resolvePluginAsset(dir, 'linkdir/x.js'), null)
  })
})
