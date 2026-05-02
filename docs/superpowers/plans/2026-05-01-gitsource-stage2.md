# Git Source Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Stage 1 plan must be complete — all loaders ContentMap-based, `GitGraphSource` operational, all tests passing.

**Goal:** Add multi-branch support — load all branches into memory, compute an overlay view with ghost states for cross-branch node visibility, and expose branches via MCP tools and the web UI.

**Architecture:** `loadMultiGraph` loads all branches in parallel using the existing `GraphSource.loadGraphContent`. A `MultiGraph` holds one `BranchGraph` per loaded branch. `overlay(viewingRef)` computes a full outer join across all branch node maps and assigns a `GhostState` to every node ID. `diff(ref)` is a subset query. New MCP tools `list_branches` and `diff_branch` expose the data; existing tools gain an optional `branch` parameter.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing isomorphic-git setup from Stage 1.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/schema/index.ts` | Add `BranchGraph`, `BranchLoadResult`, `BranchLoadStatus`, `BranchDiff`, `GhostState`, `OverlayNode`, `OverlayEdge`, `BranchOverlay`, `MultiGraph` |
| Modify | `src/loader/index.ts` | Add `loadMultiGraph` |
| Create | `src/graph/overlay.ts` | `computeOverlay`, `computeDiff` — pure in-memory graph operations |
| Modify | `src/mcp/index.ts` | Add `list_branches`, `diff_branch` tools; add `branch` param to `list_nodes`, `get_cluster`, `get_linked_fields` |
| Modify | `src/web/server.ts` | Wire `loadMultiGraph`; expose branch data to web layer |
| Create | `test/multigraph.test.ts` | Tests for `loadMultiGraph`, overlay, diff |
| Modify | `package.json` | Add `multigraph.test.js` to test script |

---

## Task 1: Schema types for multi-branch model

**Files:**
- Modify: `src/schema/index.ts`
- Create: `test/multigraph.test.ts`

- [ ] **Step 1: Write failing test**

Create `test/multigraph.test.ts`:

```ts
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { GhostState, OverlayNode, BranchGraph, MultiGraph } from '../src/schema/index.js'

describe('schema types (compile check)', () => {
  it('GhostState covers all expected values', () => {
    const states: GhostState[] = [
      'local', 'local-modified', 'shared',
      'default-only', 'ghost-single', 'ghost-consensus', 'ghost-conflict',
    ]
    assert.equal(states.length, 7)
  })
})
```

- [ ] **Step 2: Add `multigraph.test.js` to package.json test script**

```json
"test": "tsc && node --test dist/test/schema.test.js dist/test/loader.test.js dist/test/graph.test.js dist/test/mcp.test.js dist/test/writer.test.js dist/test/serializer.test.js dist/test/web.test.js dist/test/nav.test.js dist/test/source.test.js dist/test/multigraph.test.js"
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `GhostState` not exported from schema.

- [ ] **Step 4: Add types to `src/schema/index.ts`**

Append to the existing file:

```ts
import type { GraphSource } from '../source/index.js'

export type GhostState =
  | 'local'
  | 'local-modified'
  | 'shared'
  | 'default-only'
  | 'ghost-single'
  | 'ghost-consensus'
  | 'ghost-conflict'

export interface BranchGraph {
  ref: string
  sha: string
  isDefault: boolean
  graph: Graph
}

export type BranchLoadStatus = 'loaded' | 'failed'

export interface BranchLoadResult {
  ref: string
  status: BranchLoadStatus
  error?: string
}

export interface OverlayNode {
  id: string
  presence: Map<string, Node>  // ref → Node
  ghostState: GhostState
}

export interface OverlayEdge {
  id: string
  presence: Map<string, Edge>  // ref → Edge
  ghostState: GhostState
}

export interface BranchOverlay {
  viewingRef: string
  nodes: Map<string, OverlayNode>
  edges: Map<string, OverlayEdge>
}

export interface BranchDiff {
  added: Node[]
  modified: Node[]
  removed: Node[]
}

export interface MultiGraph {
  default: BranchGraph
  branches: BranchGraph[]
  branchResults: BranchLoadResult[]
  overlay(viewingRef: string): BranchOverlay
  diff(branchRef: string): BranchDiff
}

export interface MultiLoadOptions {
  source: GraphSource
  branches?: string[]
  strict?: boolean
}
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/schema/index.ts test/multigraph.test.ts package.json
git commit -m "feat: add multi-branch schema types (BranchGraph, MultiGraph, GhostState, etc.)"
```

