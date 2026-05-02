import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs, { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as git from 'isomorphic-git'
import { loadGraph } from '../src/loader/index.js'
import { listYamlKeys, readYaml, hasKey } from '../src/source/content-utils.js'
import { createGraphRuntimeConfig } from '../src/source/config.js'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitCacheManager } from '../src/source/git-cache.js'
import { GitGraphSource } from '../src/source/git-source.js'
import { SourceError } from '../src/source/index.js'
import type { ContentMap } from '../src/source/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('SourceError', () => {
  it('is an instance of Error', () => {
    const err = new SourceError('something failed')
    assert.ok(err instanceof Error)
    assert.equal(err.message, 'something failed')
  })

  it('wraps a cause', () => {
    const cause = new Error('underlying')
    const err = new SourceError('wrapped', cause)
    assert.equal(err.cause, cause)
  })
})

describe('content-utils', () => {
  const map: ContentMap = new Map([
    ['components/orders/order.yaml', 'id: order'],
    ['components/orders/payment.yaml', 'id: payment'],
    ['edges/corum.edges.yaml', 'edges: []'],
    ['graph.yaml', 'templatePacks: []'],
  ])

  it('listYamlKeys returns keys under a prefix', () => {
    assert.deepEqual(listYamlKeys(map, 'components/orders').sort(), [
      'components/orders/order.yaml',
      'components/orders/payment.yaml',
    ])
  })

  it('listYamlKeys with empty prefix returns all yaml keys', () => {
    assert.equal(listYamlKeys(map, '').length, 4)
  })

  it('readYaml returns content for existing key', () => {
    assert.equal(readYaml(map, 'graph.yaml'), 'templatePacks: []')
  })

  it('readYaml throws for missing key', () => {
    assert.throws(() => readYaml(map, 'missing.yaml'), /not found in ContentMap/)
  })

  it('hasKey returns true for existing key', () => {
    assert.ok(hasKey(map, 'graph.yaml'))
  })

  it('hasKey returns false for missing key', () => {
    assert.ok(!hasKey(map, 'nope.yaml'))
  })
})

