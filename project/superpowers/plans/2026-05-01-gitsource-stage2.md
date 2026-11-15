# Git Source Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Prerequisite:** Stage 1 plan must be complete — all loaders ContentMap-based, `GitGraphSource` operational, all tests passing.

**Goal:** Add multi-branch support — load all branches into memory, compute an overlay view with ghost states for cross-branch node visibility, and expose branches via MCP tools and a web JSON API (frontend UI deferred to Stage 3).

**Architecture:** `loadMultiGraph` loads all requested/listed branches in parallel using the existing `GraphSource.loadGraphContent`. A `MultiGraph` holds one `BranchGraph` per loaded branch. `overlay(viewingRef)` computes a full outer join across all loaded branch node maps and assigns a `GhostState` to every node ID from the selected branch perspective. `diff(ref)` compares one selected branch against the default branch. New MCP tools `list_branches` and `diff_branch` expose the data; existing tools gain an optional `branch` parameter. Web endpoints `/api/branches` and `/api/overlay/:ref` surface the data as JSON.

**Tech Stack:** TypeScript, Node.js built-in test runner, existing isomorphic-git setup from Stage 1.

**Key decisions:**
- **MCP pattern:** No SDK upgrade. Extend existing `createMcpHandlers(graph)` + `setRequestHandler` switch pattern — do not use `server.tool()`.
- **sha:** Optional on `BranchGraph` — `GraphSource` has no commit-resolve API yet.
- **Fixture tests:** Use `strict: false` — fixture repos have no template packs loaded.
- **Ghost-state semantics:** Overlay is multi-branch, not pairwise. `loadMultiGraph` loads all requested/listed branches into memory; `overlay(viewingRef)` compares every node across all loaded branches and classifies visibility from the chosen viewing branch. "Other branches" means all loaded branches except the viewing branch, including default. `nodesEqual` compares `properties`, `state`, `stability` only.
- **Diff semantics:** `diff_branch` / `MultiGraph.diff(ref)` is intentionally pairwise for Stage 2: selected branch vs default branch only.
- **Branch-not-found:** `overlay(viewingRef)` and `diff(branchRef)` throw `QueryError` for unknown refs; MCP and web surface these as error responses.
- **Per-request reload:** Acceptable Stage 2 tradeoff — overlay memoization is per-MultiGraph instance; future caching is a Stage 3 concern.
- **Web UI:** Frontend branch selector / ghost rendering deferred to Stage 3. Stage 2 adds JSON API only.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/schema/index.ts` | Add `BranchGraph`, `BranchLoadResult`, `BranchLoadStatus`, `BranchDiff`, `GhostState`, `OverlayNode`, `OverlayEdge`, `BranchOverlay`, `MultiGraph`, `MultiLoadOptions` |
| Modify | `src/loader/index.ts` | Add `loadMultiGraph` |
| Create | `src/graph/overlay.ts` | `computeOverlay`, `computeDiff` — pure in-memory graph operations |
| Modify | `src/mcp/index.ts` | Extend `createMcpHandlers(graph, source?)` with async branch handlers; add `list_branches`, `diff_branch` to list + switch; add `branch` param to `list_nodes`, `get_cluster`, `get_linked_fields` |
| Modify | `src/web/server.ts` | Add `source?: GraphSource` to `WebServerOptions`; wire into `createApp`; add `/api/branches` and `/api/overlay/:ref` endpoints |
| Create | `test/multigraph.test.ts` | Tests for `loadMultiGraph`, overlay, diff |
| Modify | `package.json` | Change test script to glob pattern |

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

- [ ] **Step 2: Change test script in package.json to glob pattern**

Replace the explicit file list with a glob so future test files are auto-discovered:

```json
"test": "tsc && node --test dist/test/*.test.js"
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `GhostState` not exported from schema.

- [ ] **Step 4: Add types to `src/schema/index.ts`**