---

## Task 2: computeOverlay and computeDiff

**Files:**
- Create: `src/graph/overlay.ts`
- Modify: `test/multigraph.test.ts`

These are pure functions — no I/O, no git.

- [ ] **Step 1: Add failing tests**

Append to `test/multigraph.test.ts`:

```ts
import type { Node, Edge, Graph } from '../src/schema/index.js'
import { computeOverlay, computeDiff } from '../src/graph/overlay.js'

function makeNode(id: string, extra: Partial<Node> = {}): Node {
  return {
    id, template: 'DomainModel', component: 'test',
    state: 'proposed', stability: 'unstable',
    schemaVersion: '1.0', lastModifiedAt: '2026-01-01',
    properties: {}, ...extra,
  }
}

function makeGraph(nodes: Node[], edges: Edge[] = []): Graph {
  const nodesById = new Map(nodes.map(n => [n.id, n]))
  const edgesByFrom = new Map<string, Edge[]>()
  const edgesByTo = new Map<string, Edge[]>()
  for (const e of edges) {
    edgesByFrom.set(e.from, [...(edgesByFrom.get(e.from) ?? []), e])
    edgesByTo.set(e.to, [...(edgesByTo.get(e.to) ?? []), e])
  }
  return { nodesById, edgesByFrom, edgesByTo, templates: new Map(), diagnostics: [] }
}

describe('computeOverlay', () => {
  const nodeA = makeNode('test.DomainModel.a')
  const nodeB = makeNode('test.DomainModel.b')
  const nodeBModified = makeNode('test.DomainModel.b', { properties: { changed: true } })
  const nodeC = makeNode('test.DomainModel.c')

  const defaultBranch = { ref: 'main', sha: 'abc', isDefault: true, graph: makeGraph([nodeA, nodeB]) }
  const branchFeat = { ref: 'feat/x', sha: 'def', isDefault: false, graph: makeGraph([nodeB, nodeC]) }
  const branchFeat2 = { ref: 'feat/y', sha: 'ghi', isDefault: false, graph: makeGraph([nodeBModified, nodeC]) }

  it('local: node only on viewing branch', () => {
    const overlay = computeOverlay('feat/x', defaultBranch, [branchFeat])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'local')
  })

  it('default-only: node on default but not viewing branch', () => {
    const overlay = computeOverlay('feat/x', defaultBranch, [branchFeat])
    const nodeA_overlay = overlay.nodes.get('test.DomainModel.a')
    assert.ok(nodeA_overlay)
    assert.equal(nodeA_overlay.ghostState, 'default-only')
  })

  it('shared: node on viewing branch and default with same properties', () => {
    const overlay = computeOverlay('feat/x', defaultBranch, [branchFeat])
    const nodeB_overlay = overlay.nodes.get('test.DomainModel.b')
    assert.ok(nodeB_overlay)
    assert.equal(nodeB_overlay.ghostState, 'shared')
  })

  it('local-modified: node on viewing branch and others with different properties', () => {
    const branchViewing = { ref: 'feat/z', sha: 'zzz', isDefault: false, graph: makeGraph([nodeBModified]) }
    const overlay = computeOverlay('feat/z', defaultBranch, [branchViewing, branchFeat])
    const nodeB_overlay = overlay.nodes.get('test.DomainModel.b')
    assert.ok(nodeB_overlay)
    assert.equal(nodeB_overlay.ghostState, 'local-modified')
  })

  it('ghost-single: node on exactly one other branch, not on viewing branch', () => {
    const branchViewing = { ref: 'feat/v', sha: 'vvv', isDefault: false, graph: makeGraph([nodeA]) }
    const overlay = computeOverlay('feat/v', defaultBranch, [branchViewing, branchFeat])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'ghost-single')
  })

  it('ghost-consensus: node on 2+ other branches with same properties', () => {
    const branchViewing = { ref: 'feat/v', sha: 'vvv', isDefault: false, graph: makeGraph([nodeA]) }
    const branchFeatSame = { ref: 'feat/same', sha: 'sss', isDefault: false, graph: makeGraph([nodeC]) }
    const overlay = computeOverlay('feat/v', defaultBranch, [branchViewing, branchFeat, branchFeatSame])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'ghost-consensus')
  })

  it('ghost-conflict: node on 2+ other branches with different properties', () => {
    const branchViewing = { ref: 'feat/v', sha: 'vvv', isDefault: false, graph: makeGraph([nodeA]) }
    const overlay = computeOverlay('feat/v', defaultBranch, [branchViewing, branchFeat, branchFeat2])
    const nodeB_overlay = overlay.nodes.get('test.DomainModel.b')
    assert.ok(nodeB_overlay)
    assert.equal(nodeB_overlay.ghostState, 'ghost-conflict')
  })

  it('presence map contains all branch versions', () => {
    const overlay = computeOverlay('feat/x', defaultBranch, [branchFeat])
    const nodeB_overlay = overlay.nodes.get('test.DomainModel.b')
    assert.ok(nodeB_overlay)
    assert.ok(nodeB_overlay.presence.has('main'))
    assert.ok(nodeB_overlay.presence.has('feat/x'))
  })
})

describe('computeDiff', () => {
  const nodeA = makeNode('test.DomainModel.a')
  const nodeB = makeNode('test.DomainModel.b')
  const nodeBMod = makeNode('test.DomainModel.b', { properties: { v: 2 } })
  const nodeC = makeNode('test.DomainModel.c')

  const defaultBranch = { ref: 'main', sha: 'abc', isDefault: true, graph: makeGraph([nodeA, nodeB]) }
  const branchFeat = { ref: 'feat/x', sha: 'def', isDefault: false, graph: makeGraph([nodeBMod, nodeC]) }

  it('added: node in branch but not in default', () => {
    const diff = computeDiff(branchFeat, defaultBranch)
    assert.ok(diff.added.some(n => n.id === 'test.DomainModel.c'))
  })

  it('removed: node in default but not in branch', () => {
    const diff = computeDiff(branchFeat, defaultBranch)
    assert.ok(diff.removed.some(n => n.id === 'test.DomainModel.a'))
  })

  it('modified: node in both with different properties', () => {
    const diff = computeDiff(branchFeat, defaultBranch)
    assert.ok(diff.modified.some(n => n.id === 'test.DomainModel.b'))
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

- [ ] **Step 3: Create `src/graph/overlay.ts`**

```ts
import type { BranchDiff, BranchGraph, BranchOverlay, GhostState, OverlayEdge, OverlayNode } from '../schema/index.js'

