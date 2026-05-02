# Git Source Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct `node:fs` calls in loaders with a swappable `GraphSource` abstraction, implement `FileGraphSource` and `GitGraphSource`, and refactor `graph-writer` to produce a `ContentMap` for source-agnostic writes.

**Architecture:** A new `src/source/` module defines the `GraphSource` interface and `ContentMap` type. Loaders receive a `ContentMap` instead of filesystem paths — they become storage-agnostic. `FileGraphSource` wraps the existing filesystem behaviour. `GitGraphSource` reads git objects directly via isomorphic-git without materialising a working tree. `graph-writer` is refactored to return a `ContentMap` that is passed to `source.commit()`.

**Tech Stack:** TypeScript, Node.js built-in test runner (`node:test`), isomorphic-git, existing `yaml` package.

## Stage 1 Decisions

- `ContentMap` keys are canonical source-relative POSIX paths, not absolute filesystem paths. For graph content, keys are relative to the graph root, e.g. `components/orders/DomainModels/order.yaml`, `edges/orders.edges.yaml`, and `graph.yaml` when serialising writes. Loaders use these keys for diagnostics and `Node.extractedFrom`. This keeps filesystem and git sources lossless without exposing storage-specific paths.
- Pack content is loaded separately from graph content. Pack keys keep the existing logical shape `<packName>/templates/<file>.yaml`; template packs always load from the default branch.
- Git writes must not materialise or edit a working tree. `GitGraphSource.commit()` writes blobs/trees/commits directly with isomorphic-git plumbing and updates refs.
- The first write implementation uses a full serialized graph snapshot and replaces the graph directory content on the target branch. This is simpler and avoids stale deleted YAML files. Later stages can optimise this into minimal diffs without changing loader contracts.
- Remote repos are cached locally as no-checkout repositories. Before listing branches or reading refs, the cache performs a fetch. Branch listing is based on fetched refs: local heads for local repositories, remote heads for remote repositories.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Install | `package.json` | Add `isomorphic-git` dependency |
| Create | `src/source/index.ts` | `GraphSource` interface, `ContentMap` type, `SourceError` |
| Create | `src/source/content-utils.ts` | `listYamlKeys`, `readYaml`, `hasKey` helpers |
| Create | `src/source/file-source.ts` | `FileGraphSource` — fs-backed source |
| Create | `src/source/git-source.ts` | `GitGraphSource` — isomorphic-git backed source |
| Create | `src/source/git-cache.ts` | `GitCacheManager` — manages `~/.config/corum/cache/` |
| Modify | `src/schema/index.ts` | Update `LoadOptions`; add `SourceError` re-export |
| Modify | `src/loader/pack-loader.ts` | Accept `ContentMap` instead of `string[]` |
| Modify | `src/loader/cluster-loader.ts` | Accept `ContentMap` instead of `graphPath: string` |
| Modify | `src/loader/edge-loader.ts` | Accept `ContentMap` instead of `graphPath: string` |
| Modify | `src/loader/index.ts` | Orchestrate via `GraphSource`; keep `graphPath` shim |
| Modify | `src/loader/fs-utils.ts` | Retain for `FileGraphSource` only; add `ContentMap` helpers |
| Modify | `src/writer/graph-writer.ts` | `serializeGraph()` returns `ContentMap`; `saveGraph()` delegates to source |
| Create | `test/source.test.ts` | Tests for `FileGraphSource` and `GitGraphSource` |
| Modify | `test/loader.test.ts` | Update to call loaders with `ContentMap` |
| Modify | `test/writer.test.ts` | Update to use refactored `saveGraph` |
| Modify | `package.json` | Add new test file to `test` script |

---

## Task 1: Install isomorphic-git

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install**

```bash
npm install isomorphic-git
```

- [ ] **Step 2: Verify**

```bash
node -e "import('isomorphic-git').then(g => console.log('ok', Object.keys(g).slice(0,3)))"
```

Expected output: `ok [ 'Errors', 'STAGE', 'add' ]` (or similar list of exports)

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add isomorphic-git dependency"
```

---

## Task 2: Source types — GraphSource interface, ContentMap, SourceError

**Files:**
- Create: `src/source/index.ts`
- Modify: `src/schema/index.ts`

- [ ] **Step 1: Write failing test**

Create `test/source.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { SourceError } from '../src/source/index.js'

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
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `src/source/index.ts` does not exist.

- [ ] **Step 3: Create `src/source/index.ts`**

```ts
export type ContentMap = Map<string, string>

export interface CommitOptions {
  replaceGraphContent?: boolean
}

export interface GraphSource {
  defaultBranch(): Promise<string>
  listBranches(): Promise<string[]>
  loadPackContent(ref: string): Promise<ContentMap>
  loadGraphContent(ref: string): Promise<ContentMap>
  commit(branch: string, changes: ContentMap, message: string, options?: CommitOptions): Promise<void>
}

export class SourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'SourceError'
  }
}
```

- [ ] **Step 4: Add `source.test.js` to the test script in `package.json`**

```json
"test": "tsc && node --test dist/test/schema.test.js dist/test/loader.test.js dist/test/graph.test.js dist/test/mcp.test.js dist/test/writer.test.js dist/test/serializer.test.js dist/test/web.test.js dist/test/nav.test.js dist/test/source.test.js"
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all existing tests pass; new `SourceError` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/source/index.ts test/source.test.ts package.json
git commit -m "feat: add GraphSource interface, ContentMap, and SourceError"
```

---

## Task 3: ContentMap query helpers

**Files:**
- Create: `src/source/content-utils.ts`
- Modify: `test/source.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/source.test.ts`:

```ts
import { listYamlKeys, readYaml, hasKey } from '../src/source/content-utils.js'

describe('content-utils', () => {
  const map: Map<string, string> = new Map([
    ['components/orders/order.yaml', 'id: order'],
    ['components/orders/payment.yaml', 'id: payment'],
    ['edges/corum.edges.yaml', 'edges: []'],
    ['graph.yaml', 'templatePacks: []'],
  ])

  it('listYamlKeys returns keys under a prefix', () => {
    const keys = listYamlKeys(map, 'components/orders')
    assert.deepEqual(keys.sort(), [
      'components/orders/order.yaml',
      'components/orders/payment.yaml',
    ])
  })

  it('listYamlKeys with empty prefix returns all yaml keys', () => {
    const keys = listYamlKeys(map, '')
    assert.equal(keys.length, 4)
  })

  it('readYaml returns content for existing key', () => {
    assert.equal(readYaml(map, 'graph.yaml'), 'templatePacks: []')
  })

  it('readYaml throws for missing key', () => {
    assert.throws(
      () => readYaml(map, 'missing.yaml'),
      /not found in ContentMap/,
    )
  })

  it('hasKey returns true for existing key', () => {
    assert.ok(hasKey(map, 'graph.yaml'))
  })

  it('hasKey returns false for missing key', () => {
    assert.ok(!hasKey(map, 'nope.yaml'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `content-utils.ts` does not exist.

- [ ] **Step 3: Create `src/source/content-utils.ts`**

```ts
import type { ContentMap } from './index.js'