describe('FileGraphSource', () => {
  it('defaultBranch returns a non-empty string', async () => {
    const branch = await new FileGraphSource({ graphDir: fixtureGraphDir }).defaultBranch()
    assert.ok(typeof branch === 'string' && branch.length > 0)
  })

  it('listBranches returns a single-element array', async () => {
    const branches = await new FileGraphSource({ graphDir: fixtureGraphDir }).listBranches()
    assert.equal(branches.length, 1)
  })

  it('loadGraphContent returns a ContentMap with cluster yaml files', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const content = await source.loadGraphContent(await source.defaultBranch())
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.startsWith('components/') && k.endsWith('.yaml')))
    assert.ok(keys.some(k => k === 'graph.yaml'))
  })

  it('loadPackContent returns a ContentMap with template yaml files', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const content = await source.loadPackContent(await source.defaultBranch())
    assert.ok([...content.keys()].some(k => k.includes('templates/') && k.endsWith('.yaml')))
  })

  it('loadGraphContent and loadPackContent keys do not overlap', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branch = await source.defaultBranch()
    const graphKeys = new Set((await source.loadGraphContent(branch)).keys())
    for (const key of (await source.loadPackContent(branch)).keys()) {
      assert.ok(!graphKeys.has(key), `key ${key} appears in both maps`)
    }
  })

  it('commit writes graph content to the configured graphDir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'write snapshot', { replaceGraphContent: true })
      assert.equal(fs.readFileSync(path.join(tmpDir, 'components/orders/order.yaml'), 'utf-8'), 'id: order\n')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit rejects keys that escape graphDir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-escape-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      const outsidePath = path.resolve(tmpDir, '..', 'corum-outside-escape.yaml')
      fs.rmSync(outsidePath, { force: true })
      await assert.rejects(
        () => source.commit('local', new Map([['../corum-outside-escape.yaml', 'id: outside\n']]), 'bad'),
        (err: unknown) => err instanceof SourceError,
      )
      assert.equal(existsSync(outsidePath), false)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('GitCacheManager', () => {
  it('cacheDir returns a stable path for the same URL', () => {
    const mgr = new GitCacheManager()
    assert.equal(mgr.cacheDir('https://github.com/org/repo'), mgr.cacheDir('https://github.com/org/repo'))
  })

  it('cacheDir returns different paths for different URLs', () => {
    const mgr = new GitCacheManager()
    assert.notEqual(mgr.cacheDir('https://github.com/org/repo-a'), mgr.cacheDir('https://github.com/org/repo-b'))
  })

  it('cacheDir path does not contain the URL directly', () => {
    assert.ok(!new GitCacheManager().cacheDir('https://github.com/org/repo').includes('github.com'))
  })
})

describe('createGraphRuntimeConfig', () => {
  it('defaults to a filesystem source using CORUM_GRAPH_PATH', async () => {
    const config = createGraphRuntimeConfig({ CORUM_GRAPH_PATH: fixtureGraphDir }, repoRoot)
    assert.equal(config.kind, 'filesystem')
    assert.equal(config.graphPath, fixtureGraphDir)
    assert.equal(config.fileWatcherGraphPath, fixtureGraphDir)

    const graph = await loadGraph({ source: config.source, strict: true })
    assert.ok(graph.nodesById.size > 0)
  })

  it('creates a git source from local repo env config', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-runtime-git-'))
    try {
      await createFixtureRepo(tmpDir)
      const config = createGraphRuntimeConfig({
        CORUM_SOURCE: 'git',
        CORUM_GIT_LOCAL_PATH: tmpDir,
        CORUM_GIT_GRAPH_DIR: 'wrong/graph',
        CORUM_GIT_BRANCH: 'feat/payment',
      }, repoRoot)

      assert.equal(config.kind, 'git')
      assert.equal(config.graphPath, `git:${tmpDir}/.corum/graph`)
      assert.equal(config.fileWatcherGraphPath, undefined)

      const content = await config.source.loadGraphContent(await config.source.defaultBranch())
      assert.ok(content.has('components/orders/payment.yaml'))
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('rejects git source config without local or remote repository', () => {
    assert.throws(
      () => createGraphRuntimeConfig({ CORUM_SOURCE: 'git' }, repoRoot),
      /CORUM_SOURCE=git requires CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL/,
    )
  })

  it('passes token auth through remote git source config without exposing it in graphPath', () => {
    const config = createGraphRuntimeConfig({
      CORUM_SOURCE: 'git',
      CORUM_GIT_REMOTE_URL: 'https://github.com/org/design-repo.git',
      CORUM_GIT_GRAPH_DIR: 'wrong/graph',
      CORUM_GIT_BRANCH: 'main',
      CORUM_GIT_USERNAME: 'x-access-token',
      CORUM_GIT_TOKEN: 'secret-token',
    }, repoRoot)

    assert.equal(config.kind, 'git')
    assert.equal(config.graphPath, 'git:https://github.com/org/design-repo.git/.corum/graph')
    assert.equal(config.fileWatcherGraphPath, undefined)
  })
})

async function createFixtureRepo(tmpDir: string): Promise<void> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })

  const graphDir = path.join(tmpDir, '.corum', 'graph')
  const componentsDir = path.join(graphDir, 'components', 'orders')
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(path.join(graphDir, 'edges'), { recursive: true })
  fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'templatePacks: []\n')
  fs.writeFileSync(
    path.join(componentsDir, 'order.yaml'),
    'id: orders.DomainModel.order\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: agreed\n  stability: stable\n  lastModifiedAt: "2026-01-01"\n',
  )

  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/graph.yaml' })
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/order.yaml' })
  await git.commit({
    fs,
    dir: tmpDir,
    message: 'initial',
    author: { name: 'Test', email: 'test@test.com' },
  })

  await git.branch({ fs, dir: tmpDir, ref: 'feat/payment', checkout: true })
  fs.writeFileSync(
    path.join(componentsDir, 'payment.yaml'),
    'id: orders.DomainModel.payment\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: proposed\n  stability: unstable\n  lastModifiedAt: "2026-01-02"\n',
  )
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/payment.yaml' })
  await git.commit({
    fs,
    dir: tmpDir,
    message: 'add payment node',
    author: { name: 'Test', email: 'test@test.com' },
  })
  await git.checkout({ fs, dir: tmpDir, ref: 'main' })
}