export function computeOverlay(
  viewingRef: string,
  defaultBranch: BranchGraph,
  allBranches: BranchGraph[],
): BranchOverlay {
  const viewingBranch = allBranches.find(b => b.ref === viewingRef)

  // Collect all node IDs across all branches
  const allNodeIds = new Set<string>()
  for (const branch of allBranches) {
    for (const id of branch.graph.nodesById.keys()) allNodeIds.add(id)
  }
  for (const id of defaultBranch.graph.nodesById.keys()) allNodeIds.add(id)

  const nodes = new Map<string, OverlayNode>()
  for (const id of allNodeIds) {
    const presence = new Map<string, import('../schema/index.js').Node>()
    for (const branch of allBranches) {
      const node = branch.graph.nodesById.get(id)
      if (node) presence.set(branch.ref, node)
    }
    const defaultNode = defaultBranch.graph.nodesById.get(id)
    if (defaultNode && !presence.has(defaultBranch.ref)) {
      presence.set(defaultBranch.ref, defaultNode)
    }

    nodes.set(id, {
      id,
      presence,
      ghostState: deriveNodeGhostState(id, viewingRef, viewingBranch, defaultBranch, presence),
    })
  }

  // Collect all edge IDs
  const allEdgeIds = new Set<string>()
  for (const branch of allBranches) {
    for (const edges of branch.graph.edgesByFrom.values()) {
      for (const e of edges) allEdgeIds.add(e.id)
    }
  }
  for (const edges of defaultBranch.graph.edgesByFrom.values()) {
    for (const e of edges) allEdgeIds.add(e.id)
  }

  const edges = new Map<string, OverlayEdge>()
  for (const id of allEdgeIds) {
    const presence = new Map<string, import('../schema/index.js').Edge>()
    for (const branch of [...allBranches, defaultBranch]) {
      for (const edgeList of branch.graph.edgesByFrom.values()) {
        const edge = edgeList.find(e => e.id === id)
        if (edge) presence.set(branch.ref, edge)
      }
    }
    edges.set(id, {
      id,
      presence,
      ghostState: deriveEdgeGhostState(id, viewingRef, viewingBranch, defaultBranch, presence),
    })
  }

  return { viewingRef, nodes, edges }
}

