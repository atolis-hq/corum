import { it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse } from 'yaml'

const cli = path.resolve('dist/src/bin/corum.js')

it('copies both local forms, records provenance, and replaces repeat installs without duplicates', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-local-'))
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, 'pack', ...args], { cwd, encoding: 'utf8' })
  try {
    fs.mkdirSync(path.join(cwd, '.corum/graph'), { recursive: true })
    fs.writeFileSync(path.join(cwd, '.corum/graph/graph.yaml'), 'name: demo\ntemplatePacks: [{name: core, path: ../packs/core}]\ncomponents: []\n')
    const source = path.join(cwd, 'packs/demo')
    fs.mkdirSync(path.join(source, 'templates'), { recursive: true })
    fs.writeFileSync(path.join(source, 'pack.yaml'), 'templates: [Demo]\n')
    fs.writeFileSync(path.join(source, 'templates/Demo.yaml'), 'name: Demo\n')
    fs.writeFileSync(path.join(source, 'extra.txt'), 'original')
    let result = run('install', './packs/demo')
    assert.equal(result.status, 0, result.stderr)
    const installed = path.join(cwd, '.corum/packs/demo')
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false)
    fs.unlinkSync(path.join(source, 'extra.txt'))
    fs.writeFileSync(path.join(source, 'templates/Demo.yaml'), 'name: Updated\n')
    assert.equal(fs.readFileSync(path.join(installed, 'templates/Demo.yaml'), 'utf8'), 'name: Demo\n')
    result = run('install', 'demo', '--path', source)
    assert.equal(result.status, 0, result.stderr)
    assert.equal(fs.existsSync(path.join(installed, 'extra.txt')), false)
    assert.equal(fs.readFileSync(path.join(installed, 'templates/Demo.yaml'), 'utf8'), 'name: Updated\n')
    const manifest = parse(fs.readFileSync(path.join(cwd, '.corum/packs.yaml'), 'utf8'))
    assert.equal(manifest.packs.length, 1)
    assert.equal(manifest.packs[0].sourcePath, fs.realpathSync(source))
    const graph = parse(fs.readFileSync(path.join(cwd, '.corum/graph/graph.yaml'), 'utf8'))
    assert.deepEqual(graph.templatePacks, [{ name: 'core', path: '../packs/core' }, { name: 'demo', path: '../packs/demo' }])
    assert.match(run('list').stdout, /demo \(local:/)
    for (const args of [
      ['install', './missing'],
      ['install', '../escape', '--path', source],
      ['install', 'demo', '--path', installed],
    ]) assert.equal(run(...args).status, 1)
    fs.writeFileSync(path.join(source, 'pack.yaml'), 'templates: invalid\n')
    assert.equal(run('install', 'demo', '--path', source).status, 1)
    assert.equal(fs.readFileSync(path.join(installed, 'templates/Demo.yaml'), 'utf8'), 'name: Updated\n')
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})

it('rejects invalid local sources without registering them', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-local-invalid-'))
  try {
    fs.mkdirSync(path.join(cwd, '.corum/graph'), { recursive: true })
    const graphFile = path.join(cwd, '.corum/graph/graph.yaml')
    const graphText = 'name: demo\ncomponents: []\n'
    fs.writeFileSync(graphFile, graphText)
    const source = path.join(cwd, 'source')
    fs.mkdirSync(source)
    const run = () => spawnSync(process.execPath, [cli, 'pack', 'install', 'demo', '--path', source], { cwd, encoding: 'utf8' })
    for (const metadata of [null, 'templates: [Missing]\n', 'templates: [../escape]\n', 'templates: []\nfiles: [../escape]\n', 'templates: []\nplugins: invalid\n']) {
      if (metadata !== null) fs.writeFileSync(path.join(source, 'pack.yaml'), metadata)
      const result = run()
      assert.equal(result.status, 1, result.stdout)
      assert.match(result.stderr, /\[ERROR\]/)
      assert.equal(fs.readFileSync(graphFile, 'utf8'), graphText)
      assert.equal(fs.existsSync(path.join(cwd, '.corum/packs.yaml')), false)
      assert.equal(fs.existsSync(path.join(cwd, '.corum/packs/demo')), false)
    }
    fs.writeFileSync(path.join(source, 'pack.yaml'), 'templates: []\n')
    fs.symlinkSync(graphFile, path.join(source, 'link'))
    assert.match(run().stderr, /symbolic link/)
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true })
  }
})
