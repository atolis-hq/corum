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

Scaffold a config file in your project:

```bash
corum init
```

This creates `.corum/config.yaml` with commented defaults. Edit it to point at your graph directory or git repository, then start the MCP server:

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

Scaffold `.corum/config.yaml` with commented defaults. Does not overwrite an existing file.

```bash
corum init
```

### `corum import`

Import specifications into the graph.

```bash
corum import --config <path>    Import using a config YAML file
```

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

## Configuration

Run `corum init` to generate a `.corum/config.yaml` with all available options. Corum walks up from the current directory to find it, so you can place it at your project root.

**Precedence (highest to lowest):** CLI flags → environment variables → `.corum/config.yaml`

| Config key | Environment variable | Description |
|---|---|---|
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
| `list_nodes` | List graph nodes, optionally filtered by `template`, `component`, `state`, or `stability` |
| `list_templates` | List loaded templates with summary metadata |
| `get_template` | Return full details for a template |
| `get_cluster` | Return a root node, its owned children, and internal edges |
| `get_linked_fields` | Return `maps-to` edges touching fields owned by a root node |

All tools accept an optional `format` argument: `yaml` (default), `json`, or `toon`. All tools also accept `compact_keys: true` to shorten common keys before serialization, reducing token usage.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for build, test, and local development instructions.
