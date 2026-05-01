# Git Source Design

**Date:** 2026-05-01  
**Status:** Approved  
**Related:** ADR-001 (Storage and Interaction Architecture), ADR-003 (Graph Loading and Runtime Representation), `docs/tasks/gitsource.md`

---

## Overview

Introduce a git-native alternative to the file-based graph loader. The system gains a swappable source abstraction — loaders become storage-agnostic, receiving a `ContentMap` of YAML content rather than calling `node:fs` directly. A `GitGraphSource` implementation reads graph files directly from git objects (blobs and trees) via isomorphic-git, without materialising a working tree. Multi-branch support loads all branches into memory and performs comparison and conflict detection as pure in-memory operations.

Delivered in two stages:
- **Stage 1:** Source abstraction + single-branch load/save via git
- **Stage 2:** Multi-branch load, in-memory overlay, ghost nodes, conflict detection

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
  loadPackContent(ref: string): Promise<ContentMap>   // packs only, always from default branch
  loadGraphContent(ref: string): Promise<ContentMap>  // clusters and edges for a given ref
  commit(branch: string, changes: ContentMap, message: string): Promise<void>
}
```

Two explicit load methods replace the previous single `loadContent` with its mixed `__packs__/` namespace:
- `loadPackContent` is always called with the default branch ref — packs define schemas and are never branch-specific
- `loadGraphContent` is called with whichever ref is being loaded

`commit()` throws `SourceError` immediately if called on the default branch — read-only is enforced at the source layer.

`resolveRef` is removed from the interface — SHA-based cache invalidation is a `GitGraphSource` implementation detail, not a concern of the abstraction.

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
  graphDir?: string       // local filesystem path, default: '.corum/graph'
  defaultBranch?: string  // override auto-detected branch; falls back to git currentBranch(), then 'main'
}
```

- `loadPackContent()` and `loadGraphContent()` both walk the filesystem under `graphDir` and read `.yaml` files. Packs are discovered by reading `graph.yaml` first.
- `defaultBranch()` calls `git.currentBranch()` on the containing repo; falls back to the configured override or `'main'` if in detached HEAD state.
- `listBranches()` returns the current branch only — the file source operates on the working tree, which is one branch at a time.
- `commit()` writes the ContentMap files to `graphDir` on disk, then creates a git commit via isomorphic-git. Filesystem is the source of truth for this source type, so writing to disk first is correct.

This is the backward-compatible source. Existing callers that pass `graphPath` are migrated to construct `new FileGraphSource({ graphDir: graphPath })`.

### GitGraphSource

```ts
interface BranchLoadOptions {
  maxBranches?: number         // load at most N branches, ordered by most recently committed
  staleDaysThreshold?: number  // skip branches with no commits in the last N days
}

interface GitGraphSourceOptions {
  graphDir?: string            // path within the repo, default: '.corum/graph'
  localPath?: string           // path to a local repo with a .git directory
  remoteUrl?: string           // HTTPS remote URL
  defaultBranch?: string       // override auto-detected default; falls back to remote HEAD symref, then 'main'
  auth?: {
    username: string
    token: string              // personal access token or app password
  }
  branchLoad?: BranchLoadOptions
}
```

Constructor validation:
- Neither `localPath` nor `remoteUrl` provided → throws `SourceError`
- Both `localPath` and `remoteUrl` provided → throws `SourceError`
- Exactly one provided → valid

#### Default branch detection

`defaultBranch()` resolves in this order:
1. Configured `defaultBranch` option if provided
2. Remote HEAD symref — after clone/fetch, isomorphic-git reads the `HEAD` file which points to the default branch (e.g. `refs/heads/main`)
3. `'main'` as final fallback

#### Authentication

`auth` is passed to isomorphic-git's `onAuth` callback for all HTTP operations (clone, fetch, push). If the repo is public, `auth` may be omitted. If the repo is private and `auth` is not provided, network operations will fail with a `SourceError` wrapping the 401/403 response.

#### Local mode (`localPath`)

- Uses the existing `.git` directory at `localPath`
- On `loadGraphContent()` / `loadPackContent()`: calls `git.fetch()` to refresh remote refs, then reads objects via `git.listFiles({ ref })` + `git.readBlob()`
- No working tree is materialised; reads go directly to git objects