describe('GitGraphSource (local)', () => {
  let tmpDir: string

  it('setup fixture repo', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-fixture-'))
    await createFixtureRepo(tmpDir)
    assert.ok(existsSync(path.join(tmpDir, '.git')))
  })

  it('defaultBranch returns main', async () => {
    assert.equal(await new GitGraphSource({ localPath: tmpDir }).defaultBranch(), 'main')
  })

  it('listBranches returns main and feat/payment', async () => {
    const branches = await new GitGraphSource({ localPath: tmpDir }).listBranches()
    assert.ok(branches.includes('main'))
    assert.ok(branches.includes('feat/payment'))
  })

  it('loadGraphContent for main returns order.yaml only', async () => {
    const content = await new GitGraphSource({ localPath: tmpDir }).loadGraphContent('main')
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.includes('order.yaml')))
    assert.ok(!keys.some(k => k.includes('payment.yaml')))
  })

  it('loadGraphContent for feat/payment includes payment.yaml', async () => {
    const content = await new GitGraphSource({ localPath: tmpDir }).loadGraphContent('feat/payment')
    assert.ok([...content.keys()].some(k => k.includes('payment.yaml')))
  })

  it('loadGraphContent accepts Windows-style graphDir separators', async () => {
    const source = new GitGraphSource({ localPath: tmpDir, graphDir: path.win32.join('.corum', 'graph') })
    const content = await source.loadGraphContent('main')
    assert.ok(content.has('components/orders/order.yaml'))
  })

  it('rejects Windows-style parent traversal in graphDir', () => {
    assert.throws(
      () => new GitGraphSource({ localPath: tmpDir, graphDir: '..\\outside' }),
      (err: unknown) => err instanceof SourceError,
    )
  })

  it('throws SourceError when neither localPath nor remoteUrl provided', () => {
    assert.throws(() => new GitGraphSource({}), (err: unknown) => err instanceof SourceError)
  })

  it('throws SourceError when both localPath and remoteUrl provided', () => {
    assert.throws(
      () => new GitGraphSource({ localPath: '/foo', remoteUrl: 'https://example.com/repo' }),
      (err: unknown) => err instanceof SourceError,
    )
  })
})

describe('GitGraphSource write path', () => {
  let tmpDir: string

  it('setup', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-write-'))
    await createFixtureRepo(tmpDir)
  })

  it('commit writes a new file to a non-default branch and reads it back', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/write-test', checkout: false })
    await source.commit('feat/write-test', new Map([
      ['components/orders/new-node.yaml',
        'id: orders.DomainModel.new-node\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: proposed\n  stability: unstable\n  lastModifiedAt: "2026-01-03"\n'],
    ]), 'add new-node', { replaceGraphContent: true })

    const content = await source.loadGraphContent('feat/write-test')
    assert.ok(content.has('components/orders/new-node.yaml'))
  })

  it('commit throws SourceError on default branch', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await assert.rejects(
      () => source.commit('main', new Map(), 'msg'),
      (err: unknown) => err instanceof SourceError,
    )
  })

  it('commit rejects keys that escape graphDir', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/bad-key', checkout: false })
    await assert.rejects(
      () => source.commit('feat/bad-key', new Map([['../outside.yaml', 'id: outside\n']]), 'bad'),
      (err: unknown) => err instanceof SourceError,
    )
  })
})
