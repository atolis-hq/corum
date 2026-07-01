# Reference: MCP Tool Catalogue

**Status:** Reference  
**Date:** 2026-07-01  
**Relates to:** ADR-005 (MCP Interface Design)  
**Note:** This document separates the currently implemented MCP read/query surface from additional candidate tools. Implemented tool names match the current codebase.

---

## Principles (from ADR-005)

- Responses should be semantically richer than raw files.
- Filters are expressed as structured objects where that improves extensibility.
- Branch-aware querying is first-class when Corum is backed by a source.
- Summary/orientation tools should be cheap to call at session start.

---

## Implemented Today

These tools are implemented in `src/mcp/index.ts`.

### Graph Queries

**`list_nodes`**  
Lists lightweight node summaries. Uses a `filter` object with:
- `templates?: string[]`
- `exclude_templates?: string[]`
- `component?: string`
- `state?: string | string[]`
- `stability?: string | string[]`

Also accepts `include_provenance`, `branch`, `format`, and `compact_keys`.

**`get_cluster`**  
Returns:
- `root` — with `schemas` and `enums` blocks by default (see below)
- `descendants` — semantic children only (operations, invariants, etc.) when collapsed
- `includedNodes`
- `edges`

By default (`collapse_schemas: true`) schema and enum child nodes are collapsed into compact blocks on the root rather than emitted as individual descendant nodes:

- `root.schemas` — map of schema name → field map. Each field entry: `{ type?, $ref?, collection?, nullable?, edges? }`. Local schema/enum refs use `$ref: '#/schemas/name'` or `$ref: '#/enums/name'`. Mapping fields render as `{ type: map, key: string, value: { ... } }`.
- `root.enums` — map of enum name → `{ values: string[] }`.
- Field-level cross-cluster edges (`maps-to`, `derived-from`) appear as an `edges` block on the field entry. Targets are full node IDs, usable directly in `get_lineage`.

Pass `collapse_schemas: false` to restore the full structural node-per-field representation. All other behaviour is identical.

Use when you need the full structural contents of a single node. Not suited for following relationships across the graph; use `get_lineage` for that.

Supports `collapse_schemas`, `edge_types`, `include_provenance`, `branch`, `overlay_refs`, `format`, and `compact_keys`.

**`get_graph`**  
Returns the semantic graph as `{ nodes, edges }`. Structural templates and structural edge types are excluded by default. Supports `filter`, `include_provenance`, `branch`, `format`, and `compact_keys`.

**`get_graph_metadata`**  
Returns discovery metadata for agents and other clients:
- `template_names`
- `node_templates_in_use`
- `edge_types_in_use`
- `valid_edge_types`
- `states`
- `stabilities`
- `lineage_directions`
- `output_formats`

Call this first before making traversal queries. `edge_types_in_use` tells you which edge types are actually modeled in the current graph.

Also accepts `branch`, `format`, and `compact_keys`.

**`get_lineage`**  
Traverses from one or more origin nodes. By default it returns `nodes` only, in lean form. Supports:
- `node_ids`
- `depth`
- `direction`
- `edge_types`
- `node_types`
- `exclude_node_types`
- `include_dangling_edges`
- `reads_outbound_only`
- `lean`
- `include_edges`
- `include_provenance`
- `branch`
- `format`
- `compact_keys`

Default lean lineage node shape:
- `id`
- `origin_id`
- `depth`
- `via_edge_type`
- `via_node_id`

Pass multiple `node_ids` in one call to expand all origins in parallel. Useful patterns:
- Event fan-out: `direction: downstream`, `depth: 2`
- Find all writers to an aggregate: `direction: upstream`
- Full event chain: `direction: downstream`, `depth: 3` or more

**`search_nodes`**  
Fuzzy-searches root-level nodes. Supports:
- `queries`
- `templates`
- `exclude_templates`
- `page_size`
- `offset`
- `search_properties`
- `include_provenance`
- `branch`
- `format`
- `compact_keys`

Prefer this over `list_nodes` when you have a domain term to search for. Use `list_nodes` only when you need a complete inventory under explicit filters.

**`get_linked_fields`**  
Returns `maps-to` edges touching fields owned by a given root node.

Supports `include_provenance`, `branch`, `format`, and `compact_keys`.

### Templates

**`list_templates`**  
Lists loaded template summaries.

**`get_template`**  
Returns the full loaded template definition.

### Summary and Branching

**`get_graph_summary`**  
Returns node count, component count, orphan breakdown, edge counts, and diagnostic count.

**`list_branches`**  
Lists available branches and their load status when a source-backed graph is configured.

**`diff_branch`**  
Diffs a branch against the default branch when a source-backed graph is configured.

### Common Output Options

Most tools support:
- `format`: `yaml` (default), `json`, or `toon`
- `compact_keys`: shorten common keys before serialization

All node-returning tools support:
- `include_provenance`: include `extractedFrom`, `lastModifiedAt`, `derivation`, and `derivedBy`

`schemaVersion` is never returned by MCP.

### Implemented Prompt

The server also exposes an MCP prompt:

**`usage-guide`**  
Orientation prompt for newly connected agents. Covers:
- node ID shape
- edge-type semantics
- recommended workflow
- output-format selection
- graph completeness caveats and verification guidance

---

## Candidate Future Tools

These are not implemented in the current codebase, but remain consistent with ADR-005 direction.

### Overlay Detail

**Get threads**  
Fetch full thread detail for a node or owned node.

**Get drift detail**  
Fetch the full drift report for a node.

**Get branch versions**  
Fetch the full cluster document for a node across specified branches.

**Get branch conflicts**  
Fetch the conflict report for a node.

### Graph Mutations

**Create cluster**  
Create a new root node cluster file with its template-required properties.

**Update cluster**  
Update properties on an existing root node.

**Remove cluster**  
Soft-delete a node by transitioning state to `removed`.

**Create edge**  
Create an edge between two nodes.

**Remove edge**  
Hard-delete an edge.

**Create field mapping**  
Convenience wrapper for creating a `maps-to` edge between two field nodes.

**Rename node**  
First-class rename with `renamed-from` semantics and affected-edge follow-up.

### Threads

**Create thread**  
Create a discussion, question, or reasoning-trace thread on a node, edge, or field.

**Resolve thread**  
Mark a thread as resolved with an optional resolution note.

### Branch and Sync

**Sync**  
Trigger an immediate Git fetch and incremental cache update.

**Create branch**  
Create a new branch on the graph repo for in-flight design work.

### Utility

**Validate cluster**  
Validate a proposed cluster against its template JSON Schema without writing.

---

## Session Start Pattern

The typical session-start sequence for the currently implemented surface is:

1. `get_graph_metadata`
2. `list_branches` if branch-aware context matters
3. `search_nodes` to find candidate start nodes
4. `get_lineage` with batched `node_ids` for traversal
5. `get_cluster` only when full structural detail is required
