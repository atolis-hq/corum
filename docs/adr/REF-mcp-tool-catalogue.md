# Reference: MCP Tool Catalogue

**Status:** Reference  
**Date:** 2026-07-04  
**Relates to:** ADR-005 (MCP Interface Design)  
**Note:** This document separates the currently implemented MCP surface from additional candidate tools. Implemented tool names match the current codebase.

---

## Principles (from ADR-005)

- Responses should be semantically richer than raw files.
- Filters are expressed as structured objects where that improves extensibility.
- Branch-aware querying is first-class when Corum is backed by a source.
- Summary and orientation tools should be cheap to call at session start.

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
- `root` - with `schemas` and `enums` blocks by default
- `descendants` - semantic children only when collapsed
- `includedNodes`
- `edges`

By default (`collapse_schemas: true`) schema and enum child nodes are collapsed into compact blocks on the root rather than emitted as individual descendant nodes:
- `root.schemas` - map of schema name -> field map. Each field entry: `{ type?, $ref?, collection?, nullable?, edges? }`
- `root.enums` - map of enum name -> `{ values: string[] }`
- field-level cross-cluster edges (`maps-to`, `derived-from`) appear as an `edges` block on the field entry

Pass `collapse_schemas: false` to restore the full structural node-per-field representation. Use this tool when you need the full structural contents of a single node, not for relationship traversal.

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

Call this first before making traversal queries. `edge_types_in_use` tells you which edge types are actually modeled in the current graph. Static enums are included when `include_static_enums: true`.

Also accepts `branch`, `format`, and `compact_keys`.

**`get_lineage`**  
Traverses from one or more origin nodes. By default it returns `nodes` only, in lean form.

Supports:
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

Pass multiple `node_ids` in one call to expand all origins in parallel.

**`search_nodes`**  
Fuzzy-searches root-level nodes.

Supports:
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

Prefer this over `list_nodes` when you have a domain term to search for.

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

### Graph Mutations

The write surface is session-based. Open a session with `start_changes`, make one or more mutations, inspect with `pending_changes`, then finish with `commit_changes` or `discard_changes`.

While a working session is open:
- unbranched reads serve the working graph
- branch-scoped reads for the same branch also serve the working graph
- other branch reads continue to load from the source normally

**`start_changes`**  
Opens a working session for graph mutations.

Supports:
- `branch`
- `create`
- `autosave`
- `format`
- `compact_keys`

**`apply_cluster`**  
Upserts a cluster-style nested document.

Supports:
- `document`
- `mode`: `merge | replace`
- `format`
- `compact_keys`

Key behavior:
- `merge` updates only what is present
- `replace` is authoritative for the root's owned sections
- key changes are never inferred as renames; use `rename_node`

**`create_node`**  
Creates a root cluster or an owned child under an existing parent.

Supports:
- `document`
- `parent_id`
- `section`
- `name`
- `format`
- `compact_keys`

**`update_node`**  
Patches node `properties`, `state`, or `stability`.

Supports:
- `id`
- `properties`
- `state`
- `stability`
- `format`
- `compact_keys`

Names are not patchable here; renames use `rename_node`.

**`rename_node`**  
Renames a node by replacing the final ID segment.

Supports:
- `id`
- `new_name`
- `record_trail`
- `format`
- `compact_keys`

Key behavior:
- descendant IDs, parent references, and edge endpoints are rewritten automatically
- renaming a root cluster also moves its file at commit
- when trail recording applies, the live node gains `previousNames` and a hidden `renamed-from` edge
- this is the only rename path

**`delete_node`**  
Deletes a node and its owned subtree.

Supports:
- `id`
- `purge`
- `record_trail`
- `format`
- `compact_keys`

**`create_edge`**  
Creates an explicit edge between two nodes.

**`update_edge`**  
Patches an explicit edge's `state`, `stability`, `notes`, or `properties`.

**`delete_edge`**  
Hard-deletes an explicit edge.

**`pending_changes`**  
Returns the open session's journal plus summary diff counts against the session base.

**`discard_changes`**  
Closes the open session without committing.

Important note: file-source autosave sessions do not roll back mutations already written through to disk.

**`commit_changes`**  
Lint-gates, serializes, and persists the working graph, then closes the session.

Key behavior:
- full-graph lint errors block the commit and leave the session open
- warnings ride along in the response
- git autosave sessions squash their WIP checkpoint run when no external commit interleaved
- file-source autosave sessions have already persisted each mutation, so commit mainly validates and closes

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
- recommended read and write workflow
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

The typical write sequence is:

1. `start_changes`
2. mutation tools (`apply_cluster`, `create_node`, `update_node`, `rename_node`, `delete_node`, `create_edge`, `update_edge`, `delete_edge`)
3. `pending_changes`
4. `commit_changes` or `discard_changes`
