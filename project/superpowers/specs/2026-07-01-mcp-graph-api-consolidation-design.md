# Design: MCP & Graph API Consolidation

**Date:** 2026-07-01  
**Branch:** feat/mcp-tools  
**Status:** Approved

---

## Problem

The graph query capabilities are fragmented across three layers that have grown out of sync:

- `buildFocusGraph` (lineage BFS) lives in `web/graph-utils.js` as client-side JavaScript
- `fuzzyMatch`/`searchNodes` live in `web/search.jsx` as client-side JavaScript
- MCP `get_cluster` calls `getCluster` (no external edge traversal); web `/api/cluster` calls `getClusterView` — they have silently diverged
- `list_nodes` accepts `template` as a single string; the MCP has no multi-template filter, no exclude list
- No `get_lineage`, `search_nodes`, `get_graph`, or `get_graph_summary` MCP tools exist
- No `/api/search` or `/api/lineage` web endpoints exist

---

## Principle

`src/graph/index.ts` is the single authority for graph query logic. Web server and MCP are thin adapters over it. The UI becomes more dumb — it calls the API rather than re-implementing logic client-side.

Breaking changes to MCP tools are acceptable — there are no active consumers.

---

## Architecture Changes

### `src/graph/index.ts` — new and modified exports

**New: `getLineage(graph, startNodeIds, options)`**  
Port of `buildFocusGraph` from `web/graph-utils.js`, rewritten in TypeScript and generalised:
- Multiple start nodes, expanded in parallel with results merged and deduplicated
- Configurable direction: `downstream` | `upstream` | `both`
- Configurable edge types (default: all non-structural — see Edge Type Defaults below)
- Configurable node type exclusions (default: exclude structural templates)
- Depth-limited BFS; cycles handled by visited set
- Annotated result nodes: `origin_id`, `depth`, `via_edge_type`, `via_node_id` — shortest path wins for the annotation, but all in-scope edges are included
- Optional dangling edges: edges where one endpoint is within the result set and the other falls outside the traversal boundary
- `reads_outbound_only` flag (default `true`): when true, `reads` edges are only followed outbound to prevent a shared Schema from pulling in every endpoint that references it; toggleable

**New: `searchNodes(graph, queries, options)`**  
Port of `fuzzyMatch`/`searchNodes` from `web/search.jsx`, rewritten in TypeScript and generalised:
- `queries`: array of search terms (OR semantics — any term matches)
- Fuzzy match against node ID segments by default
- `search_properties` flag: when true, also matches against `name`, `description`, `x-aka` and other metadata properties
- Template include/exclude filter
- `limit` and `offset` for pagination
- Only matches root-level nodes (no `parentId`) — same as existing UI behaviour
- Returns ranked results (score descending, then shortest ID ascending)

**New: `getGraphSummary(graph)`**  
Extracts the stats computation currently embedded in `/api/stats`:
- Node count, component count, orphan node count, orphans by template
- Edge counts by type (semantic edges only)
- Diagnostic count

**Modified: `listNodes(graph, filter)`**  
`ListNodesFilter` gains multi-value support:
```typescript
export type ListNodesFilter = {
  templates?: string[]       // replaces single template; OR semantics
  excludeTemplates?: string[]
  component?: string
  state?: State | State[]
  stability?: Stability | Stability[]
}
```

**Existing: `getClusterView`** — unchanged. MCP `get_cluster` is upgraded to call it (closes the parity gap with the web).

### Edge Type Defaults

Structural edges excluded from all defaults: `has-field`, `has-value`, `renamed-from`.  
All other edge types — including current (`triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`) and any future additions — are included by default.

New edge types added to `EdgeType` in `src/schema/index.ts` are automatically included in defaults without requiring updates to tool defaults.

### Structural Template Defaults

Templates excluded from lineage results by default: `Field`, `Schema`, `EnumDefinition`, `EnumValue`, `Mapping`.

---

## MCP Tool Changes (`src/mcp/index.ts`)

### Modified: `list_nodes`

Replace flat typed params with a `filter` object. Breaking change.

```
filter: {
  templates?: string[]           // include only these templates (OR semantics)
  exclude_templates?: string[]   // exclude these templates
  component?: string
  state?: string | string[]
  stability?: string | string[]
}
branch?: string
format?: "yaml" | "json" | "toon"
compact_keys?: boolean
```

### Modified: `get_cluster`

- Upgraded to call `getClusterView` instead of `getCluster` (parity fix)
- New param: `edge_types?: string[]` — edge types to traverse for external nodes. Default: all non-structural.
- New param: `include_dangling_edges?: boolean` — default `false`
- New param: `reads_outbound_only?: boolean` — default `true`

### New: `get_graph`

All semantic nodes + edges. Equivalent to the web `/api/graph` but filterable.

```
filter?: {
  templates?: string[]
  exclude_templates?: string[]
  component?: string
  state?: string | string[]
  stability?: string | string[]
}
branch?: string
format?: "yaml" | "json" | "toon"
compact_keys?: boolean
```