Append to the existing file. `GraphSource` is already imported at the top of `src/schema/index.ts` via `import type { ContentMap, GraphSource } from '../source/index.js'`, so do not add a duplicate import:

```ts
export type GhostState =
  | 'local'           // node exists only on the viewing branch
  | 'local-modified'  // node exists on viewing branch and others, but properties differ
  | 'shared'          // node exists on viewing branch and others with identical properties
  | 'default-only'    // node exists only on the default branch
  | 'ghost-single'    // node exists on exactly one other branch, not on viewing
  | 'ghost-consensus' // node exists on 2+ other branches with identical properties
  | 'ghost-conflict'  // node exists on 2+ other branches with differing properties

export interface BranchGraph {
  ref: string
  sha?: string  // not populated in Stage 2 — GraphSource has no commit-resolve API yet
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
  presence: Map<string, Node>  // ref → Node (all branches that have this node)
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
  branches: BranchGraph[]          // includes default branch
  branchResults: BranchLoadResult[]
  overlay(viewingRef: string): BranchOverlay   // throws QueryError for unknown ref
  diff(branchRef: string): BranchDiff          // throws QueryError for unknown ref
}

export interface MultiLoadOptions {
  source: GraphSource
  branches?: string[]  // if omitted, uses source.listBranches()
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

**Ghost-state rules (canonical reference):**

A node's `ghostState` is derived from its presence map (all loaded branches that carry this node, keyed by ref). This is a many-branch overlay: the viewing branch is a perspective, and every other loaded branch contributes to classification.

- Node IS on viewing branch:
  - Only on viewing branch → `local`
  - Also on others, all with same `properties`/`state`/`stability` → `shared`
  - Also on others, at least one differs → `local-modified`
- Node is NOT on viewing branch:
  - Only on default branch → `default-only`
  - On exactly one non-default branch, and not on default → `ghost-single`
  - On 2+ other branches, all with same `properties`/`state`/`stability` → `ghost-consensus`
  - On 2+ other branches, at least one differs → `ghost-conflict`

"Other branches" means all branches in the presence map except the viewing branch. Default branch participates in consensus/conflict when there are multiple non-viewing presences, but a single default-only presence keeps the special `default-only` state.

`nodesEqual` compares `properties`, `state`, and `stability` only (not `template`, `component`, `schemaVersion`, `lastModifiedAt`).

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

  const defaultBranch = { ref: 'main', isDefault: true, graph: makeGraph([nodeA, nodeB]) }
  const branchFeat = { ref: 'feat/x', isDefault: false, graph: makeGraph([nodeB, nodeC]) }
  const branchFeat2 = { ref: 'feat/y', isDefault: false, graph: makeGraph([nodeBModified, nodeC]) }

  it('local: node only on viewing branch', () => {
    const overlay = computeOverlay('feat/x', defaultBranch, [branchFeat])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'local')
  })

  it('default-only: node on default but not viewing branch or any other', () => {
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
    const branchViewing = { ref: 'feat/z', isDefault: false, graph: makeGraph([nodeBModified]) }
    const overlay = computeOverlay('feat/z', defaultBranch, [branchViewing, branchFeat])
    const nodeB_overlay = overlay.nodes.get('test.DomainModel.b')
    assert.ok(nodeB_overlay)
    assert.equal(nodeB_overlay.ghostState, 'local-modified')
  })

  it('ghost-single: node on exactly one other branch, not on viewing branch', () => {
    // feat/v has only nodeA; nodeC is only on feat/x (one other branch, not default)
    const branchViewing = { ref: 'feat/v', isDefault: false, graph: makeGraph([nodeA]) }
    const overlay = computeOverlay('feat/v', defaultBranch, [branchViewing, branchFeat])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'ghost-single')
  })

  it('ghost-consensus: node on 2+ other branches with same properties', () => {
    // feat/v has only nodeA; nodeC is on feat/x and feat/same with same properties
    const branchViewing = { ref: 'feat/v', isDefault: false, graph: makeGraph([nodeA]) }
    const branchFeatSame = { ref: 'feat/same', isDefault: false, graph: makeGraph([nodeC]) }
    const overlay = computeOverlay('feat/v', defaultBranch, [branchViewing, branchFeat, branchFeatSame])
    const nodeC_overlay = overlay.nodes.get('test.DomainModel.c')
    assert.ok(nodeC_overlay)
    assert.equal(nodeC_overlay.ghostState, 'ghost-consensus')
  })

  it('ghost-conflict: node on 2+ other branches with different properties', () => {
    // feat/v has only nodeA; nodeB is on main+feat/x (same) and feat/y (modified) = conflict
    const branchViewing = { ref: 'feat/v', isDefault: false, graph: makeGraph([nodeA]) }
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

  it('throws QueryError for unknown viewingRef', () => {
    assert.throws(
      () => computeOverlay('feat/nonexistent', defaultBranch, [branchFeat]),
      (err: unknown) => err instanceof Error && err.message.includes('feat/nonexistent'),
    )
  })
})

describe('computeDiff', () => {
  const nodeA = makeNode('test.DomainModel.a')
  const nodeB = makeNode('test.DomainModel.b')
  const nodeBMod = makeNode('test.DomainModel.b', { properties: { v: 2 } })
  const nodeC = makeNode('test.DomainModel.c')

  const defaultBranch = { ref: 'main', isDefault: true, graph: makeGraph([nodeA, nodeB]) }
  const branchFeat = { ref: 'feat/x', isDefault: false, graph: makeGraph([nodeBMod, nodeC]) }

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
import { QueryError } from '../schema/index.js'
import type { Node, Edge } from '../schema/index.js'

export function computeOverlay(
  viewingRef: string,
  defaultBranch: BranchGraph,
  allBranches: BranchGraph[],
): BranchOverlay {
  const viewingBranch = allBranches.find(b => b.ref === viewingRef)
  if (!viewingBranch) {
    throw new QueryError(`branch '${viewingRef}' not found in loaded branches`)
  }

  // Collect all node IDs across default + all non-default branches
  const allNodeIds = new Set<string>()
  for (const branch of allBranches) {
    for (const id of branch.graph.nodesById.keys()) allNodeIds.add(id)
  }
  for (const id of defaultBranch.graph.nodesById.keys()) allNodeIds.add(id)

  const nodes = new Map<string, OverlayNode>()
  for (const id of allNodeIds) {
    const presence = new Map<string, Node>()
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
      ghostState: deriveNodeGhostState(viewingRef, defaultBranch.ref, presence),
    })
  }

  // Collect all edge IDs
  const allEdgeIds = new Set<string>()
  const collectEdges = (branch: BranchGraph) => {
    for (const edges of branch.graph.edgesByFrom.values()) {
      for (const e of edges) allEdgeIds.add(e.id)
    }
  }
  allBranches.forEach(collectEdges)
  collectEdges(defaultBranch)

  const edges = new Map<string, OverlayEdge>()
  for (const id of allEdgeIds) {
    const presence = new Map<string, Edge>()
    for (const branch of [...allBranches, defaultBranch]) {
      for (const edgeList of branch.graph.edgesByFrom.values()) {
        const edge = edgeList.find(e => e.id === id)
        if (edge && !presence.has(branch.ref)) presence.set(branch.ref, edge)
      }
    }
    edges.set(id, {
      id,
      presence,
      ghostState: deriveEdgeGhostState(viewingRef, defaultBranch.ref, presence),
    })
  }

  return { viewingRef, nodes, edges }
}

function nodesEqual(a: Node, b: Node): boolean {
  return JSON.stringify(a.properties) === JSON.stringify(b.properties) &&
    a.state === b.state &&
    a.stability === b.stability
}

function edgesEqual(a: Edge, b: Edge): boolean {
  return a.type === b.type && a.state === b.state && a.stability === b.stability && a.notes === b.notes
}

function deriveNodeGhostState(
  viewingRef: string,
  defaultRef: string,
  presence: Map<string, Node>,
): GhostState {
  const onViewing = presence.has(viewingRef)
  const others = [...presence.entries()].filter(([ref]) => ref !== viewingRef)

  if (onViewing) {
    if (others.length === 0) return 'local'
    const viewingNode = presence.get(viewingRef)!
    return others.every(([, n]) => nodesEqual(viewingNode, n)) ? 'shared' : 'local-modified'
  }

  // Not on viewing branch — classify by presence on other branches
  if (others.length === 0) return 'ghost-single'  // shouldn't happen but safe fallback
  if (others.length === 1) {
    return others[0][0] === defaultRef ? 'default-only' : 'ghost-single'
  }

  // 2+ other branches
  const nonDefaultOthers = others.filter(([ref]) => ref !== defaultRef)
  if (nonDefaultOthers.length === 0) return 'default-only'  // only default has it

  const allPresence = [...presence.values()]
  const first = allPresence[0]
  return allPresence.every(n => nodesEqual(first, n)) ? 'ghost-consensus' : 'ghost-conflict'
}

function deriveEdgeGhostState(
  viewingRef: string,
  defaultRef: string,
  presence: Map<string, Edge>,
): GhostState {
  const onViewing = presence.has(viewingRef)
  const others = [...presence.entries()].filter(([ref]) => ref !== viewingRef)

  if (onViewing) {
    if (others.length === 0) return 'local'
    const viewingEdge = presence.get(viewingRef)!
    return others.every(([, e]) => edgesEqual(viewingEdge, e)) ? 'shared' : 'local-modified'
  }

  if (others.length === 0) return 'ghost-single'
  if (others.length === 1) {
    return others[0][0] === defaultRef ? 'default-only' : 'ghost-single'
  }

  const nonDefaultOthers = others.filter(([ref]) => ref !== defaultRef)
  if (nonDefaultOthers.length === 0) return 'default-only'

  const allPresence = [...presence.values()]
  const first = allPresence[0]
  return allPresence.every(e => edgesEqual(first, e)) ? 'ghost-consensus' : 'ghost-conflict'
}

export function computeDiff(branch: BranchGraph, defaultBranch: BranchGraph): BranchDiff {
  const added: Node[] = []
  const modified: Node[] = []
  const removed: Node[] = []

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
import { QueryError } from '../src/schema/index.js'

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
    assert.ok(states.size === 1 && states.has('local'), 'all nodes should be local when only one branch')
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

  it('overlay throws QueryError for unknown ref', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    assert.throws(
      () => multi.overlay('feat/nonexistent'),
      (err: unknown) => err instanceof QueryError,
    )
  })

  it('diff throws QueryError for unknown ref', async () => {
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const multi = await loadMultiGraph({ source })
    assert.throws(
      () => multi.diff('feat/nonexistent'),
      (err: unknown) => err instanceof QueryError,
    )
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

      // strict: false because fixture has no template packs loaded
      const source = new GitGraphSource({ localPath: tmpDir })
      const multi = await loadMultiGraph({ source, strict: false })

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
import { QueryError } from '../schema/index.js'
import { computeOverlay, computeDiff } from '../graph/overlay.js'

export async function loadMultiGraph(options: MultiLoadOptions): Promise<MultiGraph> {
  const { source, strict = true } = options

  const defaultRef = await source.defaultBranch()

  // Load default branch — throw if it fails
  let defaultBranchGraph: BranchGraph
  try {
    const graph = await loadGraph({ source, ref: defaultRef, strict })
    defaultBranchGraph = { ref: defaultRef, isDefault: true, graph }
  } catch (err) {
    const { SourceError } = await import('../source/index.js')
    throw new SourceError(`failed to load default branch '${defaultRef}'`, err)
  }

  // Determine which branches to load
  const requestedBranches = options.branches ?? await source.listBranches()
  const nonDefaultBranches = requestedBranches.filter(b => b !== defaultRef)

  // Load non-default branches in parallel
  const results = await Promise.allSettled(
    nonDefaultBranches.map(async (ref): Promise<BranchGraph> => {
      const graph = await loadGraph({ source, ref, strict })
      return { ref, isDefault: false, graph }
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

  // Memoize overlay results (per-MultiGraph instance)
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
      if (!branch) throw new QueryError(`branch '${branchRef}' not found or failed to load`)
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

## Task 4: MCP tools — list_branches, diff_branch, branch param on list_nodes / get_cluster / get_linked_fields

**Files:**
- Modify: `src/mcp/index.ts`
- Modify: `test/mcp.test.ts`

**Approach:** Extend `createMcpHandlers(graph, source?)` with an optional `GraphSource`. Branch-aware tools are async and guard with `if (!source)`. The existing synchronous handlers are unchanged. Update `ListToolsRequestSchema` handler and the `CallToolRequestSchema` switch to include new tools and `await` all returns.

**Do not use `server.tool()`.** Follow the existing `setRequestHandler` pattern.

- [ ] **Step 1: Read current handler structure**

Read `src/mcp/index.ts` fully to understand `createMcpHandlers`, `ListToolsRequestSchema`, `CallToolRequestSchema`, and `formatResult` helpers before editing.

- [ ] **Step 2: Extend `createMcpHandlers` signature and add branch-aware handlers**

Update `createMcpHandlers` in `src/mcp/index.ts`:

```ts
// Add to imports at top:
import type { GraphSource } from '../source/index.js'
import { loadMultiGraph } from '../loader/index.js'

