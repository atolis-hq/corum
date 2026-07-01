# CLAUDE.md

## What This Is

Corum is a Git-native design graph for service architecture. It models components (APIs, domain models, schemas, fields) as nodes with typed edges, exposed via MCP tools. The Git repo *is* the database—no external infrastructure.

## Commands

```bash
npm run build          # tsc → dist/
npm test               # build + Node test runner (expects 45 nodes, 38 edges from fixtures)
npm run mcp            # start stdio MCP server (default graph: .corum/graph)
npm run web            # start Express web UI
node --test dist/test/loader.test.js  # run single test file
```

## Architecture

**Load pipeline** (`src/loader/`): packs → clusters → edges → in-memory `Graph` (Maps keyed by node ID / edge endpoints). `loadPacks()` topologically sorts templates by inheritance before cluster parsing.

**Clusters vs. Nodes**: A cluster YAML file defines a root node. Template `ownedSections` (e.g., DomainModel owns `schemas`, `enums`) cause child nodes to be materialized inline—one YAML block becomes multiple `Node` objects with auto-generated structural edges (`has-field`, `has-value`).

**Node IDs** follow ownership hierarchy: `orders.DomainModel.order.schemas.order.fields.id`. The dot path encodes the full parent chain.

**Edges** are either structural (auto-generated from template ownership) or explicit (declared in `edges/**/*.yaml`). Edge IDs: `{from}__{type}__{to}`. Valid types: `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`, `renamed-from`, `has-field`, `has-value`.

**Templates** (`src/loader/pack-loader.ts`) live in `.corum/packs/*/templates/*.yaml` and can extend other templates. Core pack provides base types; domain/rest/messaging packs extend them.

**MCP tools** (`src/mcp/index.ts`): `list_nodes`, `list_templates`, `get_template`, `get_cluster`, `get_graph`, `get_graph_metadata`, `get_lineage`, `get_graph_summary`, `search_nodes`, `get_linked_fields`, `list_branches`, `diff_branch`.

**Serialization** (`src/mcp/serializers.ts`): YAML (default), JSON, or TOON (compact token format). `compact_keys` shortens common keys (`id→i`, `template→t`, etc.) to reduce token usage. MCP omits node provenance by default; node-returning tools accept `include_provenance: true` when codebase/source bridging is needed. `get_lineage` is lean by default and omits `edges` unless `include_edges: true`.

**Error handling**: Load errors are collected as diagnostics and bundled in `LoadError`—not thrown per-item unless `strict: true`. Query failures throw `QueryError` immediately.

## Key Files

| Path | Role |
|------|------|
| `src/schema/index.ts` | Core types: Node, Edge, Graph, Template, State, Stability, EdgeType |
| `src/loader/index.ts` | Load orchestrator |
| `src/loader/cluster-loader.ts` | Node materialization from cluster YAML |
| `src/graph/index.ts` | Query functions (listNodes, getCluster, getLinkedFields) |
| `src/mcp/index.ts` | MCP server + tool handlers |
| `.corum/packs/` | Template pack definitions |
| `docs/adr/` | Architecture decisions—read before changing core abstractions |

## State & Stability Defaults

Every node and edge has `state` (`draft|proposed|agreed|future|removed|implemented`, default `proposed`) and `stability` (`unstable|stable|deprecated`, default `unstable`). Always include these fields when creating nodes/edges.