function nodesEqual(a: import('../schema/index.js').Node, b: import('../schema/index.js').Node): boolean {
  return JSON.stringify(a.properties) === JSON.stringify(b.properties) &&
    a.state === b.state &&
    a.stability === b.stability
}

function edgesEqual(a: import('../schema/index.js').Edge, b: import('../schema/index.js').Edge): boolean {
  return a.type === b.type && a.state === b.state && a.stability === b.stability && a.notes === b.notes
}

function deriveNodeGhostState(
  id: string,
  viewingRef: string,
  viewingBranch: BranchGraph | undefined,
  defaultBranch: BranchGraph,
  presence: Map<string, import('../schema/index.js').Node>,
): GhostState {
  const onViewing = presence.has(viewingRef)
  const othersExceptViewing = [...presence.entries()].filter(([ref]) => ref !== viewingRef)

  if (onViewing) {
    if (othersExceptViewing.length === 0) return 'local'
    const viewingNode = presence.get(viewingRef)!
    const allMatch = othersExceptViewing.every(([, n]) => nodesEqual(viewingNode, n))
    return allMatch ? 'shared' : 'local-modified'
  }

  // Not on viewing branch
  const othersExceptDefault = othersExceptViewing.filter(([ref]) => ref !== defaultBranch.ref)

  if (presence.has(defaultBranch.ref) && othersExceptDefault.length === 0) {
    return 'default-only'
  }

  const nonDefaultOthers = othersExceptViewing.filter(([ref]) => ref !== defaultBranch.ref)
  if (nonDefaultOthers.length === 0 && presence.has(defaultBranch.ref)) return 'default-only'
  if (nonDefaultOthers.length === 1 && !presence.has(defaultBranch.ref)) return 'ghost-single'
  if (nonDefaultOthers.length >= 1 || presence.has(defaultBranch.ref)) {
    const allPresence = [...presence.values()]
    const first = allPresence[0]
    const allMatch = allPresence.every(n => nodesEqual(first, n))
    if (nonDefaultOthers.length === 1 && presence.size === 1) return 'ghost-single'
    return allMatch ? 'ghost-consensus' : 'ghost-conflict'
  }
  return 'ghost-single'
}

function deriveEdgeGhostState(
  id: string,
  viewingRef: string,
  viewingBranch: BranchGraph | undefined,
  defaultBranch: BranchGraph,
  presence: Map<string, import('../schema/index.js').Edge>,
): GhostState {
  const onViewing = presence.has(viewingRef)
  const others = [...presence.entries()].filter(([ref]) => ref !== viewingRef)

  if (onViewing) {
    if (others.length === 0) return 'local'
    const viewingEdge = presence.get(viewingRef)!
    return others.every(([, e]) => edgesEqual(viewingEdge, e)) ? 'shared' : 'local-modified'
  }

  if (presence.has(defaultBranch.ref) && others.filter(([r]) => r !== defaultBranch.ref).length === 0) {
    return 'default-only'
  }
  const nonDefault = others.filter(([ref]) => ref !== defaultBranch.ref)
  if (nonDefault.length <= 1 && !presence.has(defaultBranch.ref)) return 'ghost-single'
  const allPresence = [...presence.values()]
  const first = allPresence[0]
  return allPresence.every(e => edgesEqual(first, e)) ? 'ghost-consensus' : 'ghost-conflict'
}