Returns: `{ nodes: Node[], edges: Edge[] }` — nodes exclude structural templates by default (same as `/api/graph`), edges exclude structural edge types.

### New: `get_graph_summary`

Orientation tool. No required params.

```
branch?: string
format?: "yaml" | "json" | "toon"
compact_keys?: boolean
```

Returns: `{ nodeCount, componentCount, orphanNodeCount, orphansByTemplate, edgesByType, diagnosticCount }`

### New: `search_nodes`

```
queries: string[]              // required; OR semantics across terms
templates?: string[]
exclude_templates?: string[]
page_size?: number             // default 10
offset?: number                // default 0
search_properties?: boolean    // default false; also matches name/description/x-aka
branch?: string
format?: "yaml" | "json" | "toon"
compact_keys?: boolean
```

Returns ranked list of root-level nodes with match score.

### New: `get_lineage`

```
node_ids: string[]             // required; one or more start nodes
depth?: number                 // default 2
direction?: "downstream" | "upstream" | "both"  // default "downstream"
edge_types?: string[]          // default: all non-structural
node_types?: string[]          // allowlist — restrict results to these templates; overrides exclude_node_types
exclude_node_types?: string[]  // denylist — default: excludes structural templates; ignored if node_types is set
include_dangling_edges?: boolean  // default false
reads_outbound_only?: boolean  // default true
branch?: string
format?: "yaml" | "json" | "toon"
compact_keys?: boolean
```

Returns:
```
nodes: Array<{
  id, template, component, state, stability,
  origin_id: string,         // which input node it was reached from
  depth: number,             // hops from origin (shortest path)
  via_edge_type: string,     // edge type traversed to reach this node
  via_node_id: string,       // immediate predecessor in traversal
  origins?: string[]         // all origin_ids when reachable from multiple (direction: both)
  direction?: "upstream" | "downstream"  // when direction: "both"
}>
edges: Edge[]                // all edges where both endpoints are in the result set
dangling_edges?: Edge[]      // present when include_dangling_edges: true
```

### Unchanged

`list_templates`, `get_template`, `get_linked_fields`, `list_branches`, `diff_branch`

---

## Web API Changes (`src/web/server.ts`)

### New: `GET /api/search`

Calls `searchNodes()`.

Query params: `q` (comma-separated terms), `templates` (repeated), `exclude_templates` (repeated), `limit` (default 10), `offset` (default 0), `search_properties` (boolean string), `ref`

### New: `GET /api/lineage`

Calls `getLineage()`.

Query params: `node_ids` (repeated), `depth`, `direction`, `edge_types` (repeated), `exclude_node_types` (repeated), `include_dangling_edges`, `reads_outbound_only`, `ref`

### Modified: `GET /api/graph`

Add filter query params: `templates` (repeated), `exclude_templates` (repeated), `component`, `state`, `stability`, `ref`

### Unchanged

`/api/stats` — `getGraphSummary()` is extracted from it but the endpoint keeps the same shape and response. The web dashboard continues to call `/api/stats`.

---

## UI Changes (`web/`)

### `web/search.jsx`

- `SearchModal` switches from client-side `fuzzyMatch` to calling `GET /api/search?q=...&limit=10`
- No UI changes — no property search toggle, no new controls
- The `fuzzyMatch` and `searchNodes` functions are removed from `search.jsx`

### `web/graph.jsx`

- Level 3 (focus view) switches from `buildFocusGraph` to calling `GET /api/lineage`
- Depth changes and edge type toggles trigger an API call with ~150ms debounce on rapid depth changes
- Response shape changes: `get_lineage` returns annotated nodes; the canvas only uses `id`, `template`, `component`, `state`, `stability`, `parentId` — same fields as before

### `web/graph-utils.js`

- `buildFocusGraph` is removed
- Remaining exports: `buildComponentMap`, `applyEdgeTypeFilter`, `getDisplayName`

---

## Files Affected

| File | Change |
|------|--------|
| `src/graph/index.ts` | Add `getLineage`, `searchNodes`, `getGraphSummary`; extend `ListNodesFilter` |
| `src/web/server.ts` | Add `/api/search`, `/api/lineage`; filter params on `/api/graph`; extract `getGraphSummary` |
| `src/mcp/index.ts` | Modify `list_nodes`, `get_cluster`; add `get_graph`, `get_graph_summary`, `search_nodes`, `get_lineage` |
| `web/search.jsx` | Remove client-side fuzzy match; call `/api/search` |
| `web/graph.jsx` | Remove `buildFocusGraph` usage; call `/api/lineage` for focus view |
| `web/graph-utils.js` | Remove `buildFocusGraph` |

---

## Out of Scope

- Graph mutations (create/update cluster, create/remove edge)
- Threads, drift detection, conflict analysis tools
- `get_linked_fields` changes
- Authentication or rate limiting