// Change signature:
export function createMcpHandlers(
  graph: Graph,
  source?: GraphSource,
): {
  list_nodes: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>
  list_templates: (args: Record<string, unknown>) => ToolResult
  get_template: (args: Record<string, unknown>) => ToolResult
  get_cluster: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>
  get_linked_fields: (args: Record<string, unknown>) => ToolResult | Promise<ToolResult>
  list_branches: (args: Record<string, unknown>) => Promise<ToolResult>
  diff_branch: (args: Record<string, unknown>) => Promise<ToolResult>
}
```

Update `list_nodes` to handle the optional `branch` param:

```ts
list_nodes(args) {
  if (typeof args.branch === 'string') {
    if (!source) return Promise.resolve(errorResult(new QueryError('branch param requires a configured source')))
    return (async () => {
      try {
        const multi = await loadMultiGraph({ source })
        const branchGraph = multi.branches.find(b => b.ref === args.branch)
        if (!branchGraph) return errorResult(new QueryError(`branch '${args.branch}' not found`))
        const filter: ListNodesFilter = {
          template: typeof args.template === 'string' ? args.template : undefined,
          component: typeof args.component === 'string' ? args.component : undefined,
          state: typeof args.state === 'string' ? args.state as ListNodesFilter['state'] : undefined,
          stability: typeof args.stability === 'string' ? args.stability as ListNodesFilter['stability'] : undefined,
        }
        const nodes = listNodes(branchGraph.graph, filter).map(node => ({
          id: node.id, template: node.template, component: node.component,
          state: node.state, stability: node.stability,
        }))
        return formatResult(nodes, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    })()
  }
  // existing synchronous logic unchanged
  try {
    const filter: ListNodesFilter = {
      template: typeof args.template === 'string' ? args.template : undefined,
      component: typeof args.component === 'string' ? args.component : undefined,
      state: typeof args.state === 'string' ? args.state as ListNodesFilter['state'] : undefined,
      stability: typeof args.stability === 'string' ? args.stability as ListNodesFilter['stability'] : undefined,
    }
    const summaries = listNodes(graph, filter).map(node => ({
      id: node.id,
      template: node.template,
      component: node.component,
      state: node.state,
      stability: node.stability,
    }))
    return formatResult(summaries, args.format, getCompactKeys(args))
  } catch (err) {
    return errorResult(err)
  }
},
```

Add `get_cluster` branch support — use the branch's `Graph` directly with the existing `getCluster` function:

```ts
get_cluster(args) {
  if (typeof args.branch === 'string') {
    if (!source) return Promise.resolve(errorResult(new QueryError('branch param requires a configured source')))
    return (async () => {
      try {
        const multi = await loadMultiGraph({ source })
        const branchGraph = multi.branches.find(b => b.ref === args.branch)
        if (!branchGraph) return errorResult(new QueryError(`branch '${args.branch}' not found`))
        const nodeId = typeof args.node_id === 'string' ? args.node_id : ''
        const result = getCluster(branchGraph.graph, nodeId)
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    })()
  }
  // existing synchronous logic unchanged
  try {
    const nodeId = typeof args.node_id === 'string' ? args.node_id : ''
    const result = getCluster(graph, nodeId)
    return formatResult(result, args.format, getCompactKeys(args))
  } catch (err) {
    return errorResult(err)
  }
},
```

Add `get_linked_fields` branch support — same pattern:

```ts
get_linked_fields(args) {
  if (typeof args.branch === 'string') {
    if (!source) return Promise.resolve(errorResult(new QueryError('branch param requires a configured source')))
    return (async () => {
      try {
        const multi = await loadMultiGraph({ source })
        const branchGraph = multi.branches.find(b => b.ref === args.branch)
        if (!branchGraph) return errorResult(new QueryError(`branch '${args.branch}' not found`))
        const nodeId = typeof args.node_id === 'string' ? args.node_id : ''
        const result = getLinkedFields(branchGraph.graph, nodeId)
        return formatResult(result, args.format, getCompactKeys(args))
      } catch (err) {
        return errorResult(err)
      }
    })()
  }
  // existing synchronous logic unchanged
  try {
    const nodeId = typeof args.node_id === 'string' ? args.node_id : ''
    const result = getLinkedFields(graph, nodeId)
    return formatResult(result, args.format, getCompactKeys(args))
  } catch (err) {
    return errorResult(err)
  }
},
```

Add new `list_branches` and `diff_branch` handlers:

```ts
async list_branches(args) {
  if (!source) return errorResult(new QueryError('multi-branch not available: no source configured'))
  try {
    const multi = await loadMultiGraph({ source })
    return formatResult(multi.branchResults, args.format, getCompactKeys(args))
  } catch (err) {
    return errorResult(err)
  }
},

async diff_branch(args) {
  if (!source) return errorResult(new QueryError('multi-branch not available: no source configured'))
  const branch = args.branch
  if (typeof branch !== 'string') return errorResult(new QueryError('branch is required'))
  try {
    const multi = await loadMultiGraph({ source })
    const diff = multi.diff(branch)  // throws QueryError for unknown branch
    return formatResult({ branch, ...diff }, args.format, getCompactKeys(args))
  } catch (err) {
    return errorResult(err)
  }
},
```

- [ ] **Step 3: Update `ListToolsRequestSchema` handler**

Add `branch` to `list_nodes`, `get_cluster`, `get_linked_fields` input schemas:

```ts
// In list_nodes inputSchema properties, add:
branch: { type: 'string', description: 'Filter to this branch ref' },
```

Add `list_branches` tool entry:

```ts
{
  name: 'list_branches',
  description: 'List all loaded branches and their load status.',
  inputSchema: {
    type: 'object',
    properties: {
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

Add `diff_branch` tool entry:

```ts
{
  name: 'diff_branch',
  description: 'Diff a branch against the default branch — returns added, modified, removed nodes.',
  inputSchema: {
    type: 'object',
    required: ['branch'],
    properties: {
      branch: { type: 'string', description: 'Branch ref to diff against default' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

- [ ] **Step 4: Update `CallToolRequestSchema` switch**

Change all `return handlers.X(args)` to `return await handlers.X(args)` (safe for both sync and async returns). Add new cases:

```ts
case 'list_branches':
  return await handlers.list_branches(args)
case 'diff_branch':
  return await handlers.diff_branch(args)
```

- [ ] **Step 5: Pass `config.source` to `createMcpHandlers` in the entrypoint**

```ts
const handlers = createMcpHandlers(graph, config.source)
```

- [ ] **Step 6: Add basic MCP tests**

In `test/mcp.test.ts`, add tests that call `handlers.list_branches({})` and `handlers.diff_branch({ branch: 'main' })` with a source-less handler (should return `isError: true`) to confirm graceful degradation:

```ts
it('list_branches without source returns error', async () => {
  const handlers = createMcpHandlers(graph)
  const result = await handlers.list_branches({})
  assert.equal(result.isError, true)
})

it('diff_branch without source returns error', async () => {
  const handlers = createMcpHandlers(graph)
  const result = await handlers.diff_branch({ branch: 'main' })
  assert.equal(result.isError, true)
})
```

- [ ] **Step 7: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/mcp/index.ts test/mcp.test.ts
git commit -m "feat: add list_branches and diff_branch MCP tools; branch param on list_nodes, get_cluster, get_linked_fields"
```

---

## Task 5: Wire loadMultiGraph into web server

**Files:**
- Modify: `src/web/server.ts`
- Modify: `src/mcp/index.ts`
- Modify: `test/web.test.ts`

**Approach:** Add `source?: GraphSource` to `WebServerOptions`. Pass it into `createApp`. Add `/api/branches` and `/api/overlay/:ref` endpoints that use `loadMultiGraph` when source is available — gracefully return 501 when not. Existing tests pass a Graph directly without source and remain unaffected.

**Frontend:** Rendering ghost states and a branch selector in `web/app.jsx` is deferred to Stage 3.

- [ ] **Step 1: Read current `WebServerOptions` type and `createApp` signature**

Read `src/web/server.ts` to confirm the `WebServerOptions` interface and `createApp(graph, reloadEvents)` signature before editing.

- [ ] **Step 2: Add `source` to `WebServerOptions` and update `createApp`**

In `src/web/server.ts`:

```ts
// Add to imports:
import type { GraphSource } from '../source/index.js'
import { loadMultiGraph } from '../loader/index.js'

// Add to WebServerOptions interface:
source?: GraphSource

// Update createApp signature:
export function createApp(
  graph: Graph,
  reloadEvents: ReloadEvents = createReloadEvents(),
  source?: GraphSource,
): express.Application {
```

- [ ] **Step 3: Add `/api/branches` endpoint**

Inside `createApp`, before the `return app` line:

```ts
app.get('/api/branches', async (_req, res) => {
  if (!source) { res.status(501).json({ error: 'multi-branch requires a configured source' }); return }
  try {
    const multi = await loadMultiGraph({ source })
    res.json({
      default: multi.default.ref,
      branches: multi.branches.map(b => ({ ref: b.ref, isDefault: b.isDefault })),
      results: multi.branchResults,
    })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 4: Add `/api/overlay/:ref` endpoint**

```ts
app.get('/api/overlay/:ref(*)', async (req, res) => {
  if (!source) { res.status(501).json({ error: 'multi-branch requires a configured source' }); return }
  try {
    const multi = await loadMultiGraph({ source })
    const ref = req.params.ref
    const overlay = multi.overlay(ref)  // throws QueryError for unknown ref
    const nodes = [...overlay.nodes.values()].map(on => ({
      id: on.id,
      ghostState: on.ghostState,
      branches: [...on.presence.keys()],
      node: on.presence.get(ref) ?? [...on.presence.values()][0],
    }))
    res.json({ viewingRef: ref, nodes })
  } catch (err) {
    res.status(400).json({ error: String(err) })
  }
})
```

- [ ] **Step 5: Pass source through `startWebServer`**

In `startWebServer`, pass `options.source` to `createApp`:

```ts
const app = createApp(graph, reloadEvents, options.source)
```

- [ ] **Step 6: Pass source in MCP entrypoint's web server call**

In `src/mcp/index.ts` entrypoint, update the `startWebServer` call:

```ts
await startWebServer(graph, {
  graphPath: config.graphPath,
  fileWatcher: config.fileWatcherGraphPath && watchFiles ? true : undefined,
  source: config.source,
})
```

- [ ] **Step 7: Add web endpoint tests**

In `test/web.test.ts`, add this import near the existing imports:

```ts
import { FileGraphSource } from '../src/source/file-source.js'
```

Add these tests inside the existing `describe('web server', () => { ... })` block:

```ts
describe('multi-branch API', () => {
  it('GET /api/branches returns 501 when no source is configured', async () => {
    const res = await fetch(`http://localhost:${handle.port}/api/branches`)
    assert.equal(res.status, 501)
    const body = await res.json() as { error: string }
    assert.match(body.error, /multi-branch requires a configured source/)
  })

  it('GET /api/branches returns branch metadata when source is configured', async () => {
    const fixtureGraphDir = path.join(process.cwd(), 'fixtures/sample-graph')
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graph = await loadGraph({ source })
    const sourceHandle = await startWebServer(graph, {
      port: 0,
      source,
      logger: () => {},
    })
    try {
      const res = await fetch(`http://localhost:${sourceHandle.port}/api/branches`)
      assert.equal(res.status, 200)
      const body = await res.json() as {
        default: string
        branches: Array<{ ref: string; isDefault: boolean }>
        results: Array<{ ref: string; status: string }>
      }
      assert.equal(body.branches.length, 1)
      assert.equal(body.branches[0].ref, body.default)
      assert.equal(body.branches[0].isDefault, true)
      assert.equal(body.results[0].status, 'loaded')
    } finally {
      await sourceHandle.close()
    }
  })

  it('GET /api/overlay/:ref returns overlay nodes when source is configured', async () => {
    const fixtureGraphDir = path.join(process.cwd(), 'fixtures/sample-graph')
    const source = new FileGraphSource({ graphDir: fixtureGraphDir })
    const graph = await loadGraph({ source })
    const sourceHandle = await startWebServer(graph, {
      port: 0,
      source,
      logger: () => {},
    })
    try {
      const ref = await source.defaultBranch()
      const res = await fetch(`http://localhost:${sourceHandle.port}/api/overlay/${encodeURIComponent(ref)}`)
      assert.equal(res.status, 200)
      const body = await res.json() as { viewingRef: string; nodes: Array<{ id: string; ghostState: string }> }
      assert.equal(body.viewingRef, ref)
      assert.ok(body.nodes.length > 0)
      assert.ok(body.nodes.every(node => node.ghostState === 'local'))
    } finally {
      await sourceHandle.close()
    }
  })
})
```

- [ ] **Step 8: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/web/server.ts src/mcp/index.ts test/web.test.ts
git commit -m "feat: add /api/branches and /api/overlay/:ref endpoints; wire source through web server"
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
- **Stage 2:** `loadMultiGraph`, `computeOverlay` with seven ghost states, `computeDiff`, `list_branches` / `diff_branch` MCP tools, `branch` param on three existing tools, `/api/branches` and `/api/overlay` web endpoints
- **Stage 3 (future):** Frontend branch selector, ghost node rendering in web UI, per-request multi-graph caching, `GraphSource.resolveBranchSha()` for accurate commit SHAs
