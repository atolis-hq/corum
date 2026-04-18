# MCP v1 Design

**Date:** 2026-04-18  
**Status:** Approved  
**Scope:** Lightweight first version of the Corum MCP server — load graph from filesystem, expose three query tools

---

## 1. Architecture

A single TypeScript package. `loadGraph` reads template packs and cluster/edge files from the filesystem, validates them, and returns an in-memory `Graph` object. The MCP server calls `loadGraph` once at startup and registers three tools over it.

No SQLite. The graph is two indexed Maps (`nodesById`, `edgesByFrom`/`edgesByTo`). Graph sizes will never approach a scale where this is a problem, and in-memory keeps traversal simple.

**Strict loading by default.** `loadGraph` throws a `LoadError` carrying all diagnostics if any error-severity problem exists. Pass `strict: false` to get a partial graph with diagnostics attached. Strict loading doubles as file validation — it is the first stage of linting.

**Default paths:**
- Graph files: `.corum/graph` (or passed explicitly)
- Template packs: `.corum/packs` (or passed explicitly)

---

## 2. Folder layout

```
src/
  schema/        # TypeScript interfaces: Node, Edge, Template, Graph, Diagnostic, LoadOptions
  loader/        # loadGraph, pack loader, cluster loader, edge loader
  graph/         # listNodes, getCluster, getLinkedFields
  mcp/           # MCP server entry point, tool registrations
test/
  loader.test.ts
  graph.test.ts
  mcp.test.ts
fixtures/        # existing sample-graph fixtures (living spec)
```

Folder structure mirrors a future monorepo split (`@corum/loader`, `@corum/graph`, `@corum/mcp`) without imposing it now.

---

## 3. Data model

```typescript
interface Node {
  id: string
  template: string
  component: string
  state: State
  stability: Stability
  schemaVersion: string
  lastModifiedAt: string
  extractedFrom?: string
  properties: Record<string, unknown>
}

interface Edge {
  id: string            // derived: {from}__{type}__{to}
  from: string
  to: string
  type: EdgeType
  state: State          // default: proposed
  stability: Stability  // default: unstable
  notes?: string
}

interface Template {
  name: string
  version: string
  core?: boolean
  abstract?: boolean
  extends?: string
  description?: string
  properties?: object       // JSON Schema
  'edge-types'?: { outgoing?: EdgeType[]; incoming?: EdgeType[]; supports?: EdgeType[] }
  ui?: { icon?: string; colour?: string; displayProperties?: string[]; badge?: string }
  [section: string]: OwnedSection | unknown  // owned sections via item-template
}

interface Graph {
  nodes: Map<string, Node>
  edges: { byFrom: Map<string, Edge[]>; byTo: Map<string, Edge[]> }
  templates: Map<string, Template>
  diagnostics: Diagnostic[]
}

interface Diagnostic {
  severity: 'error' | 'warning'
  file: string
  nodeId?: string
  message: string
}

interface LoadOptions {
  strict?: boolean   // default: true
}
```

---

## 4. Loader

Three phases, executed in order:

**Phase 1 — Pack loading**  
Read all `.yaml` files under `packsPath`. Validate each against `template.schema.yaml`. Resolve `extends` inheritance (merge `properties` via `allOf`, child overrides for `description`, `ui`, `edge-types`, owned sections). Reject abstract templates that are referenced in `extends` cycles. All templates loaded before any cluster files.

**Phase 2 — Cluster loading**  
Walk `graphPath/components/{component}/{TemplateNames}/*.yaml`. For each file:
1. Validate root node against `node.schema.yaml`
2. Validate `properties` block against the template's properties schema
3. Resolve child-override inheritance: child nodes inherit root `state`/`stability`; inline overrides win
4. Materialise owned child nodes as first-class `Node` entries in `nodesById`
5. Materialise `has-field` and `has-value` structural edges in `edgesByFrom`/`edgesByTo`

Structural edge materialisation is required for uniform graph traversal — without it, `getCluster` and `getLinkedFields` would need special-case prefix-matching instead of following edges.

**Phase 3 — Edge loading**  
Read all `.yaml` files under `graphPath/edges/`. Validate each edge against `edge.schema.yaml`. Resolve `from`/`to` to known node IDs. In strict mode: unresolved references are errors. In lenient mode: unresolved references become warnings, edge is still added with the unresolved ID preserved.

Derive edge `id` as `{from}__{type}__{to}`. Apply defaults: `state: proposed`, `stability: unstable`.

---

## 5. Graph queries

All synchronous. All operate on the in-memory `Graph`.

**`listNodes(filter?)`**  
Iterates `nodesById`. Optional filter: `template`, `component`, `state`, `stability`. Returns `Node[]`.

**`getCluster(nodeId)`**  
Returns `{ root: Node, children: Node[], edges: Edge[] }`.  
Children: follow `has-field` and `has-value` edges from root transitively.  
Edges: all edges where both endpoints are within the cluster (structural + cross-cutting).  
Throws `QueryError` for unknown `nodeId`.

**`getLinkedFields(nodeId)`**  
Returns all `maps-to` edges where either endpoint is a field owned by the given root node.  
Walks `edgesByFrom` and `edgesByTo` for all field IDs under the root.  
Returns `{ edges: Edge[], nodes: Node[] }` — nodes includes both endpoint nodes for each edge, no second round-trip needed.

---

## 6. MCP tools

Three tools. Thin wrappers over graph query functions.

**`list_nodes`**  
Params: `template?`, `component?`, `state?`, `stability?`  
Returns: array of `{ id, template, component, state, stability }` — no owned children, keeps it scannable.

**`get_cluster`**  
Params: `node_id`  
Returns: full cluster — root node with all properties, owned child nodes, edges within cluster.  
Primary "show me everything about this node" tool.

**`get_linked_fields`**  
Params: `node_id`  
Returns: all `maps-to` edges touching fields owned by that node, with both endpoint nodes included.

**Startup behaviour:** `loadGraph` is called once at server startup (strict mode). If loading fails, the server starts but all tools return the load diagnostics — an agent can read what's wrong without the server crashing.

---

## 7. Error handling

**`LoadError`** — thrown by `loadGraph` in strict mode. Carries `diagnostics: Diagnostic[]` so all problems are reported at once. Strict mode throws if any `error`-severity diagnostic exists. `strict: false` returns the graph with diagnostics attached.

**`QueryError`** — thrown by graph query functions for bad inputs (unknown `nodeId`). Simple message, not a diagnostic array.

No silent failures. Missing template → diagnostic. Unresolved edge endpoint → diagnostic (error strict, warning lenient).

---

## 8. Testing

**`loader.test.ts`**  
Loads `fixtures/sample-graph`. Asserts:
- Expected node count
- Structural edges are materialised (`has-field`, `has-value`)
- Strict mode throws on a deliberately broken fixture
- Lenient mode returns diagnostics instead of throwing

**`graph.test.ts`**  
Unit tests for `listNodes`, `getCluster`, `getLinkedFields` against a small in-memory graph built directly (no file I/O). Tests: filter logic, cluster boundary, field traversal.

**`mcp.test.ts`**  
Integration test: start MCP server against fixtures, call each tool, assert response shape.

No mocking of the filesystem in loader tests — they hit real files. The fixtures are the living spec.
