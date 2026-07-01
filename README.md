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

## Commands

### `corum mcp`

Start the MCP stdio server. Also starts a web UI by default.

```bash
corum mcp [options]

Options:
  --no-web          Suppress the web UI
  --watch           Reload graph on file changes
  --graph <path>    Override the graph directory
```

### `corum web`

Start the web UI only.

```bash
corum web [options]

Options:
  --port <n>        Port to listen on (default: 3000)
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

The interchange format is self-describing — no component mapping strategy is needed. Node IDs, template names, and field references are already corum-native. Gaps reported by the extractor (unresolved types, name collisions) are surfaced as warnings.

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

**Precedence (highest to lowest):** CLI flags → environment variables → `.corum/config.yaml`

| Config key | Environment variable | Description |
|---|---|---|
| `pack_registry` | - | URL of the pack registry YAML (set by `corum init`) |
| `source` | `CORUM_SOURCE` | `file` (default) or `git` |
| `graph` | `CORUM_GRAPH_PATH` | Path to the graph directory |
| `git_local_path` | `CORUM_GIT_LOCAL_PATH` | Local git repo path |
| `git_remote_url` | `CORUM_GIT_REMOTE_URL` | Remote git repo URL |
| `git_branch` | `CORUM_GIT_BRANCH` | Branch to load |
| `git_poll_seconds` | `CORUM_GIT_POLL_SECONDS` | Polling interval for remote git |
| `git_token` | `CORUM_GIT_TOKEN` | Auth token for private repos |
| `git_username` | `CORUM_GIT_USERNAME` | Auth username (default: `x-access-token`) |

### File source (default)

```yaml
# .corum/config.yaml
source: file
graph: .corum/graph
```

### Git source

```yaml
# .corum/config.yaml
source: git
git_remote_url: https://github.com/org/design-repo
git_branch: main
git_poll_seconds: 30
```

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
| `get_cluster` | Return a root node, its descendants, included external nodes, and edges |
| `get_graph` | Return the semantic graph as `{ nodes, edges }`, excluding structural templates and structural edges by default |
| `get_lineage` | Traverse lineage from one or more start nodes with depth, direction, and edge/node-type filters |
| `get_graph_summary` | Return high-level graph statistics: node count, component count, orphan breakdown, edge counts, diagnostics |
| `search_nodes` | Fuzzy-search root-level nodes by ID, with optional template filters and property search |
| `get_linked_fields` | Return `maps-to` edges touching fields owned by a root node |
| `list_branches` | List available branches and their load status from the configured source |
| `diff_branch` | Diff a branch against the default branch |

All tools accept an optional `format` argument: `yaml` (default), `json`, or `toon`. All tools also accept `compact_keys: true` to shorten common keys before serialization, reducing token usage.

Common notes:
- `branch` is supported on graph-query tools when Corum is running against a source-backed graph.
- `list_nodes` is a breaking-change surface from older builds: use `filter.templates` instead of top-level `template`.
- `search_nodes` accepts `queries: string[]`.
- `get_lineage` accepts `node_ids: string[]`, `depth`, `direction`, `edge_types`, `node_types`, `exclude_node_types`, `include_dangling_edges`, and `reads_outbound_only`.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, test, and local development instructions.