#### Remote mode (`remoteUrl`)

- Manages a persistent cache at `~/.config/corum/cache/<sha256(remoteUrl)>/`
- **First run:** `git.clone({ url: remoteUrl, dir: cacheDir, noCheckout: true })` — fetches all git objects, no working tree
- **Subsequent runs:** `git.fetch({ dir: cacheDir })` + compare cached HEAD SHA to new HEAD SHA; if unchanged for a ref, the cached ContentMap is returned without re-reading blobs
- All reads use the same `git.listFiles()` + `git.readBlob()` path as local mode

Cache directory uses `~/.config/corum/` (XDG-compliant on Linux/Mac; resolved via `os.homedir()` on Windows) to avoid confusion with the project-local `.corum/` graph directory.

#### GitCacheManager

A small helper that owns the cache directory. On startup, if the cache directory exists but `git.listFiles()` fails (corrupt `.git`), the manager deletes the cache dir and re-clones. One automatic recovery attempt; if the re-clone also fails, surfaces as `SourceError`.

#### loadPackContent and loadGraphContent

Both methods resolve the commit SHA for the given ref first (`git.resolveRef`), then call `git.listFiles` and `git.readBlob` for each matching file. They differ only in which paths they read:

**`loadPackContent(ref)`** — always called with the default branch ref by `loadGraph`:
1. Read `graph.yaml` from `graphDir` to discover `templatePacks[].path` entries
2. Resolve each pack path relative to the repo root
3. Load all `.yaml` files under those paths into the ContentMap
4. Keys are relative to the pack directory root (e.g. `core/templates/DomainModel.yaml`)

**`loadGraphContent(ref)`** — called with the branch being loaded:
1. Read all `.yaml` files under `graphDir`, excluding `graph.yaml`
2. Keys are relative to `graphDir` (e.g. `components/orders/order.yaml`)

Files outside declared paths are never read. Both methods use `resolveRef` internally for SHA-based caching but this is an implementation detail, not exposed on the interface.

#### Branch filtering

`listBranches()` applies `branchLoadOptions` when returning branches for `loadMultiGraph`:
- If `staleDaysThreshold` is set, branches whose most recent commit is older than N days are excluded
- If `maxBranches` is set, the remaining branches are sorted by last commit date descending and truncated to N
- The default branch is always included regardless of filters

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

### loadGraph orchestration

```ts
async function loadGraph(options: LoadOptions): Promise<Graph> {
  const ref = options.ref ?? await options.source.defaultBranch()
  const defaultRef = await options.source.defaultBranch()

  // Packs always from default branch
  const packContent = await options.source.loadPackContent(defaultRef)
  const templates = loadPacks(packContent, diagnostics)

  // Clusters and edges from requested ref
  const graphContent = await options.source.loadGraphContent(ref)
  const nodes = loadClusters(graphContent, templates, diagnostics)
  const edges = loadEdges(graphContent, nodes, diagnostics)
  ...
}
```

### Loader function signatures

