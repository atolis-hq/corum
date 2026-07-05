# CLAUDE.md

## What This Is

Corum is a Git-native design graph for service architecture. It models components (APIs, domain models, schemas, fields) as nodes with typed edges, exposed via MCP tools. The Git repo is the database; no external infrastructure.

## Commands

```bash
npm run build          # tsc -> dist/
npm test               # build + Node test runner
npm run mcp            # start stdio MCP server (default graph: .corum/graph)
npm run web            # start Express web UI
node --test dist/test/loader.test.js  # run single test file
node dist/src/bin/corum.js lint       # lint the graph (template/property/edge-type rules)
node dist/src/bin/corum.js import --config <yaml> [-b <branch>]  # import specs; git sources require a target branch
```

## Architecture

**Load pipeline** (`src/loader/`): packs -> clusters -> edges -> in-memory `Graph` (Maps keyed by node ID / edge endpoints). `loadPacks()` topologically sorts templates by inheritance before cluster parsing.

**Clusters vs. Nodes**: A cluster YAML file defines a root node. Template `ownedSections` (e.g. DomainModel owns `schemas`, `enums`) cause child nodes to be materialized inline; one YAML block becomes multiple `Node` objects with auto-generated structural edges (`has-field`, `has-value`).

**Node IDs** follow ownership hierarchy: `orders.DomainModel.order.schemas.order.fields.id`. The dot path encodes the full parent chain. The grammar (`src/loader/id-grammar.ts`) is enforced at load: dot-separated segments of `[A-Za-z0-9_-]`, `__` reserved for edge IDs, roots are `component.Template.name`. Owned children carry a materialized `parentId`.

**Edges** are either structural (auto-generated from template ownership) or explicit (declared in `edges/**/*.yaml`, optionally with `properties:`). Edge IDs: `{from}__{type}__{to}`. The type vocabulary is pack-extensible: core types are declared in `CORE_EDGE_TYPES` (`src/loader/constants.ts`); packs add more via `edge-types.yaml` with a `category` (`structural|semantic|lineage`) that drives engine behavior (summary counts, lineage defaults, collapse filtering). Core types: `triggers`, `produces`, `reads`, `uses-type`, `calls`, `implements`, `maps-to`, `derived-from`, `renamed-from`, `has-field`, `has-value`.

**Templates** (`src/loader/pack-loader.ts`) live in `.corum/packs/*/templates/*.yaml` and can extend other templates. Core pack provides base types; domain/rest/messaging packs extend them. Templates may declare `info.role` (`field|value|type-container|enum-container|mapping`), resolved through the extends chain - engine behavior (schema collapse, field lineage, structural classification) keys off roles, never template names, so `AvroSchema extends Schema` inherits Schema's engine behavior.

**Linter** (`src/linter/index.ts`): validates node properties against template schemas, explicit edges against template `edge-types:` constraints, and edge properties against pack edge-type schemas. Runs on every load; diagnostics are warnings (strict mode only throws on errors).

**MCP tools** (`src/mcp/index.ts`): reads - `list_nodes`, `list_templates`, `get_template`, `get_cluster`, `get_graph`, `get_graph_metadata`, `get_lineage`, `get_graph_summary`, `search_nodes`, `get_linked_fields`, `list_branches`, `diff_branch`; writes (thin wrappers over `src/mutate/`) - `start_changes`, `apply_cluster`, `create_node`, `update_node`, `rename_node`, `delete_node`, `create_edges`, `update_edge`, `delete_edge`, `create_fields`, `pending_changes`, `discard_changes`, `commit_changes`. While a working session is open, reads serve the session's working graph. `rename_node` is the only rename path; `apply_cluster` and imports never infer renames.

**Mutation engine** (`src/mutate/`): all graph mutations live here - rename cascade with `previousNames` + hidden `renamed-from` trail edges (alias map gives cross-branch/import resolution of retired IDs), soft/hard delete tiers gated by default-branch presence, and the working session (`session.ts`: validate-before-apply, journal, autosave WIP checkpoints, guarded squash at `commit_changes`).

**Serialization** (`src/mcp/serializers.ts`): YAML (default), JSON, or TOON (compact token format). `compact_keys` shortens common keys (`id->i`, `template->t`, etc.) to reduce token usage. MCP omits node provenance by default; node-returning tools accept `include_provenance: true` when codebase/source bridging is needed. `get_lineage` is lean by default and omits `edges` unless `include_edges: true`.

**Error handling**: Load errors are collected as diagnostics and bundled in `LoadError`; not thrown per-item unless `strict: true`. Query failures throw `QueryError` immediately.

## Key Files

| Path | Role |
|------|------|
| `src/schema/index.ts` | Core types: Node, Edge, Graph, Template, State, Stability, EdgeTypeDef |
| `src/loader/index.ts` | Load orchestrator |
| `src/loader/cluster-loader.ts` | Node materialization from cluster YAML |
| `src/loader/id-grammar.ts` | Node ID grammar: validation + sanitization |
| `src/graph/roles.ts` | Template role resolution (capability contract) |
| `src/graph/index.ts` | Query functions (listNodes, getCluster, getLinkedFields) |
| `src/linter/index.ts` | Lint rules (property/edge-type validation) |
| `src/mcp/index.ts` | MCP server + tool handlers |
| `.corum/packs/` | Template pack definitions |
| `docs/adr/` | Architecture decisions; read before changing core abstractions |

## State & Stability Defaults

Every node and edge has `state` (`draft|proposed|agreed|future|removed|implemented`, default `proposed`) and `stability` (`unstable|stable|deprecated`, default `unstable`). Always include these fields when creating nodes or edges.

## Runtime Config

Corum loads runtime config from `.corum/config.yaml`, then overlays environment variables, then CLI flags. Source selection lives in `src/source/config.ts`.

- `CORUM_SOURCE`: `file` / `filesystem` / `fs` (default) or `git`
- `CORUM_GRAPH_PATH`: filesystem graph path
- `CORUM_GIT_LOCAL_PATH` or `CORUM_GIT_REMOTE_URL`: exactly one for git mode
- `CORUM_GIT_BRANCH`: default branch ref for git-backed reads
- `CORUM_GIT_POLL_SECONDS`: git poll interval for web reloads
- `CORUM_GIT_TOKEN` / `CORUM_GIT_USERNAME`: remote git auth
- `CORUM_WEB_PORT`: default web port
- `CORUM_FILE_WATCHER` or `CORUM_WATCH`: enable filesystem watch mode for the web server

Write-session defaults differ by source:
- filesystem source: autosave defaults on
- git source: autosave defaults off
