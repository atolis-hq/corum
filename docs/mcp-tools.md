# MCP tools

Corum runs as an MCP stdio server (`corum mcp`). Your agent calls these tools;
see [Working with agents](working-with-agents.md) for how they fit together.

## Client configuration

```json
{
  "mcpServers": {
    "corum": {
      "command": "corum",
      "args": ["mcp", "--no-web"],
      "env": { "CORUM_GRAPH_PATH": "/path/to/your/graph" }
    }
  }
}
```

Without a global install, use `"command": "npx"` and
`"args": ["@atolis-hq/corum", "mcp", "--no-web"]`. Other settings can be
supplied as environment variables; see [Configuration](configuration.md).

The server also exposes a `usage-guide` prompt covering graph structure,
read/write workflow, output formats and graph-completeness caveats.

## Read tools

| Tool | Description |
| --- | --- |
| `get_graph_metadata` | Template names, templates in use, edge types, valid enum values. Usually the first call. `edge_types_in_use` avoids traversing types that don't exist. Pass `include_static_enums: true` for valid edge types, states, stabilities and formats |
| `get_graph_summary` | Node, component and edge counts, orphan breakdown, diagnostics |
| `search_nodes` | Fuzzy search of root nodes by ID, with template filters and property search. Accepts `queries: string[]` |
| `list_nodes` | Inventory using a `filter` of `templates`, `exclude_templates`, `component`, `state`, `stability` |
| `list_templates` / `get_template` | Template summaries and full detail |
| `get_cluster` | A node's structure. Schemas and enums are collapsed into compact blocks by default; pass `collapse_schemas: false` for node-per-field output |
| `get_graph` | The semantic graph as `{ nodes, edges }`, excluding structural templates and edges by default |
| `get_lineage` | Traverse lineage from one or more start nodes |
| `get_linked_fields` | `maps-to` edges touching fields owned by a root node |
| `list_branches` | Branches and their load status |
| `diff_branch` | Diff a branch against the default branch |

### `get_lineage`

Accepts `node_ids` (pass several in one call), `depth`, `direction`,
`edge_types`, `node_types`, `exclude_node_types`, `include_dangling_edges`,
`reads_outbound_only`, `lean` and `include_edges`. By default it is lean (nodes
carry only `id`, `origin_id`, `depth`, `via_edge_type`, `via_node_id`) and
omits edges.

### Tips

- Use `search_nodes` for discovery and `list_nodes` only for full inventories.
- Use `get_cluster` for one node's detail; use `get_lineage` for relationships.
- `branch` is supported on query tools when running against a Git source.
- Read tools reflect an open working session, including uncommitted changes.

## Write tools

Writes need an open session; they are thin wrappers over the mutation engine.

| Tool | Description |
| --- | --- |
| `start_changes` | Open a working session (optionally `branch`, `create`, `autosave`) |
| `apply_cluster` | Upsert a cluster document in `merge` or `replace` mode |
| `create_node` | Create a root cluster or owned child node |
| `update_node` | Patch properties, state or stability |
| `rename_node` | Rename a node, preserving identity trail metadata |
| `delete_node` | Soft- or hard-delete a node subtree |
| `create_edges` | Create explicit edges atomically |
| `update_edge` / `delete_edge` | Patch or remove an explicit edge |
| `create_fields` | Batch-create fields across schemas |
| `pending_changes` | Session journal and summary diff |
| `commit_changes` | Lint, serialise and persist |
| `discard_changes` | Abort the session |

Example sequence:

```yaml
start_changes:
  branch: feat/order-design
  create: true

rename_node:
  id: orders.Schema.invoice
  new_name: bill

pending_changes: {}

commit_changes:
  message: rename invoice schema to bill
```

Rules worth knowing:

- No write works without a session.
- `rename_node` is the only rename path.
- `apply_cluster` `replace` removes children that are absent from the document.
- `delete_node` is soft for nodes on the default branch, hard for branch-local ones.

## Output options

Every tool accepts:

- `format`: `toon` (default, most compact for models), `yaml` or `json`.
- `compact_keys: true`: shortens common keys (`id`→`i`, `template`→`t`...) to save tokens.

Node-returning tools accept `include_provenance: true` to include
`extractedFrom`, `lastModifiedAt`, `derivation` and `derivedBy`, which are
omitted by default.
