# Corum

Corum is a Git-native design graph for service architecture. It models components (APIs, domain models, schemas, fields) as nodes with typed edges, and exposes the graph through MCP tools so AI assistants can reason about your architecture.

## Install

```bash
npm install -g @atolis-hq/corum
```

Or run without installing:

```bash
npx @atolis-hq/corum <command>
```

**Windows:** If you see an "execution policy" error in PowerShell, run this once:

```powershell
Set-ExecutionPolicy RemoteSigned -Scope CurrentUser
```

This is a standard one-time setup step for Node.js development on Windows. Alternatively, `npx @atolis-hq/corum <command>` works without any setup on all platforms.

## Update

```bash
npm update -g @atolis-hq/corum
```

## Quick Start

Scaffold a new project in the current directory:

```bash
corum init
```

This creates `.corum/config.yaml`, scaffolds a graph at `.corum/graph/`, and downloads the official template packs (`core`, `domain`, `rest`, `messaging`). Then start the MCP server:

```bash
corum mcp
```

If you only want the web UI:

```bash
corum web
```

## Commands

### `corum mcp`

Start the MCP stdio server. Also starts a web UI by default.

```bash
corum mcp [options]

Options:
  --no-web          Suppress the web UI
  --watch           Reload file-backed graphs on local file changes
  --graph <path>    Override the graph directory
```

Notes:
- `corum mcp` starts the web UI unless you pass `--no-web`.
- `--watch` applies to filesystem graphs. Git-backed graphs reload through polling instead.

### `corum web`

Start the web UI only.

```bash
corum web [options]

Options:
  --port <n>        Port to listen on (default: 3000)
  --graph <path>    Override the graph directory
```

Notes:
- Filesystem graphs can be watched for local YAML changes with `CORUM_FILE_WATCHER=true` or `CORUM_WATCH=true`.
- Git-backed graphs reload through polling when `git_poll_seconds` / `CORUM_GIT_POLL_SECONDS` is set.

### `corum lint`

Lint the graph and report diagnostics.

```bash
corum lint [options]

Options:
  --graph <path>    Override the graph directory
```

### `corum init`

Scaffold a `.corum/` project structure and install the four default template packs (`core`, `domain`, `rest`, `messaging`). Skips any step where the target already exists.

```bash
corum init
```

Creates:
- `.corum/config.yaml` - project configuration
- `.corum/graph/graph.yaml` - graph definition
- `.corum/graph/components/` and `.corum/graph/edges/` - empty directories ready for nodes
- `.corum/packs/` - downloaded template packs
- `.corum/packs.yaml` - local manifest of installed packs

### `corum pack install`

Install a template pack from the registry into `.corum/packs/`. Appends the pack to `.corum/graph/graph.yaml` and records it in `.corum/packs.yaml`.

```bash
corum pack install <name>          # install latest tag
corum pack install <name>@<ref>    # install a specific tag
```

Examples:

```bash
corum pack install domain
corum pack install domain@v0.1.5
corum pack install extract   # required for corum-extract import adapter
```

### `corum pack list`

List installed packs with their resolved version and install date.

```bash
corum pack list
```

### `corum import`

Import specifications into the graph.

```bash
corum import --config <path>    Import using a config YAML file
```

#### Import config file

The `--config` flag accepts a YAML file that can combine multiple imports in a single run and configure cross-adapter options:

```yaml
# Optional: remap extracted component names before node IDs are built.
# Useful when the same component appears under different names in different specs
# (e.g. "order-shipping" from a URI segment vs "ordershipping" from a topic name).
componentNameReplacements:
  - from: ordershipping
    to: order-shipping

# Optional: deduplicate nodes emitted by different adapters after all imports
# complete. For each rule, keep nodes from the primary adapter and merge/drop
# matching nodes from the secondary adapter.
deduplication:
  - primary: openapi
    secondary: corum

imports:
  - adapter: openapi
    spec: ./specs/order-shipping.openapi.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0

  - adapter: asyncapi
    spec: ./specs/order-shipping.asyncapi.yaml
    componentMapping:
      strategy: channel-segment
      separator: "."
      segment: 0
    messageNaming:
      strategy: name-segment
      separator: "."
      segment: -1
```

Replacements are applied in order; the first matching `from` wins. Unmatched names are passed through unchanged.
Deduplication rules are applied after all adapters finish. They are intended for
cross-adapter reconciliation, for example keeping OpenAPI endpoints as canonical
while merging matching extractor-emitted Corum nodes into them.

#### `corum import openapi <spec>`

Import an OpenAPI spec directly.

```bash
corum import openapi <spec> [options]

Options:
  --component-strategy <strategy>   Component mapping: uri-segment (default), tag, hardcoded
  --segment <n>                     URI segment index (uri-segment strategy)
  --pattern <regex>                 Regex pattern (uri-segment strategy)
  --component <name>                Component name (hardcoded strategy)
  --graph <path>                    Override the graph directory
```

