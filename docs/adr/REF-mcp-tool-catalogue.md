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

Also accepts `branch`, `format`, and `compact_keys`.

**`get_cluster`**  
Returns:
- `root`
- `descendants`
- `includedNodes`
- `edges`

Supports `edge_types`, `branch`, `overlay_refs`, `format`, and `compact_keys`.

**`get_graph`**  
Returns the semantic graph as `{ nodes, edges }`. Structural templates and structural edge types are excluded by default. Supports `filter`, `branch`, `format`, and `compact_keys`.

**`get_lineage`**  
Traverses from one or more origin nodes and returns annotated lineage nodes plus edges. Supports:
- `node_ids`
- `depth`
- `direction`
- `edge_types`
- `node_types`
- `exclude_node_types`
- `include_dangling_edges`
- `reads_outbound_only`
- `branch`
- `format`
- `compact_keys`

**`search_nodes`**  
Fuzzy-searches root-level nodes. Supports:
- `queries`
- `templates`
- `exclude_templates`
- `page_size`
- `offset`
- `search_properties`
- `branch`
- `format`
- `compact_keys`

**`get_linked_fields`**  
Returns `maps-to` edges touching fields owned by a given root node.

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

1. `get_graph_summary`
2. `list_branches` if branch-aware context matters
3. `search_nodes` or `list_nodes` to orient to the area of interest
4. `get_cluster` or `get_lineage` for deeper traversal