```ts
// Before
loadClusters(graphPath: string, templates, diagnostics)
loadEdges(graphPath: string, nodes, diagnostics)
loadPacks(packDirs: string[], diagnostics)

// After
loadClusters(content: ContentMap, templates, diagnostics)
loadEdges(content: ContentMap, nodes, diagnostics)
loadPacks(content: ContentMap, diagnostics)
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
  | 'local-modified'     // on viewing branch AND other branches, but properties differ
  | 'shared'             // on viewing branch and one or more others, properties identical
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

| On viewing branch | On other branches | Properties agree across all | GhostState |
|---|---|---|---|
| Yes | No | — | `local` |
| Yes | Yes | Yes | `shared` |
| Yes | Yes | No | `local-modified` |
| No | Default only | — | `default-only` |
| No | Exactly one other | — | `ghost-single` |
| No | 2+ others | Yes | `ghost-consensus` |
| No | 2+ others | No | `ghost-conflict` |

`local-modified`: the viewing branch owns a version of this node but other branches have diverged from it. The `presence` map exposes all variants. Surfaces in the UI as a node with a modification indicator — the user's version is shown normally but flagged as diverged.

`ghost-conflict`: the same node exists on multiple other branches with different property values. The UI shows it as a single ghost with a conflict indicator; the `presence` map exposes all variants for detail views or cherry-pick.

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

When `branches` is omitted, `source.listBranches()` is called and `branchLoadOptions` filters apply (stale threshold, max branches). Loading all branches is the default — teams with many branches should configure `staleDaysThreshold` to bound the load.

`overlay()` computes lazily on first call per `viewingRef` and memoizes the result. If branches are reloaded, the memo is invalidated.

### In-memory overlay computation

`overlay(viewingRef)` performs a full outer join across all `BranchGraph.graph.nodesById` maps:

1. Collect every node ID that appears in any loaded branch.
2. For each node ID, build an `OverlayNode` with its `presence` map (ref → Node).
3. Derive `ghostState` from the rules table above using the viewing branch as context.
4. Repeat for edges.

All operations are synchronous Map iterations — no I/O, no SQL.

`diff(branchRef)` is a subset: compare `presence.get(branchRef)` against `presence.get(defaultRef)` for each OverlayNode.

### FileGraphSource and MultiGraph

`FileGraphSource` produces a `MultiGraph` with exactly one `BranchGraph` and `branchResults` with a single `{ ref: 'main', status: 'loaded' }` entry. `overlay('main')` returns all nodes as `local`. The structure is identical — UI and MCP tools need no special-casing per source type.

---

## Section 5: Write Path (Stage 1)

### graph-writer.ts refactor

`graph-writer.ts` already contains all YAML serialisation logic: `toClusterDocument`, `toEdgeDocument`, `stringifyYaml`, and the cluster/edge file structure. The only change required is refactoring `saveGraph()` to **produce a `ContentMap`** (path → YAML string) instead of writing to disk. The serialisation logic itself is unchanged. The `graph.yaml` pack-path rewriting logic that currently uses `sourceGraphPath` is retained, producing the rewritten `graph.yaml` as an entry in the ContentMap.

The returned ContentMap is passed directly to `source.commit()`.

### GitGraphSource.commit() — direct git object write

`commit(branch, changes, message)` writes directly to git objects — no files are ever materialised to the working tree. This is consistent with the read path.

isomorphic-git plumbing APIs used: `writeBlob`, `readTree`, `writeTree`, `writeCommit`, `updateRef`.

```
changes (ContentMap from graph-writer)
  │
  ├─ writeBlob() for each entry → blob OIDs
  │
  ├─ readTree() from current branch HEAD → existing tree structure
  │
  ├─ buildUpdatedTree() — apply blob OIDs recursively:
  │     updating components/orders/order.yaml requires rebuilding
  │     components/orders/ tree → components/ tree → root tree
  │
  ├─ writeTree() → new root tree OID
  │
  ├─ writeCommit(tree, parent: currentHead, message, author) → new commit OID
  │
  ├─ updateRef(branchRef → new commit OID)
  │
  └─ push() → remote (remote mode only, uses auth if configured)