#### `corum import asyncapi <spec>`

Import an AsyncAPI spec directly.

```bash
corum import asyncapi <spec> [options]

Options:
  --component-strategy <strategy>   Component mapping: channel-segment (default), channel-pattern,
                                    name-segment, name-pattern, tag, hardcoded
  --separator <char>                Separator for segment strategies (default: .)
  --segment <n>                     Segment index (negative counts from end)
  --pattern <regex>                 Regex pattern for pattern strategies
  --component <name>                Component name (hardcoded strategy)
  --event-classification <mode>     always-integration (default) or always-domain
  --include-consumed                Also import receive (consumed) operations
  --graph <path>                    Override the graph directory
```

#### `corum import corum <spec>`

Import a corum interchange file (`*.corum.yaml`) produced by `corum-extract` or compatible extraction tooling.

```bash
corum import corum <spec> [options]

Options:
  --graph <path>    Override the graph directory
```

The interchange format is self-describing - no component mapping strategy is needed. Node IDs, template names, and field references are already corum-native. Gaps reported by the extractor (unresolved types, name collisions) are surfaced as warnings.

Requires the `extract` pack to be active in your graph:

```bash
corum pack install extract
```

You can also configure corum imports in a config file:

```yaml
# .corum/imports.yaml
imports:
  - adapter: corum
    spec: path/to/output.corum.yaml
```

## Configuration

Run `corum init` to generate a `.corum/config.yaml` with all available options. Corum walks up from the current directory to find it, so you can place it at your project root.

**Precedence (highest to lowest):** CLI flags -> environment variables -> `.corum/config.yaml`

| Config key | Environment variable | Description |
|---|---|---|
| `pack_registry` | - | URL of the pack registry YAML (set by `corum init`) |
| `source` | `CORUM_SOURCE` | Source mode: `file` / `filesystem` / `fs` (default) or `git` |
| `graph` | `CORUM_GRAPH_PATH` | Path to the graph directory |
| `git_local_path` | `CORUM_GIT_LOCAL_PATH` | Local git repo path |
| `git_remote_url` | `CORUM_GIT_REMOTE_URL` | Remote git repo URL |
| `git_branch` | `CORUM_GIT_BRANCH` | Default branch ref used when loading a git-backed graph |
| `git_poll_seconds` | `CORUM_GIT_POLL_SECONDS` | Poll interval, in seconds, for git-backed web reloads |
| `git_token` | `CORUM_GIT_TOKEN` | Auth token for private repos |
| `git_username` | `CORUM_GIT_USERNAME` | Auth username (default: `x-access-token`) |

Additional environment-only runtime settings:

| Environment variable | Description |
|---|---|
| `CORUM_WEB_PORT` | Default port for `corum web` |
| `CORUM_FILE_WATCHER` | Enable local file watching for filesystem graphs when running the web UI |
| `CORUM_WATCH` | Alias for `CORUM_FILE_WATCHER` |

### File source (default)

```yaml
# .corum/config.yaml
source: file
graph: .corum/graph
```

Use this when the graph lives directly on the local filesystem with no git source abstraction.

### Git source

```yaml
# .corum/config.yaml
source: git
git_remote_url: https://github.com/org/design-repo
git_branch: main
git_poll_seconds: 30
```

Or for a local git repository:

```yaml
# .corum/config.yaml
source: git
git_local_path: /path/to/repo
git_branch: main
```

Rules:
- Set exactly one of `git_local_path` or `git_remote_url`.
- `git_branch` selects the default branch Corum loads for read operations and the web UI.
- `git_poll_seconds` is only used for git-backed web reloads.

For private repositories, set `CORUM_GIT_TOKEN` as an environment variable rather than storing it in the config file.

## MCP Client Configuration

Configure your MCP client to run Corum. For Claude Code or Claude Desktop:

