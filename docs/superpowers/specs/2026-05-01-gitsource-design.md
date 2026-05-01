# Git Source Design

**Date:** 2026-05-01  
**Status:** Approved  
**Related:** ADR-001 (Storage and Interaction Architecture), ADR-003 (Graph Loading and Runtime Representation), `docs/tasks/gitsource.md`

---

## Overview

Introduce a git-native alternative to the file-based graph loader. The system gains a swappable source abstraction — loaders become storage-agnostic, receiving a `ContentMap` of YAML content rather than calling `node:fs` directly. A `GitGraphSource` implementation reads graph files directly from git objects (blobs and trees) via isomorphic-git, without materialising a working tree. Multi-branch support loads all branches into memory and performs comparison and conflict detection as pure in-memory operations.

Delivered in two stages:
- **Stage 1:** Source abstraction + single-branch load/save via git
- **Stage 2:** Multi-branch load, in-memory comparison, ghost nodes, conflict detection

---

## Goals

- Load the graph from a git repository (local or remote) without relying on a filesystem working tree
- Support multiple branches simultaneously, with in-memory comparison and conflict detection
- Keep the loader pipeline storage-agnostic — no source-specific logic in cluster, edge, or pack loaders
- Default branch is read-only; writes target non-default branches only
- Backward-compatible: existing `FileGraphSource` behaviour is preserved

---

## Non-Goals

- SSH remote support (HTTP/HTTPS only for remote git sources in v1)
- Partial/sparse checkout of large repos
- Replacing the SQLite cache layer described in ADR-003 (out of scope here)

---

## Section 1: Source Abstraction

A new `src/source/` module owns all I/O. Everything outside this module is storage-agnostic.

### ContentMap

```ts
// Keys are paths relative to graphDir: 'components/orders/order.yaml'
// Values are raw YAML string content
type ContentMap = Map<string, string>
```

All loaders receive a `ContentMap` instead of a filesystem path. Keys are relative to the configured `graphDir`, so loaders are unaware of whether the source is a local directory, a local git repo, or a remote URL.

### GraphSource interface

```ts
interface GraphSource {
  defaultBranch(): Promise<string>
  listBranches(): Promise<string[]>
  resolveRef(ref: string): Promise<string>       // returns SHA for the ref
  loadContent(ref: string): Promise<ContentMap>   // all YAML under graphDir for this ref
  commit(branch: string, changes: ContentMap, message: string): Promise<void>
}
```

`commit()` throws `SourceError` immediately if called on the default branch — read-only is enforced at the source layer.

### SourceError

```ts
class SourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) { ... }
}
```

All source implementations wrap their internal errors (fs errors, isomorphic-git errors) into `SourceError` before throwing. The loader layer never sees library-specific error types.

---

## Section 2: Source Implementations

### FileGraphSource

```ts
interface FileGraphSourceOptions {
  graphDir?: string   // local filesystem path, default: '.corum/graph'
}
```

- `loadContent()` walks the filesystem under `graphDir` and reads all `.yaml` files into the map. Keys are relative to `graphDir`.
- `listBranches()` returns `['main']` — the file source has one implicit branch (the working tree).
- `defaultBranch()` returns `'main'`.
- `commit()` writes the changed files to `graphDir`, then creates a git commit via isomorphic-git on the local repo (requires the directory to be inside a git repo).

This is the backward-compatible source. Existing callers that pass `graphPath` are migrated to construct `new FileGraphSource({ graphDir: graphPath })`.

### GitGraphSource

```ts
interface GitGraphSourceOptions {
  graphDir?: string      // path within the repo, default: '.corum/graph'
  localPath?: string     // path to a local repo with a .git directory
  remoteUrl?: string     // HTTPS remote URL
}
```

Constructor validation:
- Neither `localPath` nor `remoteUrl` provided → throws `SourceError`
- Both `localPath` and `remoteUrl` provided → throws `SourceError`
- Exactly one provided → valid

#### Local mode (`localPath`)

- Uses the existing `.git` directory at `localPath`
- On `loadContent()`: calls `git.fetch()` to refresh remote refs, then reads files via `git.listFiles({ ref })` + `git.readBlob()` for each file matching the `graphDir` prefix
- No working tree is materialised; reads go directly to git objects

