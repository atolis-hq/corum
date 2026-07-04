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

  it('commit with replaceGraphContent preserves non-yaml files a user kept in graphDir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-preserve-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'first', { replaceGraphContent: true })

      fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'kept by user')

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order-renamed\n'],
      ]), 'second', { replaceGraphContent: true })

      assert.equal(fs.readFileSync(path.join(tmpDir, 'notes.txt'), 'utf-8'), 'kept by user')
      assert.equal(
        fs.readFileSync(path.join(tmpDir, 'components/orders/order.yaml'), 'utf-8'),
        'id: order-renamed\n',
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit with replaceGraphContent removes stale yaml files no longer present in the ContentMap', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-stale-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
        ['components/orders/payment.yaml', 'id: payment\n'],
      ]), 'first', { replaceGraphContent: true })

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'second', { replaceGraphContent: true })

      assert.equal(fs.existsSync(path.join(tmpDir, 'components/orders/payment.yaml')), false)
      assert.equal(fs.existsSync(path.join(tmpDir, 'components/orders/order.yaml')), true)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit with replaceGraphContent never deletes the whole graphDir before the new content exists on disk', async () => {
    // Regression guard for the crash-window bug: the old implementation did
    // rmSync(graphDir) then wrote files one by one, so a crash mid-write left
    // the graph gone. We can't literally kill the process mid-call, but we can
    // assert the graphDir is never observably empty by monkey-patching rmSync
    // to record whether it was ever called while old content is still the only content.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-crash-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'first', { replaceGraphContent: true })

      const originalRmSync = fs.rmSync
      let sawGraphDirFullyRemoved = false
      fs.rmSync = ((target: fs.PathLike, opts?: fs.RmOptions) => {
        const result = originalRmSync(target, opts)
        if (String(target) === tmpDir && !fs.existsSync(tmpDir)) {
          sawGraphDirFullyRemoved = true
        }
        return result
      }) as typeof fs.rmSync

      try {
        await source.commit('local', new Map([
          ['graph.yaml', 'templatePacks: []\n'],
          ['components/orders/order.yaml', 'id: order-v2\n'],
        ]), 'second', { replaceGraphContent: true })
      } finally {
        fs.rmSync = originalRmSync
      }

      assert.equal(sawGraphDirFullyRemoved, false, 'graphDir itself must never be fully removed during replaceGraphContent commit')
      assert.equal(
        fs.readFileSync(path.join(tmpDir, 'components/orders/order.yaml'), 'utf-8'),
        'id: order-v2\n',
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit with replaceGraphContent falls back to selective yaml delete when graphDir is itself a git repo root', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-selfrepo-'))
    try {
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'first', { replaceGraphContent: true })

      fs.writeFileSync(path.join(tmpDir, 'notes.txt'), 'kept by user')

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
      ]), 'second', { replaceGraphContent: true })

      assert.equal(fs.existsSync(path.join(tmpDir, '.git')), true, '.git must survive replaceGraphContent')
      assert.equal(fs.readFileSync(path.join(tmpDir, 'notes.txt'), 'utf-8'), 'kept by user')
      assert.equal(fs.existsSync(path.join(tmpDir, 'components/orders/order.yaml')), false, 'stale yaml removed')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit with replaceGraphContent preserves unrelated yaml files when graphDir is itself a git repo root', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-selfrepo-yaml-'))
    try {
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'first', { replaceGraphContent: true })

      const workflowDir = path.join(tmpDir, '.github', 'workflows')
      fs.mkdirSync(workflowDir, { recursive: true })
      fs.writeFileSync(path.join(workflowDir, 'ci.yaml'), 'name: ci\n')

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
      ]), 'second', { replaceGraphContent: true })

      assert.equal(
        fs.readFileSync(path.join(workflowDir, 'ci.yaml'), 'utf-8'),
        'name: ci\n',
        'replaceGraphContent must not delete unrelated repo yaml files',
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit records a git commit when graphDir lives inside a git repository', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-git-'))
    try {
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      const graphDir = path.join(tmpDir, '.corum', 'graph')
      const source = new FileGraphSource({ graphDir })
      const branch = await source.defaultBranch()
      await source.commit(branch, new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'corum: write snapshot')

      const [head] = await git.log({ fs, dir: tmpDir, depth: 1 })
      assert.match(head.commit.message, /corum: write snapshot/)

      const matrix = await git.statusMatrix({ fs, dir: tmpDir })
      for (const [filepath, headStatus, workdir, stage] of matrix) {
        assert.deepEqual(
          [headStatus, workdir, stage],
          [1, 1, 1],
          `expected ${filepath} to be committed and clean`,
        )
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit at a repo-root graphDir does not sweep unrelated repo changes into the graph commit', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-root-commit-'))
    try {
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'before\n')
      await git.add({ fs, dir: tmpDir, filepath: 'README.md' })
      await git.commit({
        fs,
        dir: tmpDir,
        message: 'initial',
        author: { name: 'Test', email: 'test@test.com' },
      })

      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'after\n')

      const source = new FileGraphSource({ graphDir: tmpDir })
      const branch = await source.defaultBranch()
      await source.commit(branch, new Map([
        ['graph.yaml', 'templatePacks: []\n'],
      ]), 'corum: graph only', { replaceGraphContent: true })

      const [head] = await git.log({ fs, dir: tmpDir, depth: 1 })
      assert.match(head.commit.message, /corum: graph only/)

      const matrix = await git.statusMatrix({ fs, dir: tmpDir, filepaths: ['README.md'] })
      const readme = matrix.find(([filepath]) => filepath === 'README.md')
      assert.ok(readme, 'README.md should still be tracked by statusMatrix')
      assert.deepEqual(
        readme.slice(1),
        [1, 2, 1],
        'README.md should remain modified in the worktree instead of being swept into the graph commit',
      )
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('head returns a stable content hash that changes when the graph content changes', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-head-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([['graph.yaml', 'templatePacks: []\n']]), 'first', { replaceGraphContent: true })

      const head1 = await source.head('local')
      const head1Again = await source.head('local')
      assert.equal(head1, head1Again, 'head must be deterministic for unchanged content')

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'second', { replaceGraphContent: true })
      assert.notEqual(await source.head('local'), head1, 'head must move when content changes')
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('log returns [] when unchanged and [head] when the content moved', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-log-'))
    try {
      const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
      await source.commit('local', new Map([['graph.yaml', 'templatePacks: []\n']]), 'first', { replaceGraphContent: true })
      const base = await source.head('local')
      assert.deepEqual(await source.log('local', base), [])

      await source.commit('local', new Map([
        ['graph.yaml', 'templatePacks: []\n'],
        ['components/orders/order.yaml', 'id: order\n'],
      ]), 'second', { replaceGraphContent: true })
      assert.deepEqual(await source.log('local', base), [await source.head('local')])
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })

  it('commit makes no git commit when nothing changed', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-git-noop-'))
    try {
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      const graphDir = path.join(tmpDir, '.corum', 'graph')
      const source = new FileGraphSource({ graphDir })
      const branch = await source.defaultBranch()
      const changes = new Map([['graph.yaml', 'templatePacks: []\n']])
      await source.commit(branch, changes, 'first')
      await source.commit(branch, changes, 'second')

      const log = await git.log({ fs, dir: tmpDir })
      assert.equal(log.length, 1)
      assert.match(log[0].commit.message, /first/)
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
      assert.equal(config.gitPollSeconds, undefined)

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

  it('parses optional git poll seconds from config', () => {
    const config = createGraphRuntimeConfig({
      CORUM_SOURCE: 'git',
      CORUM_GIT_LOCAL_PATH: 'C:/repo',
      CORUM_GIT_POLL_SECONDS: '15',
    }, repoRoot)

    assert.equal(config.gitPollSeconds, 15)
  })

  it('rejects invalid git poll seconds', () => {
    assert.throws(
      () => createGraphRuntimeConfig({
        CORUM_SOURCE: 'git',
        CORUM_GIT_LOCAL_PATH: 'C:/repo',
        CORUM_GIT_POLL_SECONDS: '0',
      }, repoRoot),
      /CORUM_GIT_POLL_SECONDS must be a positive number of seconds/,
    )
  })

  it('uses config file value when env var not set', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'graph: /from/config\n')
    try {
      const config = createGraphRuntimeConfig({}, dir)
      assert.equal(config.graphPath, '/from/config')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
  })

  it('env var takes precedence over config file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-test-'))
    fs.mkdirSync(path.join(dir, '.corum'))
    fs.writeFileSync(path.join(dir, '.corum', 'config.yaml'), 'graph: /from/config\n')
    try {
      const config = createGraphRuntimeConfig({ CORUM_GRAPH_PATH: '/from/env' }, dir)
      assert.equal(config.graphPath, '/from/env')
    } finally {
      fs.rmSync(dir, { recursive: true })
    }
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

  it('commit refuses to move a branch that is checked out in a local repo', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/checked-out', checkout: true })
    try {
      await assert.rejects(
        () => source.commit('feat/checked-out', new Map([['components/orders/x.yaml', 'id: x\n']]), 'msg'),
        /checked out/,
      )
    } finally {
      await git.checkout({ fs, dir: tmpDir, ref: 'main' })
    }
  })

  it('commit rejects an unknown branch without createBranchIfMissing', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await assert.rejects(
      () => source.commit('feat/does-not-exist', new Map([['a.yaml', 'id: a\n']]), 'msg'),
      (err: unknown) => err instanceof SourceError,
    )
  })

  it('commit creates a missing branch from the default branch head when createBranchIfMissing', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    const mainHead = await git.resolveRef({ fs, dir: tmpDir, ref: 'main' })
    await source.commit('feat/created-by-commit', new Map([
      ['components/orders/created.yaml', 'id: orders.DomainModel.created\n'],
    ]), 'create branch on commit', { createBranchIfMissing: true })

    const content = await source.loadGraphContent('feat/created-by-commit')
    assert.ok(content.has('components/orders/created.yaml'))

    const branchHead = await git.resolveRef({ fs, dir: tmpDir, ref: 'feat/created-by-commit' })
    const { commit } = await git.readCommit({ fs, dir: tmpDir, oid: branchHead })
    assert.deepEqual(commit.parent, [mainHead])
  })

  it('concurrent commits to the same branch are serialised, not lost', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/concurrent', checkout: false })
    await Promise.all([
      source.commit('feat/concurrent', new Map([['components/orders/a.yaml', 'id: orders.DomainModel.a\n']]), 'add a'),
      source.commit('feat/concurrent', new Map([['components/orders/b.yaml', 'id: orders.DomainModel.b\n']]), 'add b'),
    ])

    const content = await source.loadGraphContent('feat/concurrent')
    assert.ok(content.has('components/orders/a.yaml'), 'first concurrent commit was lost')
    assert.ok(content.has('components/orders/b.yaml'), 'second concurrent commit was lost')
  })

  it('head returns the current commit SHA of a branch', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    assert.equal(await source.head('main'), await git.resolveRef({ fs, dir: tmpDir, ref: 'main' }))
  })

  it('log walks from head back to a base SHA, exclusive, newest first', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/log-walk', checkout: false })
    const base = await source.head('feat/log-walk')
    assert.deepEqual(await source.log('feat/log-walk', base), [])

    await source.commit('feat/log-walk', new Map([['components/orders/c.yaml', 'id: orders.DomainModel.c\n']]), 'add c')
    const first = await source.head('feat/log-walk')
    await source.commit('feat/log-walk', new Map([['components/orders/d.yaml', 'id: orders.DomainModel.d\n']]), 'add d')
    const second = await source.head('feat/log-walk')

    assert.deepEqual(await source.log('feat/log-walk', base), [second, first])
  })

  it('remote-url sources resolve the branch head from the updated local ref after commit', async () => {
    const remoteBranch = 'feat/remote-head'
    await git.branch({ fs, dir: tmpDir, ref: remoteBranch, checkout: false })
    await git.addRemote({ fs, dir: tmpDir, remote: 'origin', url: 'https://example.com/repo.git' })

    const base = await git.resolveRef({ fs, dir: tmpDir, ref: remoteBranch })
    await git.writeRef({ fs, dir: tmpDir, ref: 'refs/remotes/origin/main', value: await git.resolveRef({ fs, dir: tmpDir, ref: 'main' }), force: true })
    await git.writeRef({ fs, dir: tmpDir, ref: `refs/remotes/origin/${remoteBranch}`, value: base, force: true })

    const source = new GitGraphSource({ remoteUrl: 'https://example.com/repo.git' })
    const patchedSource = source as any
    patchedSource.cacheManager.ensureCloned = async () => tmpDir
    patchedSource.cachedDir = tmpDir
    patchedSource.push = async () => {}

    await source.commit(remoteBranch, new Map([
      ['components/orders/remote.yaml', 'id: orders.DomainModel.remote\n'],
    ]), 'remote change')

    const localHead = await git.resolveRef({ fs, dir: tmpDir, ref: `refs/heads/${remoteBranch}` })
    assert.equal(await source.head(remoteBranch), localHead)
    assert.deepEqual(await source.log(remoteBranch, base), [localHead])
  })

  it('commit with parentSha writes a commit parented at the given SHA (squash)', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await git.branch({ fs, dir: tmpDir, ref: 'feat/squash', checkout: false })
    const base = await source.head('feat/squash')

    await source.commit('feat/squash', new Map([['components/orders/wip1.yaml', 'id: orders.DomainModel.wip1\n']]), 'corum-wip: one')
    await source.commit('feat/squash', new Map([['components/orders/wip2.yaml', 'id: orders.DomainModel.wip2\n']]), 'corum-wip: two')

    await source.commit('feat/squash', new Map([
      ['components/orders/final.yaml', 'id: orders.DomainModel.final\n'],
    ]), 'squashed', { parentSha: base, force: true })

    const head = await source.head('feat/squash')
    const { commit } = await git.readCommit({ fs, dir: tmpDir, oid: head })
    assert.deepEqual(commit.parent, [base], 'squash commit must be parented at the base SHA')
    assert.match(commit.message, /squashed/)
    assert.deepEqual(await source.log('feat/squash', base), [head], 'WIP run must be replaced by the single squash commit')

    const content = await source.loadGraphContent('feat/squash')
    assert.ok(content.has('components/orders/final.yaml'))
  })
})