```json
{
  "mcpServers": {
    "corum": {
      "command": "npx",
      "args": ["@atolis-hq/corum", "mcp", "--no-web"],
      "env": {
        "CORUM_GRAPH_PATH": "/path/to/your/graph"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "corum": {
      "command": "corum",
      "args": ["mcp", "--no-web"],
      "env": {
        "CORUM_GRAPH_PATH": "/path/to/your/graph"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|---|---|
| `list_nodes` | List graph nodes using a `filter` object with `templates`, `exclude_templates`, `component`, `state`, and `stability` |
| `list_templates` | List loaded templates with summary metadata |
| `get_template` | Return full details for a template |
| `get_cluster` | Return a node's structural contents. By default, schema and enum child nodes are collapsed into compact `schemas` and `enums` blocks on the root. Pass `collapse_schemas: false` to restore the full node-per-field representation |
| `get_graph` | Return the semantic graph as `{ nodes, edges }`, excluding structural templates and structural edges by default |
| `get_graph_metadata` | Return discoverable metadata: template names, node templates in use, edge types, and valid enum values |
| `get_lineage` | Traverse lineage from one or more start nodes. Lean nodes and no `edges` by default; opt in to fuller payloads when needed |
| `get_graph_summary` | Return high-level graph statistics: node count, component count, orphan breakdown, edge counts, diagnostics |
| `search_nodes` | Fuzzy-search root-level nodes by ID, with optional template filters and property search |
| `get_linked_fields` | Return `maps-to` edges touching fields owned by a root node |
| `list_branches` | List available branches and their load status from the configured source |
| `diff_branch` | Diff a branch against the default branch |
| `start_changes` | Open a working mutation session |
| `apply_cluster` | Upsert a cluster-style document in `merge` or `replace` mode |
| `create_node` | Create a root cluster or owned child node |
| `update_node` | Patch node properties, state, or stability |
| `rename_node` | Rename a node while preserving identity trail metadata |
| `delete_node` | Soft-delete or hard-delete a node subtree |
| `create_edge` | Create an explicit edge |
| `update_edge` | Patch an explicit edge |
| `delete_edge` | Delete an explicit edge |
| `pending_changes` | Show the open session's journal and summary diff |
| `discard_changes` | Abort the working session |
| `commit_changes` | Lint, serialize, and persist the session's changes |

All tools accept an optional `format` argument: `yaml` (default), `json`, or `toon`. All tools also accept `compact_keys: true` to shorten common keys before serialization, reducing token usage.

All node-returning MCP tools accept `include_provenance: true` to include `extractedFrom`, `lastModifiedAt`, `derivation`, and `derivedBy`. These fields are omitted by default. `schemaVersion` is never returned by MCP.

Common notes:
- `branch` is supported on graph-query tools when Corum is running against a source-backed graph.
- `list_nodes` is a breaking-change surface from older builds: use `filter.templates` instead of top-level `template`.
- `search_nodes` accepts `queries: string[]`.
- `get_graph_metadata` should usually be your first call. Use `edge_types_in_use` to avoid traversing edge types that do not exist in the current graph.
- `get_graph_metadata` returns `valid_edge_types`, `states`, `stabilities`, `lineage_directions`, and `output_formats` when you pass `include_static_enums: true`.
- Prefer `search_nodes` over `list_nodes` for discovery. Use `list_nodes` when you need a full inventory under explicit filters.
- `get_lineage` accepts `node_ids: string[]`, `depth`, `direction`, `edge_types`, `node_types`, `exclude_node_types`, `include_dangling_edges`, `reads_outbound_only`, `lean`, and `include_edges`.
- `get_lineage` defaults to `lean: true` and `include_edges: false`. Lean lineage nodes contain only `id`, `origin_id`, `depth`, `via_edge_type`, and `via_node_id`.
- Pass multiple `node_ids` to `get_lineage` in one call instead of making separate traversal calls.
- Use `get_cluster` only when you need full structural contents for one node. By default it returns compact `schemas` and `enums` blocks on the root rather than individual field nodes, which keeps response size manageable for large aggregates. Use `get_lineage` for relationship traversal.
- Read tools reflect the open working session while one exists. Unbranched reads, and branch-scoped reads for that same session branch, show uncommitted changes.
- The graph reflects modeled relationships, not guaranteed complete truth. Missing edges do not prove no relationship exists; agents should treat naming and schema similarity as hypotheses and then verify via cluster inspection or source material.

## MCP Write Workflow

Corum's write tools are session-based:

1. Call `start_changes`.
2. Make one or more mutations with `apply_cluster`, `create_node`, `update_node`, `rename_node`, `delete_node`, `create_edge`, `update_edge`, or `delete_edge`.
3. Inspect the session with `pending_changes`.
4. Finish with `commit_changes` or abort with `discard_changes`.

Important behavior:
- No write tool works without an open session.
- `rename_node` is the only rename path. `apply_cluster` and imports never infer renames.
- `apply_cluster` `replace` mode is authoritative for the root's owned sections: absent children are deleted, and an absent owned section means "empty section".
- `delete_node` defaults to soft delete for nodes that already exist on the default branch, and hard delete for branch-local design work.
- `discard_changes` closes the session. On file-backed autosave sessions it does not roll back mutations already written through to disk.

Source-mode defaults:
- Filesystem source: `start_changes` defaults `autosave` on. Each mutation writes through immediately; `commit_changes` mainly lint-gates and closes the session.
- Git source: `start_changes` defaults `autosave` off. Changes stay in memory until `commit_changes`.
- Git source with `autosave: true`: each mutation creates a `corum-wip:` checkpoint commit; `commit_changes` squashes that run when no external commit interleaved.

Typical sequence:

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

## MCP Prompts

The server also exposes a discoverable MCP prompt:

| Prompt | Description |
|---|---|
| `usage-guide` | Orientation guide covering graph structure, read and write workflow, output-format choices, graph-completeness caveats, and inference guidance |

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, test, and local development instructions.