```

`buildUpdatedTree` is a helper internal to `GitGraphSource`. It is the most complex piece of the write path — it must read every intermediate tree from root to leaf, build new subtree objects bottom-up, and rewrite all affected trees. The ContentMap's flat key structure (e.g. `components/orders/order.yaml`) is decomposed into path segments to traverse and rebuild the tree hierarchy. This should be allocated proportionate implementation effort.

The default branch is read-only — `commit()` throws `SourceError` if `branch === await this.defaultBranch()`.

### FileGraphSource.commit()

Files from the ContentMap are written to `graphDir` on disk, then committed via isomorphic-git. Filesystem is the source of truth for this source type, so writing to disk first is correct and expected.

---

## Section 6: Error Handling

| Scenario | Behaviour |
|---|---|
| Default branch fails to load | Throw `SourceError` — no graph returned |
| Non-default branch fails to load | Skip branch, record `BranchLoadResult { status: 'failed', error }` |
| Both `localPath` and `remoteUrl` provided | Throw `SourceError` at construction |
| Neither `localPath` nor `remoteUrl` provided | Throw `SourceError` at construction |
| `commit()` called on default branch | Throw `SourceError` |
| Remote repo requires auth but none provided | Throw `SourceError` wrapping 401/403 |
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
- `local-modified` nodes — full opacity with modification indicator; detail panel shows diverged variants
- `default-only` nodes — visible at reduced opacity, labelled as base
- `ghost-single` / `ghost-consensus` nodes — ghost styling with branch badge
- `ghost-conflict` nodes — ghost styling with conflict indicator; detail panel shows all variants side-by-side

---

## Section 8: Testing

- **Unit tests for loaders:** Construct a `ContentMap` inline. No source, no filesystem, no git. Loaders stay synchronous — tests remain fast.
- **Unit tests for `FileGraphSource`:** Operate against a temp directory with fixture YAML files.
- **Unit tests for `GitGraphSource`:** Use a local fixture repo at `test/fixtures/git-repo/` — a real `.git` directory committed to the test suite. No mocking of isomorphic-git. Multiple branches set up using isomorphic-git in the test fixture setup script.
- **Integration tests for remote mode:** Use a `file://` URL pointing at the fixture repo. isomorphic-git supports `file://` remotes. No network in CI.
- **Multi-branch tests:** Fixture repo has `main`, `feat/branch-a`, and `feat/branch-b` with known node differences. Tests assert specific `OverlayNode` ghost states — covering `ghost-single`, `ghost-consensus`, `ghost-conflict`, and `local-modified` cases. `diff()` tests assert `added`, `modified`, `removed` counts against expected values.
- **Write path tests:** Assert that `buildUpdatedTree` produces the correct git tree OID for a given ContentMap delta. Verified by reading the committed blob back via `readBlob`.

---

## File Layout

```
src/
  source/
    index.ts            ← GraphSource interface, ContentMap type, SourceError
    file-source.ts      ← FileGraphSource
    git-source.ts       ← GitGraphSource
    git-cache.ts        ← GitCacheManager (~/.config/corum/cache/)
    content-utils.ts    ← listYamlKeys, readYaml, hasKey helpers
  loader/
    index.ts            ← updated loadGraph + new loadMultiGraph
    cluster-loader.ts   ← ContentMap-based (was graphPath + fs)
    edge-loader.ts      ← ContentMap-based
    pack-loader.ts      ← ContentMap-based
    fs-utils.ts         ← retained for FileGraphSource only
  writer/
    graph-writer.ts     ← refactored to produce ContentMap instead of writing to disk
  schema/
    index.ts            ← add BranchGraph, MultiGraph, BranchDiff, BranchOverlay,
                           BranchLoadResult, OverlayNode, OverlayEdge, GhostState, SourceError
```

---

## Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| Git library | isomorphic-git | Purpose-built object-level API; reads blobs/trees without checkout; higher stars than simple-git; in-process (no child process per file) |
| Remote caching | Persistent `~/.config/corum/cache/` with `noCheckout: true` | Fast subsequent starts via fetch + SHA comparison; aligns with ADR-001 incremental cache model; separate from project-local `.corum/` to avoid confusion |
| ContentMap scope | Separate `loadPackContent` / `loadGraphContent` | Clean key namespaces; no magic prefixes; pack and graph data have different ref semantics |
| ContentMap keys | Relative to `graphDir` / pack root respectively | Consistent between FileGraphSource and GitGraphSource; loaders unaware of source type |
| Pack source | Always default branch | Pack definitions are structural schema; branch-specific pack changes are not resolvable |
| Default branch detection | Remote HEAD symref → config override → `'main'` fallback | Git is authoritative; config override for non-standard repos; hardcoded fallback as last resort |
| Branch load default | All branches; filtered by `staleDaysThreshold` / `maxBranches` config | Teams with many branches can bound load; default is all for small repos |
| Multi-branch comparison | In-memory Map operations with lazy memoized overlay | No SQL, no I/O; clean for graph sizes realistic in v1; memoization avoids recompute on repeated UI calls |
| Default branch writes | Forbidden (SourceError) | Default branch is the stable reference; all changes go via non-default branches and PR |
| Both localPath + remoteUrl | Throw SourceError | Ambiguous configuration should be explicit, not silently resolved |
| graph-writer.ts | Refactored to produce ContentMap | Serialisation logic unchanged; only output mechanism changes; ContentMap passed to source.commit() |
| buildUpdatedTree | Internal to GitGraphSource | Git plumbing concern only; operates on ContentMap keys and blob OIDs, not YAML |