#### Remote mode (`remoteUrl`)

- Manages a persistent cache at `~/.corum/cache/<sha256(remoteUrl)>/`
- **First run:** `git.clone({ url: remoteUrl, dir: cacheDir, noCheckout: true })` — fetches all git objects, no working tree
- **Subsequent runs:** `git.fetch({ dir: cacheDir })` + compare cached HEAD SHA to new HEAD SHA; if unchanged for a ref, skip re-reading that branch's files
- All reads use the same `git.listFiles()` + `git.readBlob()` path as local mode

#### GitCacheManager

A small helper that owns `~/.corum/cache/`. Keyed by `sha256(remoteUrl)`. On startup, if the cache directory exists but `git.resolveRef()` fails (corrupt `.git`), the manager deletes the cache dir and re-clones. One automatic recovery attempt; if the re-clone also fails, surfaces as `SourceError`.

#### loadContent filtering (two-phase)

`loadContent` is a two-phase read. Packs define the schemas that cluster parsing depends on, so they are read first.

**Phase 1 — `graph.yaml` and packs:** Read `graph.yaml` from `graphDir`, extract declared `templatePacks[].path` entries, resolve each path relative to the repo root, and load all YAML files under those paths into the ContentMap under a `__packs__/` namespace. Pack paths that resolve outside the repo root are rejected with a `SourceError`. Packs are always read from the default branch ref — the `ref` parameter is ignored for this phase.

**Phase 2 — cluster and edge data:** Read all remaining files under `graphDir`, strip the prefix, populate ContentMap with graph-data keys.

This keeps reads targeted — only `graphDir` and explicitly declared pack paths are fetched, never a whole-repo sweep.

```ts
// Inside GitGraphSource.loadContent(ref):
const commitSha = await git.resolveRef({ fs, dir, ref })
const defaultSha = await git.resolveRef({ fs, dir, ref: await this.defaultBranch() })
const allFiles = await git.listFiles({ fs, dir, ref: commitSha })
const prefix = graphDir.endsWith('/') ? graphDir : graphDir + '/'

// Phase 1: graph.yaml + packs (always from default branch)
const graphYamlBlob = await git.readBlob({ fs, dir, oid: defaultSha, filepath: prefix + 'graph.yaml' })
const graphYaml = new TextDecoder().decode(graphYamlBlob.blob)
map.set('graph.yaml', graphYaml)
const packPaths = resolvePackPaths(graphYaml, graphDir)   // parses graph.yaml to get pack dirs
const defaultFiles = await git.listFiles({ fs, dir, ref: defaultSha })
for (const packPath of packPaths) {
  const packPrefix = packPath.endsWith('/') ? packPath : packPath + '/'
  for (const filePath of defaultFiles.filter(f => f.startsWith(packPrefix))) {
    const { blob } = await git.readBlob({ fs, dir, oid: defaultSha, filepath: filePath })
    map.set('__packs__/' + filePath, new TextDecoder().decode(blob))
  }
}

// Phase 2: cluster and edge data (from the requested ref)
for (const filePath of allFiles.filter(f => f.startsWith(prefix) && f !== prefix + 'graph.yaml')) {
  const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: filePath })
  map.set(filePath.slice(prefix.length), new TextDecoder().decode(blob))
}
```

ContentMap keys for graph data are relative to `graphDir` (e.g. `components/orders/order.yaml`). Pack keys use a `__packs__/` prefix followed by the repo-relative path. `loadPacks` reads from this namespace.

Files outside declared paths are never read. ContentMap key structure is identical between `FileGraphSource` and `GitGraphSource`.

#### Pack loading

Template packs are always loaded from the default branch, regardless of which branch is being parsed for clusters and edges. `loadGraph` calls `source.loadContent(await source.defaultBranch())` for pack resolution, then `source.loadContent(ref)` for clusters and edges when `ref` differs from the default branch.

---

## Section 3: Loader Changes

### LoadOptions