export function computeDiff(branch: BranchGraph, defaultBranch: BranchGraph): BranchDiff {
  const added: import('../schema/index.js').Node[] = []
  const modified: import('../schema/index.js').Node[] = []
  const removed: import('../schema/index.js').Node[] = []

  for (const [id, node] of branch.graph.nodesById) {
    const defaultNode = defaultBranch.graph.nodesById.get(id)
    if (!defaultNode) {
      added.push(node)
    } else if (!nodesEqual(node, defaultNode)) {
      modified.push(node)
    }
  }

  for (const [id, node] of defaultBranch.graph.nodesById) {
    if (!branch.graph.nodesById.has(id)) {
      removed.push(node)
    }
  }

  return { added, modified, removed }
}
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass including all ghost state cases.

- [ ] **Step 5: Commit**

```bash
git add src/graph/overlay.ts test/multigraph.test.ts
git commit -m "feat: add computeOverlay and computeDiff for in-memory branch comparison"
```

---

## Task 3: loadMultiGraph

**Files:**
- Modify: `src/loader/index.ts`
- Modify: `test/multigraph.test.ts`

- [ ] **Step 1: Add failing test**

Append to `test/multigraph.test.ts`:

```ts
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import os from 'node:os'
import * as git from 'isomorphic-git'
import { FileGraphSource } from '../src/source/file-source.js'
import { GitGraphSource } from '../src/source/git-source.js'
import { loadMultiGraph } from '../src/loader/index.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')

describe('loadMultiGraph', () => {
  it('loads a MultiGraph with one branch using FileGraphSource', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    assert.ok(multi.default)
    assert.equal(multi.branches.length, 1)
    assert.equal(multi.branchResults.length, 1)
    assert.equal(multi.branchResults[0].status, 'loaded')
  })

  it('overlay returns all nodes as local for FileGraphSource', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    const defaultRef = await source.defaultBranch()
    const overlay = multi.overlay(defaultRef)
    const states = new Set([...overlay.nodes.values()].map(n => n.ghostState))
    assert.ok(states.size === 1 && states.has('local'), 'all nodes should be local')
  })

  it('diff returns empty lists when branch equals default', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    const defaultRef = await source.defaultBranch()
    const diff = multi.diff(defaultRef)
    assert.equal(diff.added.length, 0)
    assert.equal(diff.modified.length, 0)
    assert.equal(diff.removed.length, 0)
  })

  it('loads multiple branches with GitGraphSource fixture', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-multi-'))
    try {
      // Set up fixture repo with two branches
      await git.init({ fs, dir: tmpDir, defaultBranch: 'main' })
      const graphDir = path.join(tmpDir, '.corum', 'graph')
      const compDir = path.join(graphDir, 'components', 'orders')
      fs.mkdirSync(compDir, { recursive: true })
      fs.writeFileSync(path.join(graphDir, 'graph.yaml'), 'templatePacks: []\n')
      fs.writeFileSync(
        path.join(compDir, 'order.yaml'),
        'id: orders.DomainModel.order\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: agreed\n  stability: stable\n  lastModifiedAt: "2026-01-01"\n',
      )
      await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/graph.yaml' })
      await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/order.yaml' })
      await git.commit({ fs, dir: tmpDir, message: 'init', author: { name: 'T', email: 't@t.com' } })

      await git.branch({ fs, dir: tmpDir, ref: 'feat/add-payment', checkout: true })
      fs.writeFileSync(
        path.join(compDir, 'payment.yaml'),
        'id: orders.DomainModel.payment\ntemplate: DomainModel\nschemaVersion: "1.0"\nmetadata:\n  component: orders\n  state: proposed\n  stability: unstable\n  lastModifiedAt: "2026-01-02"\n',
      )
      await git.add({ fs, dir: tmpDir, filepath: '.corum/graph/components/orders/payment.yaml' })
      await git.commit({ fs, dir: tmpDir, message: 'add payment', author: { name: 'T', email: 't@t.com' } })
      await git.checkout({ fs, dir: tmpDir, ref: 'main' })

      const source = new GitGraphSource({ localPath: tmpDir })
      const multi = await loadMultiGraph({ source })

      assert.equal(multi.branches.length, 2)
      assert.ok(multi.branchResults.every(r => r.status === 'loaded'))

      // overlay from feat branch: payment node is local, order node is shared (main also has it)
      const overlay = multi.overlay('feat/add-payment')
      const paymentOverlay = overlay.nodes.get('orders.DomainModel.payment')
      const orderOverlay = overlay.nodes.get('orders.DomainModel.order')
      assert.ok(paymentOverlay, 'payment node in overlay')
      assert.equal(paymentOverlay.ghostState, 'local')
      assert.ok(orderOverlay, 'order node in overlay')
      assert.equal(orderOverlay.ghostState, 'shared')
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

Expected: `loadMultiGraph` not exported.

- [ ] **Step 3: Add `loadMultiGraph` to `src/loader/index.ts`**

Append to the existing file:

```ts
import type { BranchGraph, BranchLoadResult, MultiGraph, MultiLoadOptions } from '../schema/index.js'
import { computeOverlay, computeDiff } from '../graph/overlay.js'