export function listYamlKeys(content: ContentMap, prefix: string): string[] {
  const normalised = prefix && !prefix.endsWith('/') ? prefix + '/' : prefix
  return [...content.keys()].filter(
    k => k.endsWith('.yaml') && (normalised === '' || k.startsWith(normalised)),
  )
}

export function readYaml(content: ContentMap, key: string): string {
  const value = content.get(key)
  if (value === undefined) throw new Error(`${key} not found in ContentMap`)
  return value
}

export function hasKey(content: ContentMap, key: string): boolean {
  return content.has(key)
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass including new content-utils tests.

- [ ] **Step 5: Commit**

```bash
git add src/source/content-utils.ts test/source.test.ts
git commit -m "feat: add ContentMap query helpers"
```

---

## Task 4: FileGraphSource

**Files:**
- Create: `src/source/file-source.ts`
- Modify: `test/source.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/source.test.ts`:

```ts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FileGraphSource } from '../src/source/file-source.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('FileGraphSource', () => {
  it('defaultBranch returns a non-empty string', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branch = await source.defaultBranch()
    assert.ok(typeof branch === 'string' && branch.length > 0)
  })

  it('listBranches returns a single-element array', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branches = await source.listBranches()
    assert.equal(branches.length, 1)
  })

  it('loadGraphContent returns a ContentMap with cluster yaml files', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branch = await source.defaultBranch()
    const content = await source.loadGraphContent(branch)
    assert.ok(content.size > 0)
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.startsWith('components/') && k.endsWith('.yaml')))
    assert.ok(keys.some(k => k === 'graph.yaml'), 'graph.yaml included for lossless serialization')
  })

  it('loadPackContent returns a ContentMap with template yaml files', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branch = await source.defaultBranch()
    const content = await source.loadPackContent(branch)
    assert.ok(content.size > 0)
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.includes('templates/') && k.endsWith('.yaml')))
  })

  it('loadGraphContent and loadPackContent keys do not overlap', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const branch = await source.defaultBranch()
    const graphContent = await source.loadGraphContent(branch)
    const packContent = await source.loadPackContent(branch)
    const graphKeys = new Set(graphContent.keys())
    const packKeys = new Set(packContent.keys())
    for (const key of packKeys) {
      assert.ok(!graphKeys.has(key), `key ${key} appears in both maps`)
    }
  })

  it('commit writes graph content to the configured graphDir', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-file-source-'))
    const source = new FileGraphSource({ graphDir: tmpDir, defaultBranch: 'local' })
    await source.commit('local', new Map([
      ['graph.yaml', 'templatePacks: []\n'],
      ['components/orders/order.yaml', 'id: order\n'],
    ]), 'write snapshot', { replaceGraphContent: true })
    assert.equal(fs.readFileSync(path.join(tmpDir, 'components/orders/order.yaml'), 'utf-8'), 'id: order\n')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `file-source.ts` does not exist.

- [ ] **Step 3: Create `src/source/file-source.ts`**

```ts
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import type { CommitOptions, ContentMap, GraphSource } from './index.js'
import { SourceError } from './index.js'
import { isPackRef } from '../loader/fs-utils.js'

export interface FileGraphSourceOptions {
  graphDir?: string
  defaultBranch?: string
}

const DEFAULT_GRAPH_DIR = '.corum/graph'

export class FileGraphSource implements GraphSource {
  private readonly graphDir: string
  private readonly defaultBranchOverride?: string

  constructor(options: FileGraphSourceOptions = {}) {
    this.graphDir = options.graphDir ?? DEFAULT_GRAPH_DIR
    this.defaultBranchOverride = options.defaultBranch
  }

  async defaultBranch(): Promise<string> {
    if (this.defaultBranchOverride) return this.defaultBranchOverride
    try {
      // Walk up from graphDir to find the repo root, then ask git for the current branch
      const repoRoot = await git.findRoot({ fs, filepath: this.graphDir })
      const branch = await git.currentBranch({ fs, dir: repoRoot })
      if (branch) return branch
    } catch {
      // not a git repo or detached HEAD — fall through
    }
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    return [await this.defaultBranch()]
  }

  async loadPackContent(_ref: string): Promise<ContentMap> {
    const map: ContentMap = new Map()
    const graphYamlPath = path.join(this.graphDir, 'graph.yaml')
    if (!existsSync(graphYamlPath)) return map

    const doc = parseYaml(readFileSync(graphYamlPath, 'utf-8')) as Record<string, unknown>
    const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []

    for (const pack of packs) {
      if (!isPackRef(pack)) continue
      const packDir = path.resolve(this.graphDir, pack.path)
      const templatesDir = path.join(packDir, 'templates')
      if (!existsSync(templatesDir)) continue
      const packName = path.basename(packDir)
      for (const file of readdirSync(templatesDir).filter(f => f.endsWith('.yaml'))) {
        const filePath = path.join(templatesDir, file)
        const key = `${packName}/templates/${file}`
        map.set(key, readFileSync(filePath, 'utf-8'))
      }
    }
    return map
  }

  async loadGraphContent(_ref: string): Promise<ContentMap> {
    const map: ContentMap = new Map()
    walkYamlFilesIntoMap(this.graphDir, this.graphDir, map, [])
    return map
  }

  async commit(branch: string, changes: ContentMap, _message: string, options: CommitOptions = {}): Promise<void> {
    const defaultBranch = await this.defaultBranch()
    if (branch !== defaultBranch) {
      throw new SourceError(`FileGraphSource only supports its local branch '${defaultBranch}', got '${branch}'`)
    }
    if (options.replaceGraphContent && existsSync(this.graphDir)) {
      rmSync(this.graphDir, { recursive: true, force: true })
    }
    for (const [key, content] of changes) {
      const filePath = path.join(this.graphDir, ...key.split('/'))
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }
  }
}

function walkYamlFilesIntoMap(
  baseDir: string,
  currentDir: string,
  map: ContentMap,
  excludeNames: string[],
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      walkYamlFilesIntoMap(baseDir, fullPath, map, [])
    } else if (entry.isFile() && entry.name.endsWith('.yaml') && !excludeNames.includes(entry.name)) {
      const key = path.relative(baseDir, fullPath).split(path.sep).join('/')
      map.set(key, readFileSync(fullPath, 'utf-8'))
    }
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass including new `FileGraphSource` tests.

- [ ] **Step 5: Commit**

```bash
git add src/source/file-source.ts test/source.test.ts
git commit -m "feat: add FileGraphSource"
```

---

## Task 5: Refactor loadPacks to accept ContentMap

**Files:**
- Modify: `src/loader/pack-loader.ts`
- Modify: `test/loader.test.ts`

The current `loadPacks(packDirs: string[], diagnostics)` is replaced with `loadPacks(content: ContentMap, diagnostics)`. The ContentMap keys follow the pattern `<packName>/templates/<file>.yaml` as produced by `FileGraphSource.loadPackContent`.

- [ ] **Step 1: Add ContentMap-based test**

At the top of `test/loader.test.ts`, add a new import and helper:

```ts
import type { ContentMap } from '../src/source/index.js'
import { FileGraphSource } from '../src/source/file-source.js'

async function buildPackContentMap(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadPackContent(await source.defaultBranch())
}
```

Add a new describe block (do not remove existing tests yet):

```ts
describe('pack loader (ContentMap)', () => {
  it('loads templates from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const content = await buildPackContentMap()
    const templates = loadPacks(content, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.ok(templates.has('DomainModel'))
    assert.ok(templates.has('APIEndpoint'))
    assert.ok(templates.has('Field'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -10
```

Expected: TypeScript error — `loadPacks` signature mismatch.

- [ ] **Step 3: Update `src/loader/pack-loader.ts`**

Replace the `loadPacks` function signature and body. Keep `getOwnedSections` and `topoSortTemplates` unchanged:

```ts
import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Template } from '../schema/index.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

// ... keep topoSortTemplates and RESERVED_TEMPLATE_KEYS and getOwnedSections unchanged ...

export function loadPacks(
  content: ContentMap,
  diagnostics: Diagnostic[],
): Map<string, Template> {
  const templates = new Map<string, Template>()
  let base: Template | undefined

  // Keys are '<packName>/templates/<file>.yaml'
  const templateKeys = listYamlKeys(content, '').filter(k => k.includes('/templates/'))

  for (const key of templateKeys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    const templateRecord = raw as Record<string, unknown>
    const info = typeof templateRecord.info === 'object' && templateRecord.info !== null
      ? templateRecord.info as Record<string, unknown>
      : null

    if (typeof templateRecord.name !== 'string' || typeof info?.version !== 'string') {
      diagnostics.push({ severity: 'error', file: key, message: 'template missing required name or info.version' })
      continue
    }

    const template = templateRecord as Template
    if (template.name === 'base') {
      base = template
    } else {
      templates.set(template.name, template)
    }
  }

  if (base) {
    for (const template of templates.values()) {
      inheritNonReserved(template, base)
    }
  }

  for (const template of topoSortTemplates(templates)) {
    if (!template.extends) continue

    const parent = templates.get(template.extends)
    if (!parent) {
      diagnostics.push({
        severity: 'error',
        file: `template:${template.name}`,
        message: `extends references unknown template: ${template.extends}`,
      })
      continue
    }

    if (parent.properties && template.properties) {
      template.properties = { allOf: [parent.properties, template.properties] }
    } else if (parent.properties) {
      template.properties = parent.properties
    }
    inheritNonReserved(template, parent)
  }

  return templates
}
```

- [ ] **Step 4: Update old pack-loader tests to use ContentMap helper**

In `test/loader.test.ts`, update the `loadSampleClusters` helper and the old pack loader tests to use `buildPackContentMap()`. Replace:

```ts
const samplePackDirs = [...]

async function loadSampleClusters(diagnostics: Diagnostic[] = []) {
  const templates = await loadPacks(samplePackDirs, diagnostics)
  return loadClusters(fixtureGraphDir, templates, diagnostics)
}
```

With:

```ts
async function loadSampleClusters(diagnostics: Diagnostic[] = []) {
  const packContent = await buildPackContentMap()
  const templates = loadPacks(packContent, diagnostics)
  return loadClusters(fixtureGraphDir, templates, diagnostics)
}
```

Update each `loadPacks(samplePackDirs, diagnostics)` call in existing tests to `loadPacks(await buildPackContentMap(), diagnostics)`.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/loader/pack-loader.ts test/loader.test.ts
git commit -m "refactor: loadPacks accepts ContentMap instead of packDirs array"
```

---

## Task 6: Refactor loadClusters to accept ContentMap

**Files:**
- Modify: `src/loader/cluster-loader.ts`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add ContentMap-based test**

Add helper to `test/loader.test.ts`:

```ts
import { FileGraphSource } from '../src/source/file-source.js'

async function buildGraphContentMap(): Promise<ContentMap> {
  const source = new FileGraphSource({ graphDir: fixtureGraphDir })
  return source.loadGraphContent(await source.defaultBranch())
}
```

Add test:

```ts
describe('cluster loader (ContentMap)', () => {
  it('materialises 151 nodes from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const packContent = await buildPackContentMap()
    const templates = loadPacks(packContent, diagnostics)
    const graphContent = await buildGraphContentMap()
    const result = loadClusters(graphContent, templates, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    assert.equal(result.nodes.size, 151)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -10
```

Expected: TypeScript error — `loadClusters` signature mismatch.

- [ ] **Step 3: Update `src/loader/cluster-loader.ts`**

Replace the `loadClusters` signature. Change all `readFileSync(filePath, 'utf-8')` calls to `readYaml(content, relativeKey)` and replace `walkYamlFiles(componentsDir)` with `listYamlKeys(content, 'components')`. Remove `node:fs` imports; add ContentMap imports.

```ts
import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, Node, Stability, State, Template } from '../schema/index.js'
import { getOwnedSections } from './pack-loader.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'
import { STRUCTURAL_EDGE_BY_ITEM_TEMPLATE, VALID_STABILITY_SET, VALID_STATE_SET } from './constants.js'

// ... keep all type definitions (ClusterResult, RootRecord) unchanged ...

export function loadClusters(
  content: ContentMap,
  templates: Map<string, Template>,
  diagnostics: Diagnostic[],
): ClusterResult {
  const result: ClusterResult = { nodes: new Map(), edgesByFrom: new Map(), edgesByTo: new Map() }
  const clusterKeys = listYamlKeys(content, 'components')

  for (const key of clusterKeys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }

    // ... rest of the cluster parsing logic unchanged, but replace
    // all `filePath` references with `key` for diagnostics ...
    // replace node.extractedFrom = filePath  →  node.extractedFrom = key
  }
  return result
}
```

- [ ] **Step 4: Update old cluster tests**

In `test/loader.test.ts`, update `loadSampleClusters` to use `buildGraphContentMap()`:

```ts
async function loadSampleClusters(diagnostics: Diagnostic[] = []) {
  const packContent = await buildPackContentMap()
  const templates = loadPacks(packContent, diagnostics)
  const graphContent = await buildGraphContentMap()
  return loadClusters(graphContent, templates, diagnostics)
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass, still 151 nodes.

- [ ] **Step 6: Commit**

```bash
git add src/loader/cluster-loader.ts test/loader.test.ts
git commit -m "refactor: loadClusters accepts ContentMap instead of graphPath"
```

---

## Task 7: Refactor loadEdges to accept ContentMap

**Files:**
- Modify: `src/loader/edge-loader.ts`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add ContentMap-based test**

```ts
describe('edge loader (ContentMap)', () => {
  it('loads 65 explicit edges from ContentMap', async () => {
    const diagnostics: Diagnostic[] = []
    const clusters = await loadSampleClusters(diagnostics)
    const graphContent = await buildGraphContentMap()
    const edgeResult = loadEdges(graphContent, clusters.nodes, diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    const allEdges = [...edgeResult.edgesByFrom.values()].flat()
    assert.equal(allEdges.length, 65)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -10
```

- [ ] **Step 3: Update `src/loader/edge-loader.ts`**

```ts
import { parse as parseYaml } from 'yaml'
import type { ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, EdgeType, Node, Stability, State } from '../schema/index.js'
import { VALID_EDGE_TYPE_SET } from './constants.js'
import { listYamlKeys, readYaml } from '../source/content-utils.js'

// ... keep EdgeResult type unchanged ...

export function loadEdges(
  content: ContentMap,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
): EdgeResult {
  const result: EdgeResult = { edgesByFrom: new Map(), edgesByTo: new Map() }
  const edgeKeys = listYamlKeys(content, 'edges')

  for (const key of edgeKeys) {
    let raw: unknown
    try {
      raw = parseYaml(readYaml(content, key))
    } catch (err) {
      diagnostics.push({ severity: 'error', file: key, message: `failed to parse YAML: ${err}` })
      continue
    }
    // ... rest of edge parsing unchanged, replace filePath with key in diagnostics ...
  }
  return result
}
```

- [ ] **Step 4: Update old edge tests**

Update all `loadEdges(fixtureGraphDir, ...)` calls to `loadEdges(await buildGraphContentMap(), ...)`.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/loader/edge-loader.ts test/loader.test.ts
git commit -m "refactor: loadEdges accepts ContentMap instead of graphPath"
```

---

## Task 8: Refactor loadGraph to orchestrate via GraphSource

**Files:**
- Modify: `src/loader/index.ts`
- Modify: `src/schema/index.ts`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Update LoadOptions in schema**

In `src/schema/index.ts`, update `LoadOptions`:

```ts
import type { ContentMap, GraphSource } from '../source/index.js'

export interface LoadOptions {
  source?: GraphSource
  ref?: string
  strict?: boolean
  // Deprecated shim — creates FileGraphSource internally
  graphPath?: string
  packsPath?: string
}
```

Also add `sourceContent?: ContentMap` to the existing `Graph` interface. `loadGraph()` stores the graph `ContentMap` there so `serializeGraph()` can preserve `graph.yaml` and original source-relative file keys without reading from a filesystem path.

- [ ] **Step 2: Add failing test**

Add to `test/loader.test.ts`:

```ts
import { FileGraphSource } from '../src/source/file-source.js'

describe('loadGraph via GraphSource', () => {
  it('loads 151 nodes and 167 edges using FileGraphSource', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graph = await loadGraph({ source })
    assert.equal(graph.nodesById.size, 151)
    const allEdges = [...graph.edgesByFrom.values()].flat()
    assert.equal(allEdges.length, 167)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run build 2>&1 | head -10
```

- [ ] **Step 4: Update `src/loader/index.ts`**

```ts
import { FileGraphSource } from '../source/file-source.js'
import type { GraphSource, ContentMap } from '../source/index.js'
import type { Diagnostic, Edge, Graph, LoadOptions } from '../schema/index.js'
import { LoadError } from '../schema/index.js'
import { loadClusters } from './cluster-loader.js'
import { loadEdges } from './edge-loader.js'
import { loadPacks } from './pack-loader.js'

export async function loadGraph(options: LoadOptions): Promise<Graph> {
  const { strict = true } = options
  const diagnostics: Diagnostic[] = []

  const source: GraphSource = options.source ?? new FileGraphSource({ graphDir: options.graphPath })

  const defaultRef = await source.defaultBranch()
  const ref = options.ref ?? defaultRef

  const packContent = await source.loadPackContent(defaultRef)
  const templates = loadPacks(packContent, diagnostics)

  const graphContent = await source.loadGraphContent(ref)
  const clusterResult = loadClusters(graphContent, templates, diagnostics)
  const edgeResult = loadEdges(graphContent, clusterResult.nodes, diagnostics)

  const edgesByFrom = cloneEdgeMap(clusterResult.edgesByFrom)
  const edgesByTo = cloneEdgeMap(clusterResult.edgesByTo)
  mergeEdgeMaps(edgesByFrom, edgeResult.edgesByFrom)
  mergeEdgeMaps(edgesByTo, edgeResult.edgesByTo)

  const graph: Graph = {
    nodesById: clusterResult.nodes,
    edgesByFrom,
    edgesByTo,
    templates,
    diagnostics,
    sourceContent: graphContent,
  }

  if (strict && diagnostics.some(d => d.severity === 'error')) {
    throw new LoadError(diagnostics)
  }

  return graph
}

function cloneEdgeMap(source: Map<string, Edge[]>): Map<string, Edge[]> {
  return new Map([...source.entries()].map(([key, edges]) => [key, [...edges]]))
}

function mergeEdgeMaps(target: Map<string, Edge[]>, source: Map<string, Edge[]>): void {
  for (const [key, edges] of source) {
    const existing = target.get(key) ?? []
    target.set(key, [...existing, ...edges])
  }
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass. The existing `loadGraph({ graphPath: ... })` tests still work via the shim.

- [ ] **Step 6: Commit**

```bash
git add src/loader/index.ts src/schema/index.ts test/loader.test.ts
git commit -m "refactor: loadGraph orchestrates via GraphSource; graphPath shim retained"
```

---

## Task 9: Refactor graph-writer to produce ContentMap

**Files:**
- Modify: `src/writer/graph-writer.ts`
- Modify: `test/writer.test.ts`

The writer gains a new `serializeGraph()` function that returns a full graph `ContentMap` snapshot. `saveGraph()` is kept for backward compatibility by using `FileGraphSource.commit()` internally; source-aware callers should call `source.commit(branch, serializeGraph(graph), message, { replaceGraphContent: true })`.

- [ ] **Step 1: Add failing test**

Add to `test/writer.test.ts`:

```ts
import { serializeGraph } from '../src/writer/graph-writer.js'

describe('serializeGraph', () => {
  it('returns a ContentMap with cluster and edge yaml', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const map = serializeGraph(graph)
    assert.ok(map.size > 0)
    const keys = [...map.keys()]
    assert.ok(keys.some(k => k.startsWith('components/') && k.endsWith('.yaml')))
    assert.ok(keys.some(k => k.startsWith('edges/')))
    assert.ok(keys.some(k => k === 'graph.yaml'))
  })

  it('ContentMap round-trips through loadGraph', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    // Write to temp dir and reload via graphPath shim
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-serialize-'))
    const map = serializeGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
    try {
      for (const [key, content] of map) {
        const filePath = path.join(tmpDir, ...key.split('/'))
        fs.mkdirSync(path.dirname(filePath), { recursive: true })
        fs.writeFileSync(filePath, content)
      }
      const reloaded = await loadGraph({ graphPath: tmpDir })
      assert.equal(reloaded.nodesById.size, 151)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

- [ ] **Step 3: Add `serializeGraph` to `src/writer/graph-writer.ts`**

Add the following before `saveGraph`. The existing private functions (`toClusterDocument`, `writeClusterFiles`, etc.) are unchanged; `serializeGraph` replaces the write-to-disk calls with map inserts:

```ts
import type { ContentMap } from '../source/index.js'
import { FileGraphSource } from '../source/file-source.js'

export interface SerializeGraphOptions {
  sourceGraphPath?: string
  outputGraphPath?: string
}

export function serializeGraph(graph: Graph, options: SerializeGraphOptions = {}): ContentMap {
  const map: ContentMap = new Map()

  // Preserve graph.yaml exactly where possible so pack paths remain valid for both FileGraphSource and GitGraphSource.
  map.set('graph.yaml', buildGraphYaml(graph, options))

  // cluster files
  for (const root of getRootNodes(graph)) {
    if (!root.extractedFrom) continue
    const relativeFilePath = normalizeContentKey(root.extractedFrom)
    map.set(relativeFilePath, stringifyGraphYaml(toClusterDocument(graph, root)))
  }

  // explicit edges
  const explicitEdges = getAllEdges(graph)
    .filter(edge => !STRUCTURAL_EDGE_TYPES.has(edge.type))
    .sort((a, b) => a.id.localeCompare(b.id))
  if (explicitEdges.length > 0) {
    map.set('edges/corum.edges.yaml', stringifyGraphYaml({ edges: explicitEdges.map(toEdgeDocument) }))
  }

  return map
}

function normalizeContentKey(value: string): string {
  return value.split(path.sep).join('/')
}

function buildGraphYaml(graph: Graph, options: SerializeGraphOptions): string {
  const content = graph.sourceContent?.get('graph.yaml')
  if (!content) return stringifyGraphYaml({ templatePacks: [] })

  if (!options.sourceGraphPath || !options.outputGraphPath) return content

  const doc = parseYaml(content) as Record<string, unknown>
  const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
  doc.templatePacks = packs.map(pack => {
    if (!isPackRef(pack)) return pack
    const absolutePackPath = path.resolve(options.sourceGraphPath!, pack.path)
    return {
      ...pack,
      path: normalizeContentKey(path.relative(options.outputGraphPath!, absolutePackPath)),
    }
  })
  return stringifyGraphYaml(doc)
}
```

Update `saveGraph` to use `serializeGraph`:

```ts
export async function saveGraph(graph: Graph, options: SaveGraphOptions): Promise<void> {
  const { outputGraphPath, replace = true } = options

  if (fs.existsSync(outputGraphPath)) {
    if (!replace) throw new Error(`output graph folder already exists: ${outputGraphPath}`)
  }

  const source = new FileGraphSource({ graphDir: outputGraphPath, defaultBranch: 'local' })
  await source.commit(
    'local',
    serializeGraph(graph, { sourceGraphPath: options.sourceGraphPath, outputGraphPath }),
    'save graph',
    { replaceGraphContent: replace },
  )
}
```

- [ ] **Step 4: Add `serializeGraph` to package.json test script** (already done via `writer.test.js` which is already included)

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all existing writer tests pass; new `serializeGraph` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/writer/graph-writer.ts test/writer.test.ts
git commit -m "refactor: graph-writer exposes serializeGraph returning ContentMap"
```

---

## Task 10: GitCacheManager

**Files:**
- Create: `src/source/git-cache.ts`
- Modify: `test/source.test.ts`

- [ ] **Step 1: Add failing test**

Append to `test/source.test.ts`:

```ts
import { GitCacheManager } from '../src/source/git-cache.js'

describe('GitCacheManager', () => {
  it('cacheDir returns a stable path for the same URL', () => {
    const mgr = new GitCacheManager()
    const dir1 = mgr.cacheDir('https://github.com/org/repo')
    const dir2 = mgr.cacheDir('https://github.com/org/repo')
    assert.equal(dir1, dir2)
  })

  it('cacheDir returns different paths for different URLs', () => {
    const mgr = new GitCacheManager()
    const dir1 = mgr.cacheDir('https://github.com/org/repo-a')
    const dir2 = mgr.cacheDir('https://github.com/org/repo-b')
    assert.notEqual(dir1, dir2)
  })

  it('cacheDir path does not contain the URL directly', () => {
    const mgr = new GitCacheManager()
    const dir = mgr.cacheDir('https://github.com/org/repo')
    assert.ok(!dir.includes('github.com'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

- [ ] **Step 3: Create `src/source/git-cache.ts`**

```ts
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { SourceError } from './index.js'

const CACHE_BASE = path.join(os.homedir(), '.config', 'corum', 'cache')

export class GitCacheManager {
  cacheDir(remoteUrl: string): string {
    const hash = createHash('sha256').update(remoteUrl).digest('hex').slice(0, 16)
    return path.join(CACHE_BASE, hash)
  }

  async ensureCloned(
    remoteUrl: string,
    onAuth?: () => { username: string; password: string },
  ): Promise<string> {
    const dir = this.cacheDir(remoteUrl)
    mkdirSync(dir, { recursive: true })

    if (!existsSync(path.join(dir, '.git'))) {
      try {
        await git.clone({
          fs,
          http: (await import('isomorphic-git/http/node')).default,
          dir,
          url: remoteUrl,
          noCheckout: true,
          singleBranch: false,
          onAuth,
        })
      } catch (err) {
        throw new SourceError(`failed to clone ${remoteUrl}`, err)
      }
      return dir
    }

    // Already cloned — try fetch; recover from corruption
    try {
      await git.fetch({
        fs,
        http: (await import('isomorphic-git/http/node')).default,
        dir,
        remote: 'origin',
        refspecs: ['+refs/heads/*:refs/remotes/origin/*'],
        onAuth,
      })
    } catch (_fetchErr) {
      // Attempt recovery: delete and re-clone once
      try {
        rmSync(dir, { recursive: true, force: true })
        mkdirSync(dir, { recursive: true })
        await git.clone({
          fs,
          http: (await import('isomorphic-git/http/node')).default,
          dir,
          url: remoteUrl,
          noCheckout: true,
          singleBranch: false,
          onAuth,
        })
      } catch (err) {
        throw new SourceError(`failed to recover cache for ${remoteUrl}`, err)
      }
    }

    return dir
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/source/git-cache.ts test/source.test.ts
git commit -m "feat: add GitCacheManager for remote repo caching"
```

---

## Task 11: GitGraphSource — read path

**Files:**
- Create: `src/source/git-source.ts`
- Modify: `test/source.test.ts`

Tests use a programmatically-created fixture git repo via isomorphic-git. No external git CLI required.

- [ ] **Step 1: Add git fixture helper and failing tests**

Append to `test/source.test.ts`:

```ts
import * as git from 'isomorphic-git'
import { GitGraphSource } from '../src/source/git-source.js'

async function createFixtureRepo(tmpDir: string): Promise<void> {
  await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })

  const graphDir = path.join(tmpDir, '.corum', 'graph')
  const componentsDir = path.join(graphDir, 'components', 'orders')
  fs.mkdirSync(componentsDir, { recursive: true })
  fs.mkdirSync(path.join(graphDir, 'edges'), { recursive: true })

  // graph.yaml (no packs — pack tests use FileGraphSource)
  fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'templatePacks: []\n')

  // cluster file on main
  fs.writeFileSync(
    path.join(componentsDir, 'order.yaml'),
    'id: orders.DomainModel.order\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: agreed\n  stability: stable\n  lastModifiedAt: "2026-01-01"\n',
  )

  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/graph.yaml' })
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/order.yaml' })
  await git.commit({
    fs, dir: tmpDir,
    message: 'initial',
    author: { name: 'Test', email: 'test@test.com' },
  })

  // feature branch with an added node
  await git.branch({ fs, dir: tmpDir, ref: 'feat/payment', checkout: true })
  fs.writeFileSync(
    path.join(componentsDir, 'payment.yaml'),
    'id: orders.DomainModel.payment\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: proposed\n  stability: unstable\n  lastModifiedAt: "2026-01-02"\n',
  )
  await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/payment.yaml' })
  await git.commit({
    fs, dir: tmpDir,
    message: 'add payment node',
    author: { name: 'Test', email: 'test@test.com' },
  })

  // return to main
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
    const source = new GitGraphSource({ localPath: tmpDir })
    assert.equal(await source.defaultBranch(), 'main')
  })

  it('listBranches returns main and feat/payment', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    const branches = await source.listBranches()
    assert.ok(branches.includes('main'))
    assert.ok(branches.includes('feat/payment'))
  })

  it('loadGraphContent for main returns order.yaml only', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    const content = await source.loadGraphContent('main')
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.includes('order.yaml')))
    assert.ok(!keys.some(k => k.includes('payment.yaml')))
  })

  it('loadGraphContent for feat/payment includes payment.yaml', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    const content = await source.loadGraphContent('feat/payment')
    const keys = [...content.keys()]
    assert.ok(keys.some(k => k.includes('payment.yaml')))
  })

  it('throws SourceError when neither localPath nor remoteUrl provided', () => {
    assert.throws(
      () => new GitGraphSource({}),
      (err: unknown) => err instanceof SourceError,
    )
  })

  it('throws SourceError when both localPath and remoteUrl provided', () => {
    assert.throws(
      () => new GitGraphSource({ localPath: '/foo', remoteUrl: 'https://example.com/repo' }),
      (err: unknown) => err instanceof SourceError,
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

- [ ] **Step 3: Create `src/source/git-source.ts`**

```ts
import fs from 'node:fs'
import path from 'node:path'
import * as git from 'isomorphic-git'
import type { CommitOptions, ContentMap, GraphSource } from './index.js'
import { SourceError } from './index.js'
import { GitCacheManager } from './git-cache.js'

export interface BranchLoadOptions {
  maxBranches?: number
  staleDaysThreshold?: number
}

export interface GitGraphSourceOptions {
  graphDir?: string
  localPath?: string
  remoteUrl?: string
  defaultBranch?: string
  auth?: { username: string; token: string }
  branchLoad?: BranchLoadOptions
}

const DEFAULT_GRAPH_DIR = '.corum/graph'

export class GitGraphSource implements GraphSource {
  private readonly graphDir: string
  private readonly localPath: string | undefined
  private readonly remoteUrl: string | undefined
  private readonly defaultBranchOverride: string | undefined
  private readonly auth: { username: string; token: string } | undefined
  private readonly branchLoad: BranchLoadOptions
  private readonly cacheManager: GitCacheManager
  private cachedDir: string | undefined

  constructor(options: GitGraphSourceOptions) {
    if (!options.localPath && !options.remoteUrl) {
      throw new SourceError('GitGraphSource requires either localPath or remoteUrl')
    }
    if (options.localPath && options.remoteUrl) {
      throw new SourceError('GitGraphSource requires either localPath or remoteUrl, not both')
    }
    this.graphDir = options.graphDir ?? DEFAULT_GRAPH_DIR
    this.localPath = options.localPath
    this.remoteUrl = options.remoteUrl
    this.defaultBranchOverride = options.defaultBranch
    this.auth = options.auth
    this.branchLoad = options.branchLoad ?? {}
    this.cacheManager = new GitCacheManager()
  }

  private onAuth() {
    if (!this.auth) return undefined
    return () => ({ username: this.auth!.username, password: this.auth!.token })
  }

  private async dir(): Promise<string> {
    if (this.localPath) return this.localPath
    if (!this.cachedDir) {
      this.cachedDir = await this.cacheManager.ensureCloned(this.remoteUrl!, this.onAuth())
    }
    return this.cachedDir
  }

  async defaultBranch(): Promise<string> {
    if (this.defaultBranchOverride) return this.defaultBranchOverride
    try {
      const dir = await this.dir()
      if (this.remoteUrl) {
        const branches = await git.listBranches({ fs, dir, remote: 'origin' })
        if (branches.includes('main')) return 'main'
        if (branches.includes('master')) return 'master'
        if (branches.length > 0) return branches[0]
      }
      const branch = await git.currentBranch({ fs, dir })
      if (branch) return branch
    } catch {
      // fall through
    }
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    const dir = await this.dir()
    let branches: string[]
    try {
      branches = this.remoteUrl
        ? await git.listBranches({ fs, dir, remote: 'origin' })
        : await git.listBranches({ fs, dir })
    } catch (err) {
      throw new SourceError('failed to list branches', err)
    }

    const { staleDaysThreshold, maxBranches } = this.branchLoad
    const defaultBranch = await this.defaultBranch()

    if (staleDaysThreshold !== undefined) {
      const cutoff = Date.now() - staleDaysThreshold * 24 * 60 * 60 * 1000
      const fresh: string[] = []
      for (const branch of branches) {
        // Default branch is always included regardless of staleness
        if (branch === defaultBranch) { fresh.push(branch); continue }
        try {
          const sha = await this.resolveBranchOid(branch)
          const { commit } = await git.readCommit({ fs, dir, oid: sha })
          const commitTime = commit.author.timestamp * 1000
          if (commitTime >= cutoff) fresh.push(branch)
        } catch {
          // skip branches whose commits can't be read
        }
      }
      branches = fresh
    }

    if (maxBranches !== undefined && branches.length > maxBranches) {
      const withDates: Array<{ branch: string; timestamp: number }> = []
      for (const branch of branches) {
        try {
          const sha = await this.resolveBranchOid(branch)
          const { commit } = await git.readCommit({ fs, dir, oid: sha })
          withDates.push({ branch, timestamp: commit.author.timestamp })
        } catch {
          withDates.push({ branch, timestamp: 0 })
        }
      }
      withDates.sort((a, b) => b.timestamp - a.timestamp)
      branches = [
        defaultBranch,
        ...withDates.filter(b => b.branch !== defaultBranch).slice(0, maxBranches - 1).map(b => b.branch),
      ]
    }

    return branches
  }

  private async resolveBranchOid(branch: string): Promise<string> {
    const dir = await this.dir()
    if (this.remoteUrl) {
      try {
        return await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
      } catch {
        // fall through to local refs for newly-created branches before first push
      }
    }
    return git.resolveRef({ fs, dir, ref: branch })
  }

  async loadPackContent(_ref: string): Promise<ContentMap> {
    // Packs always come from the default branch
    const defaultRef = await this.defaultBranch()
    const dir = await this.dir()
    const map: ContentMap = new Map()

    let commitSha: string
    try {
      commitSha = await this.resolveBranchOid(defaultRef)
    } catch (err) {
      throw new SourceError(`failed to resolve ref '${defaultRef}'`, err)
    }

    // Read graph.yaml to find pack paths
    const graphYamlRepoPath = `${this.graphDir}/graph.yaml`
    let graphYamlContent: string
    try {
      const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: graphYamlRepoPath })
      graphYamlContent = new TextDecoder().decode(blob)
    } catch {
      return map // no graph.yaml — no packs
    }

    const { parse: parseYaml } = await import('yaml')
    const doc = parseYaml(graphYamlContent) as Record<string, unknown>
    const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
    const allFiles = await git.listFiles({ fs, dir, ref: commitSha })

    for (const pack of packs) {
      if (typeof (pack as Record<string, unknown>).path !== 'string') continue
      const packPath = (pack as { path: string }).path
      const absPackPath = normalizeRepoPath(this.graphDir, packPath)
      const packName = absPackPath.split('/').pop() ?? packPath
      const packPrefix = absPackPath.endsWith('/') ? absPackPath : absPackPath + '/'

      for (const filePath of allFiles.filter(f => f.startsWith(packPrefix) && f.endsWith('.yaml'))) {
        try {
          const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: filePath })
          const relKey = filePath.slice(packPrefix.length)
          map.set(`${packName}/${relKey}`, new TextDecoder().decode(blob))
        } catch {
          // skip unreadable blobs
        }
      }
    }
    return map
  }

  async loadGraphContent(ref: string): Promise<ContentMap> {
    const dir = await this.dir()
    const map: ContentMap = new Map()

    let commitSha: string
    try {
      commitSha = await this.resolveBranchOid(ref)
    } catch (err) {
      throw new SourceError(`failed to resolve ref '${ref}'`, err)
    }

    const prefix = this.graphDir.endsWith('/') ? this.graphDir : this.graphDir + '/'
    const allFiles = await git.listFiles({ fs, dir, ref: commitSha })

    for (const filePath of allFiles.filter(f => f.startsWith(prefix) && f.endsWith('.yaml'))) {
      try {
        const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: filePath })
        map.set(filePath.slice(prefix.length), new TextDecoder().decode(blob))
      } catch {
        // skip unreadable blobs
      }
    }
    return map
  }

  async commit(_branch: string, _changes: ContentMap, _message: string): Promise<void> {
    // Write path implemented in Task 12
    throw new SourceError('GitGraphSource.commit() not yet implemented — see Task 12')
  }
}

function normalizeRepoPath(baseDir: string, value: string): string {
  const normalized = value.startsWith('/')
    ? path.posix.normalize(value.slice(1))
    : path.posix.normalize(path.posix.join(baseDir, value))
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new SourceError(`path escapes repository root: ${value}`)
  }
  return normalized
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all existing tests pass; new `GitGraphSource` tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/source/git-source.ts test/source.test.ts
git commit -m "feat: add GitGraphSource read path via isomorphic-git"
```

---

## Task 12: GitGraphSource — write path (buildUpdatedTree + commit)

**Files:**
- Modify: `src/source/git-source.ts`
- Modify: `test/source.test.ts`

- [ ] **Step 1: Add failing test**

Append to `test/source.test.ts` (within the GitGraphSource describe block, reusing `tmpDir` from Task 11 setup):

```ts
describe('GitGraphSource write path', () => {
  let tmpDir: string

  it('setup', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-git-write-'))
    await createFixtureRepo(tmpDir)
  })

  it('commit writes a new file to a non-default branch and reads it back', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })

    // create a branch to commit to
    await git.branch({ fs, dir: tmpDir, ref: 'feat/write-test', checkout: false })

    const changes: ContentMap = new Map([
      ['components/orders/new-node.yaml',
        'id: orders.DomainModel.new-node\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: proposed\n  stability: unstable\n  lastModifiedAt: "2026-01-03"\n'],
    ])

    await source.commit('feat/write-test', changes, 'add new-node', { replaceGraphContent: true })

    // read back from the branch
    const content = await source.loadGraphContent('feat/write-test')
    assert.ok(content.has('components/orders/new-node.yaml'), 'new file is readable after commit')
  })

  it('commit throws SourceError on default branch', async () => {
    const source = new GitGraphSource({ localPath: tmpDir })
    await assert.rejects(
      () => source.commit('main', new Map(), 'msg'),
      (err: unknown) => err instanceof SourceError,
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build && node --test dist/test/source.test.js 2>&1 | grep -E "fail|Error" | head -10
```

Expected: `commit() not yet implemented` error.

- [ ] **Step 3: Implement `commit()` and `buildUpdatedTree` in `src/source/git-source.ts`**

Replace the stub `commit()` method with:

```ts
async commit(branch: string, changes: ContentMap, message: string, options: CommitOptions = {}): Promise<void> {
  const defaultBranch = await this.defaultBranch()
  if (branch === defaultBranch) {
    throw new SourceError(`cannot commit to default branch '${branch}' — it is read-only`)
  }

  const dir = await this.dir()
  const prefix = this.graphDir.endsWith('/') ? this.graphDir : this.graphDir + '/'

  // Resolve current HEAD of target branch
  let parentSha: string
  try {
    parentSha = await this.resolveBranchOid(branch)
  } catch (err) {
    throw new SourceError(`cannot resolve branch '${branch}'`, err)
  }

  const { commit: parentCommit } = await git.readCommit({ fs, dir, oid: parentSha })

  // Write blobs for all changed files
  const blobMap = new Map<string, string>() // repo-relative path → blob OID
  for (const [key, content] of changes) {
    const repoPath = prefix + key
    const oid = await git.writeBlob({ fs, dir, blob: Buffer.from(content, 'utf-8') })
    blobMap.set(repoPath, oid)
  }

  // Build updated tree from root. Stage 1 passes replaceGraphContent to avoid stale deleted YAML files.
  const newTreeOid = options.replaceGraphContent
    ? await buildReplacedGraphTree(fs, dir, parentCommit.tree, prefix, blobMap)
    : await buildUpdatedTree(fs, dir, parentCommit.tree, blobMap)

  // Write commit
  const now = Math.floor(Date.now() / 1000)
  const newCommitOid = await git.writeCommit({
    fs,
    dir,
    commit: {
      tree: newTreeOid,
      parent: [parentSha],
      message,
      author: { name: 'corum', email: 'corum@localhost', timestamp: now, timezoneOffset: 0 },
      committer: { name: 'corum', email: 'corum@localhost', timestamp: now, timezoneOffset: 0 },
    },
  })

  // Update branch ref
  await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: newCommitOid, force: true })

  // Push if remote
  if (this.remoteUrl) {
    const http = (await import('isomorphic-git/http/node')).default
    try {
      await git.push({ fs, http, dir, remote: 'origin', ref: branch, onAuth: this.onAuth() })
    } catch (err) {
      throw new SourceError(`failed to push branch '${branch}'`, err)
    }
  }
}
```

Add the `buildReplacedGraphTree` and `buildUpdatedTree` helpers outside the class:

```ts
async function buildReplacedGraphTree(
  fsImpl: typeof fs,
  dir: string,
  rootTreeOid: string,
  graphPrefix: string,
  blobMap: Map<string, string>,
): Promise<string> {
  const graphDir = graphPrefix.replace(/\/$/, '')
  const prunedRoot = await removeTreePath(fsImpl, dir, rootTreeOid, graphDir.split('/'))
  return buildUpdatedTree(fsImpl, dir, prunedRoot, blobMap)
}

async function removeTreePath(
  fsImpl: typeof fs,
  dir: string,
  treeOid: string,
  parts: string[],
): Promise<string> {
  const { tree } = await git.readTree({ fs: fsImpl, dir, oid: treeOid })
  const [head, ...tail] = parts
  if (!head) return treeOid

  if (tail.length === 0) {
    return git.writeTree({ fs: fsImpl, dir, tree: tree.filter(entry => entry.path !== head) })
  }

  const entries = [...tree]
  const idx = entries.findIndex(entry => entry.path === head && entry.type === 'tree')
  if (idx < 0) return treeOid

  const nextOid = await removeTreePath(fsImpl, dir, entries[idx].oid, tail)
  entries[idx] = { ...entries[idx], oid: nextOid }
  return git.writeTree({ fs: fsImpl, dir, tree: entries })
}

async function buildUpdatedTree(
  fsImpl: typeof fs,
  dir: string,
  rootTreeOid: string,
  blobMap: Map<string, string>, // repo-relative path → blob OID
): Promise<string> {
  // Group blobs by their top-level directory segment
  async function rebuildTree(treeOid: string, prefix: string): Promise<string> {
    const { tree } = await git.readTree({ fs: fsImpl, dir, oid: treeOid })
    const entries = [...tree]

    for (const [repoPath, blobOid] of blobMap) {
      if (!repoPath.startsWith(prefix)) continue
      const remainder = repoPath.slice(prefix.length)
      const parts = remainder.split('/')

      if (parts.length === 1) {
        // File directly in this tree
        const fileName = parts[0]
        const existing = entries.findIndex(e => e.path === fileName)
        const entry = { mode: '100644' as const, path: fileName, oid: blobOid, type: 'blob' as const }
        if (existing >= 0) entries[existing] = entry
        else entries.push(entry)
      } else {
        // File is in a subtree — recurse
        const subdir = parts[0]
        const existing = entries.find(e => e.path === subdir && e.type === 'tree')
        const subTreeOid = existing?.oid ?? await git.writeTree({ fs: fsImpl, dir, tree: [] })
        const newSubTreeOid = await rebuildTree(subTreeOid, `${prefix}${subdir}/`)
        const idx = entries.findIndex(e => e.path === subdir)
        const entry = { mode: '040000' as const, path: subdir, oid: newSubTreeOid, type: 'tree' as const }
        if (idx >= 0) entries[idx] = entry
        else entries.push(entry)
      }
    }

    return git.writeTree({ fs: fsImpl, dir, tree: entries })
  }

  return rebuildTree(rootTreeOid, '')
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass including write path tests.

- [ ] **Step 5: Commit**

```bash
git add src/source/git-source.ts test/source.test.ts
git commit -m "feat: implement GitGraphSource commit via git plumbing (no working tree)"
```

---

## Stage 1 complete ✓

At this point:
- All loaders are ContentMap-based and storage-agnostic
- `FileGraphSource` wraps filesystem access
- `GitGraphSource` reads and writes git objects directly via isomorphic-git
- `graph-writer` produces a `ContentMap` via `serializeGraph()`
- All existing tests pass

Run the full test suite to confirm:

```bash
npm test
```

Expected: all tests pass with 151 nodes and 167 edges from fixtures.

Continue with `2026-05-01-gitsource-stage2.md` for multi-branch overlay support.