```ts
interface LoadOptions {
  source: GraphSource
  ref?: string          // branch or SHA to load; defaults to source.defaultBranch()
  strict?: boolean
  // Deprecated: graphPath still accepted as a shorthand that constructs FileGraphSource
  graphPath?: string
  packsPath?: string
}
```

### Loader function signatures

All loader functions that currently accept `graphPath: string` are updated to accept `ContentMap`:

```ts
// Before
loadClusters(graphPath: string, templates, diagnostics)
loadEdges(graphPath: string, nodes, diagnostics)
loadPacks(packDirs: string[], diagnostics)

// After
loadClusters(content: ContentMap, templates, diagnostics)   // reads graph-data keys
loadEdges(content: ContentMap, nodes, diagnostics)           // reads graph-data keys
loadPacks(content: ContentMap, diagnostics)                  // reads __packs__/* keys
```

### ContentMap query helpers (replacing fs-utils)

```ts
// List all yaml file paths under a given prefix within the map
function listYamlKeys(content: ContentMap, prefix: string): string[]

// Read a file; throws if not present
function readYaml(content: ContentMap, key: string): string

// Check existence
function hasKey(content: ContentMap, key: string): boolean
```

These replace `walkYamlFiles()` and `readFileSync()` calls in the loaders.

---

## Section 4: Multi-Branch Model

The primary model is **overlay**, not diff. When navigating the graph from any branch, all nodes and edges from all loaded branches are visible simultaneously. Nodes from other branches appear as ghost nodes. A diff (branch vs default) is a secondary tool for explicit comparison.

### Types

```ts
interface BranchGraph {
  ref: string
  sha: string
  isDefault: boolean
  graph: Graph
}

type BranchLoadStatus = 'loaded' | 'failed'

interface BranchLoadResult {
  ref: string
  status: BranchLoadStatus
  error?: string    // human-readable reason, present when status === 'failed'
}

// The cross-branch presence of a single node ID across all loaded branches
interface OverlayNode {
  id: string
  // Branches that contain this node, keyed by ref
  presence: Map<string, Node>
  // Derived display state (see ghost states below)
  ghostState: GhostState
}

type GhostState =
  | 'local'              // only on the viewing branch
  | 'shared'             // on viewing branch and one or more others (same properties)
  | 'default-only'       // on default branch, not on viewing branch — base reference
  | 'ghost-single'       // on exactly one other branch, not on viewing branch
  | 'ghost-consensus'    // on 2+ other branches, all with identical properties
  | 'ghost-conflict'     // on 2+ other branches with differing properties

interface OverlayEdge {
  id: string
  presence: Map<string, Edge>
  ghostState: GhostState
}

interface BranchOverlay {
  viewingRef: string                  // the branch being navigated from
  nodes: Map<string, OverlayNode>     // all node IDs across all branches
  edges: Map<string, OverlayEdge>
}

// Secondary: explicit diff of one branch against default
interface BranchDiff {
  added: Node[]       // in this branch, not in default
  modified: Node[]    // exists in both, properties differ
  removed: Node[]     // in default, not in this branch
}

interface MultiGraph {
  default: BranchGraph
  branches: BranchGraph[]             // successfully loaded branches only
  branchResults: BranchLoadResult[]   // all attempted branches including failures
  overlay(viewingRef: string): BranchOverlay
  diff(branchRef: string): BranchDiff // compare branch against default only
}
```

### Ghost state rules

Given a node ID and a viewing branch:

| Present on viewing branch | Present on other branches | Properties agree across all | GhostState |
|---|---|---|---|
| Yes | No | — | `local` |
| Yes | Yes | Yes | `shared` |
| Yes | Yes | No | `shared` (conflicts visible via `presence` map) |
| No | Default only | — | `default-only` |
| No | Exactly one other | — | `ghost-single` |
| No | 2+ others | Yes | `ghost-consensus` |
| No | 2+ others | No | `ghost-conflict` |

`ghost-conflict` is the most complex case: the same node exists on multiple branches with different property values. The UI shows it as a single ghost node with a conflict indicator; the `presence` map exposes all variants for detail views or cherry-pick.

Edges follow the same ghost state logic applied to edge IDs.