export async function loadMultiGraph(options: MultiLoadOptions): Promise<MultiGraph> {
  const { source, strict = false } = options

  const defaultRef = await source.defaultBranch()

  // Load default branch — throw if it fails
  let defaultBranchGraph: BranchGraph
  try {
    const graph = await loadGraph({ source, ref: defaultRef, strict })
    // SHA is informational only — not exposed on the interface; use empty string as sentinel
    defaultBranchGraph = { ref: defaultRef, sha: '', isDefault: true, graph }
  } catch (err) {
    const { SourceError } = await import('../source/index.js')
    throw new SourceError(`failed to load default branch '${defaultRef}'`, err)
  }

  // Determine which branches to load
  const requestedBranches = options.branches ?? await source.listBranches()
  const nonDefaultBranches = requestedBranches.filter(b => b !== defaultRef)

  // Load non-default branches in parallel
  const results = await Promise.allSettled(
    nonDefaultBranches.map(async (ref) => {
      const graph = await loadGraph({ source, ref, strict })
      const sha = ''
      return { ref, sha, isDefault: false, graph } as BranchGraph
    }),
  )

  const branches: BranchGraph[] = [defaultBranchGraph]
  const branchResults: BranchLoadResult[] = [{ ref: defaultRef, status: 'loaded' }]

  for (let i = 0; i < results.length; i++) {
    const result = results[i]
    const ref = nonDefaultBranches[i]
    if (result.status === 'fulfilled') {
      branches.push(result.value)
      branchResults.push({ ref, status: 'loaded' })
    } else {
      branchResults.push({
        ref,
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
      })
    }
  }

  // Memoize overlay results
  const overlayCache = new Map<string, import('../schema/index.js').BranchOverlay>()

  return {
    default: defaultBranchGraph,
    branches,
    branchResults,
    overlay(viewingRef: string) {
      if (!overlayCache.has(viewingRef)) {
        overlayCache.set(viewingRef, computeOverlay(viewingRef, defaultBranchGraph, branches))
      }
      return overlayCache.get(viewingRef)!
    },
    diff(branchRef: string) {
      const branch = branches.find(b => b.ref === branchRef)
      if (!branch) return { added: [], modified: [], removed: [] }
      return computeDiff(branch, defaultBranchGraph)
    },
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
git add src/loader/index.ts test/multigraph.test.ts
git commit -m "feat: add loadMultiGraph with parallel branch loading and memoized overlay"
```

---

## Task 4: MCP tools — list_branches, diff_branch, branch param on existing tools

**Files:**
- Modify: `src/mcp/index.ts`
- Modify: `test/mcp.test.ts` (add basic coverage)

- [ ] **Step 1: Read the existing MCP tool handler pattern**

Read `src/mcp/index.ts` lines 1–60 to understand how tools are registered and how `loadGraph` is called:

```bash
node -e "const f = require('fs'); console.log(f.readFileSync('src/mcp/index.ts','utf-8').slice(0,2000))"
```

- [ ] **Step 2: Add `list_branches` tool**

In `src/mcp/index.ts`, add a new tool registration. Find the block where `list_nodes` is registered and add after it:

```ts
server.tool('list_branches', 'List all loaded branches and their load status', {}, async () => {
  const multi = await loadMultiGraph({ source: getSource() })
  return {
    content: [{
      type: 'text',
      text: serialize(multi.branchResults, format, compactKeys),
    }],
  }
})
```

- [ ] **Step 3: Add `diff_branch` tool**

```ts
server.tool(
  'diff_branch',
  'Diff a branch against the default branch — returns added, modified, removed nodes',
  {
    branch: z.string().describe('Branch ref to diff against default'),
    format: z.enum(['yaml', 'json', 'toon']).optional(),
  },
  async ({ branch, format: fmt }) => {
    const multi = await loadMultiGraph({ source: getSource() })
    const diff = multi.diff(branch)
    return {
      content: [{
        type: 'text',
        text: serialize({ branch, ...diff }, fmt ?? format, compactKeys),
      }],
    }
  },
)
```

- [ ] **Step 4: Add optional `branch` parameter to `list_nodes`**

Find the `list_nodes` tool handler and add an optional `branch` parameter. When provided, use `multi.overlay(branch).nodes` filtered by ghostState; when omitted, use the default branch graph as before.

```ts
server.tool(
  'list_nodes',
  'List all nodes, optionally filtered by template, state, or branch',
  {
    template: z.string().optional(),
    state: z.string().optional(),
    branch: z.string().optional().describe('View nodes from this branch perspective (includes ghost nodes)'),
  },
  async ({ template, state, branch }) => {
    if (branch) {
      const multi = await loadMultiGraph({ source: getSource() })
      const overlay = multi.overlay(branch)
      const nodes = [...overlay.nodes.values()]
        .filter(on => {
          const node = on.presence.get(branch) ?? [...on.presence.values()][0]
          if (template && node.template !== template) return false
          if (state && node.state !== state) return false
          return true
        })
        .map(on => {
          const node = on.presence.get(branch) ?? [...on.presence.values()][0]
          return { ...node, ghostState: on.ghostState, branches: [...on.presence.keys()] }
        })
      return { content: [{ type: 'text', text: serialize(nodes, format, compactKeys) }] }
    }
    // existing logic unchanged
    const graph = await loadGraph({ source: getSource() })
    const nodes = listNodes(graph, { template, state })
    return { content: [{ type: 'text', text: serialize(nodes, format, compactKeys) }] }
  },
)
```

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/mcp/index.ts
git commit -m "feat: add list_branches and diff_branch MCP tools; branch param on list_nodes"
```

---

## Task 5: Wire loadMultiGraph into web server

**Files:**
- Modify: `src/web/server.ts`

- [ ] **Step 1: Check current graph loading in web server**

Read `src/web/server.ts` to find where `loadGraph` is called and how `graph` is passed to route handlers:

```bash
node -e "const f = require('fs'); console.log(f.readFileSync('src/web/server.ts','utf-8').slice(0,3000))"
```

- [ ] **Step 2: Add multi-graph endpoint**

In `src/web/server.ts`, add an API endpoint that returns branch data:

```ts
app.get('/api/branches', async (_req, res) => {
  try {
    const multi = await loadMultiGraph({ source: getSource() })
    res.json({
      default: multi.default.ref,
      branches: multi.branches.map(b => ({ ref: b.ref, sha: b.sha, isDefault: b.isDefault })),
      results: multi.branchResults,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 3: Add overlay endpoint**

```ts
app.get('/api/overlay/:ref(*)', async (req, res) => {
  try {
    const multi = await loadMultiGraph({ source: getSource() })
    const ref = req.params.ref
    const overlay = multi.overlay(ref)
    const nodes = [...overlay.nodes.values()].map(on => ({
      id: on.id,
      ghostState: on.ghostState,
      branches: [...on.presence.keys()],
      node: on.presence.get(ref) ?? [...on.presence.values()][0],
    }))
    res.json({ viewingRef: ref, nodes })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass (web tests check existing endpoints remain functional).

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts
git commit -m "feat: add /api/branches and /api/overlay/:ref endpoints to web server"
```

---

## Stage 2 complete ✓

Run the full test suite to confirm:

```bash
npm test
```

Expected: all tests pass.

Both stages are now complete:
- **Stage 1:** Storage-agnostic loaders, `FileGraphSource`, `GitGraphSource` (read + write via git objects), `serializeGraph` returning `ContentMap`
- **Stage 2:** `loadMultiGraph`, `computeOverlay` with seven ghost states, `computeDiff`, `list_branches` / `diff_branch` MCP tools, `/api/branches` and `/api/overlay` web endpoints