### Load behaviour

```ts
async function loadMultiGraph(options: {
  source: GraphSource
  branches?: string[]   // if omitted, loads all branches from source.listBranches()
  strict?: boolean
}): Promise<MultiGraph>
```

1. Load the default branch first. If this fails, throw — no `MultiGraph` is returned.
2. Load all non-default branches in parallel (`Promise.allSettled`).
3. For each failed branch, record a `BranchLoadResult` with `status: 'failed'`. Do not throw.
4. Construct and return `MultiGraph`.

### In-memory overlay computation

`overlay(viewingRef)` performs a full outer join across all `BranchGraph.graph.nodesById` maps:

1. Collect every node ID that appears in any loaded branch.
2. For each node ID, build an `OverlayNode` with its `presence` map (ref → Node).
3. Derive `ghostState` from the rules table above using the viewing branch as context.
4. Repeat for edges.

All operations are synchronous Map iterations — no I/O, no SQL. At realistic graph sizes (hundreds to low thousands of nodes across a handful of branches) this completes in milliseconds.

`diff(branchRef)` is a subset: compare `presence.get(branchRef)` against `presence.get(defaultRef)` for each OverlayNode.

### FileGraphSource and MultiGraph

`FileGraphSource` produces a `MultiGraph` with exactly one `BranchGraph` and `branchResults` with a single `{ ref: 'main', status: 'loaded' }` entry. `overlay('main')` returns all nodes as `local`. The structure is identical — UI and MCP tools need no special-casing per source type.

---

## Section 5: Write Path (Stage 1)

`commit(branch, changes, message)` on `GitGraphSource` writes directly to git objects — no files are ever materialised to the working tree. This is consistent with the read path, which also never touches the working tree.

isomorphic-git provides the plumbing APIs needed: `writeBlob`, `readTree`, `writeTree`, `writeCommit`, `updateRef`.

```
changes (ContentMap)
  │
  ├─ writeBlob() for each entry → blob OIDs
  │
  ├─ readTree() from current branch HEAD → existing tree structure
  │
  ├─ apply blob OIDs into tree (recursive for nested paths) → updated tree
  │
  ├─ writeTree() → new tree OID
  │
  ├─ writeCommit(tree, parent: currentHead, message) → new commit OID
  │
  ├─ updateRef(branchRef → new commit OID)
  │
  └─ push() → remote (remote mode only)
```

The only filesystem involvement is isomorphic-git writing the new objects into `.git/objects/` — the standard git object store. No YAML files are written to any working directory.

Building the updated tree requires recursion for nested paths (e.g. updating `components/orders/order.yaml` means rebuilding the `components/orders/` tree, then `components/`, then the root tree). This is handled by a `buildUpdatedTree` helper internal to `GitGraphSource`.

The default branch is read-only — `commit()` throws `SourceError` if `branch === await this.defaultBranch()`.

For `FileGraphSource.commit()`, files are written to `graphDir` on disk then committed via isomorphic-git — the filesystem is the source of truth for the file source, so this is correct and expected.

The existing `graph-writer.ts` serialisation logic (YAML stringification, cluster file structure, edge files) is unchanged — it produces a `ContentMap` of path → YAML string, which is passed directly to `source.commit()`.

---

## Section 6: Error Handling

| Scenario | Behaviour |
|---|---|
| Default branch fails to load | Throw `SourceError` — no graph returned |
| Non-default branch fails to load | Skip branch, record `BranchLoadResult { status: 'failed', error }` |
| Both `localPath` and `remoteUrl` provided | Throw `SourceError` at construction |
| Neither `localPath` nor `remoteUrl` provided | Throw `SourceError` at construction |
| `commit()` called on default branch | Throw `SourceError` |
| Remote cache corrupt | Delete cache dir, re-clone once; if re-clone fails, throw `SourceError` |
| File missing from ContentMap during parse | Recorded as `Diagnostic` with `severity: 'error'`; propagates via existing loader diagnostic system |

`branchResults` is always populated for all attempted branches. MCP `list_branches` tool returns this array. The UI branch switcher shows a status indicator for branches with `status: 'failed'`.

---

## Section 7: MCP and UI Exposure

### New MCP tool: `list_branches`

Returns `MultiGraph.branchResults` — ref, load status, and error message for all attempted branches. Agents can inspect which branches are available and which failed.

### Updated MCP tools

`list_nodes`, `get_cluster`, `get_linked_fields` gain an optional `branch` parameter. When provided, the tool returns the overlay from that branch's perspective — nodes include a `ghostState` field and a `branches` list showing which refs contain that node. When omitted, queries the default branch only (no overlay).

A new `diff_branch` tool takes a `branch` parameter and returns the `BranchDiff` against default — useful for agents doing explicit before/after comparison.

### UI

The branch switcher reads from `MultiGraph.branches` for the selector and `MultiGraph.branchResults` for status indicators. A branch with `status: 'failed'` is shown but marked unavailable with its error as a tooltip.

When a branch is selected, the graph view calls `overlay(selectedRef)` and renders:
- `local` / `shared` nodes — full opacity, normal interaction
- `default-only` nodes — visible at reduced opacity, labelled as base
- `ghost-single` / `ghost-consensus` nodes — ghost styling with branch badge
- `ghost-conflict` nodes — ghost styling with conflict indicator; detail panel shows all variants side-by-side

---

## Section 8: Testing

- **Unit tests for loaders:** Construct a `ContentMap` inline. No source, no filesystem, no git. Loaders stay synchronous — tests remain fast.
- **Unit tests for `FileGraphSource`:** Operate against a temp directory with fixture YAML files.
- **Unit tests for `GitGraphSource`:** Use a local fixture repo at `test/fixtures/git-repo/` — a real `.git` directory committed to the test suite. No mocking of isomorphic-git. Multiple branches set up using isomorphic-git in the test fixture setup script.
- **Integration tests for remote mode:** Use a `file://` URL pointing at the fixture repo. isomorphic-git supports `file://` remotes. No network in CI.
- **Multi-branch tests:** Fixture repo has `main`, `feat/branch-a`, and `feat/branch-b` with known node differences. Tests assert specific `OverlayNode` ghost states — covering `ghost-single`, `ghost-consensus`, and `ghost-conflict` cases. `diff()` tests assert `added`, `modified`, `removed` counts against expected values.

---

## File Layout

```
src/
  source/
    index.ts            ← GraphSource interface, ContentMap type, SourceError
    file-source.ts      ← FileGraphSource
    git-source.ts       ← GitGraphSource
    git-cache.ts        ← GitCacheManager (~/.corum/cache/)
    content-utils.ts    ← listYamlKeys, readYaml, hasKey helpers
  loader/
    index.ts            ← updated loadGraph + new loadMultiGraph
    cluster-loader.ts   ← ContentMap-based (was graphPath + fs)
    edge-loader.ts      ← ContentMap-based
    pack-loader.ts      ← ContentMap-based
    fs-utils.ts         ← retained for FileGraphSource only
  schema/
    index.ts            ← add BranchGraph, MultiGraph, BranchDiff, NodeConflict,
                           BranchLoadResult, SourceError
```

---

## Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| Git library | isomorphic-git | Purpose-built object-level API; reads blobs/trees without checkout; higher stars than simple-git; in-process (no child process per file) |
| Remote caching | Persistent `~/.corum/cache/` with `noCheckout: true` | Fast subsequent starts via fetch + SHA comparison; aligns with ADR-001 incremental cache model |
| ContentMap scope | Files within `graphDir` only | Prevents stray YAML from wider repo leaking into the graph |
| ContentMap keys | Relative to `graphDir` | Consistent between FileGraphSource and GitGraphSource; loaders unaware of source type |
| Pack source | Always default branch | Pack definitions are structural schema; branch-specific pack changes are not resolvable |
| Multi-branch comparison | In-memory Map operations | No SQL, no I/O; clean for graph sizes realistic in v1 |
| Default branch writes | Forbidden (SourceError) | Default branch is the stable reference; all changes go via non-default branches and PR |
| Both localPath + remoteUrl | Throw SourceError | Ambiguous configuration should be explicit, not silently resolved |
