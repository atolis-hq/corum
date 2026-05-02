<div width="100%" align="center">
<img src="assets/corum-logo.svg" width="120" height="120" /><br>
 <h1>Corum</h1>
</div>

Corum loads design graph files from disk into an in-memory graph and exposes the graph through MCP tools.

## Requirements

- Node.js 20 or newer
- npm

## Install

From the repository root:

```powershell
npm install
```

This installs TypeScript, the MCP SDK, and YAML parsing dependencies.

## Build

Compile the TypeScript sources into `dist/`:

```powershell
npm run build
```

The build command runs `tsc`.

## Test

Run the full test suite:

```powershell
npm test
```

This compiles the project and runs the Node test runner against:

- `test/schema.test.ts`
- `test/loader.test.ts`
- `test/graph.test.ts`
- `test/mcp.test.ts`
- `test/writer.test.ts`
- `test/serializer.test.ts`

The fixture graph used by the tests is in `fixtures/sample-graph`. The tests verify that it loads as `45` nodes and `38` edges.

## Run The MCP Server

Build first:

```powershell
npm run build
```

Run the MCP server against the default graph path:

```powershell
npm run mcp
```

By default, the server loads:

```text
.corum/graph
```

To run it against the sample graph fixture instead:

```powershell
$env:CORUM_GRAPH_PATH = "fixtures/sample-graph"
npm run mcp
```

To reload the in-memory graph when graph YAML or template YAML files change, pass `--watch` to the built server:

```powershell
node dist/src/mcp/index.js --watch
```

The same watcher can be enabled for the web server with `node dist/src/web/server.js --watch`, or for either server by setting `CORUM_FILE_WATCHER=true`.

Starting with powershell
```
 $env:CORUM_GRAPH_PATH = "fixtures/sample-graph";
 $env:CORUM_WEB_PORT = 3001;
 $env:CORUM_FILE_WATCHER="true";
 npm run web
```

To run the web app against a git repository instead of a filesystem graph path, set `CORUM_SOURCE=git` before starting the app.

For a local git repository:

```powershell
$env:CORUM_SOURCE = "git"
$env:CORUM_GIT_LOCAL_PATH = "C:\git\atolis-hq\corum-design-graph"
$env:CORUM_GIT_BRANCH = "main"
$env:CORUM_GIT_POLL_SECONDS = 10
$env:CORUM_WEB_PORT = 3001
npm run web
```

For a remote repository:

```powershell
$env:CORUM_SOURCE = "git"
$env:CORUM_GIT_REMOTE_URL = "https://github.com/org/design-repo.git"
$env:CORUM_GIT_BRANCH = "main"
$env:CORUM_GIT_POLL_SECONDS = 10
$env:CORUM_WEB_PORT = 3001
npm run web
```

For private remote repositories, also set `CORUM_GIT_TOKEN`. `CORUM_GIT_USERNAME` defaults to `x-access-token` when a token is present.

The same git source config is used by `npm run mcp`. Git-backed startup expects graph files in `.corum/graph` and template packs in `.corum/packs`, and loads the selected branch at process start.

`CORUM_GIT_POLL_SECONDS` is optional. When set to a positive number of seconds, the web server polls the git source for branch/ref changes, invalidates its cached multi-branch view, and reloads the app automatically. If it is not set, git-backed content is not polled.

`CORUM_FILE_WATCHER` only watches filesystem graph paths. It does not watch git refs. For git-backed web sessions, you can either enable `CORUM_GIT_POLL_SECONDS` or use the always-visible `Reload` button in the branch bar to force a refresh.

The MCP server exposes these tools:

- `list_nodes`: lists graph nodes, optionally filtered by `template`, `component`, `state`, or `stability`
- `list_templates`: lists loaded graph templates with summary metadata
- `get_template`: returns full details for a loaded graph template
- `get_cluster`: returns a root node, owned child nodes, and edges inside that cluster
- `get_linked_fields`: returns `maps-to` edges touching fields owned by a root node

Each tool accepts an optional `format` argument:

- `yaml`: default, human-readable YAML
- `json`: pretty JSON
- `toon`: TOON output via the official `@toon-format/toon` encoder for lower token use

Each tool also accepts `compact_keys: true` to shorten common graph keys before serialization. This works with all formats:

```text
id -> i
template -> t
component -> cp
state -> s
stability -> st
schemaVersion -> sv
lastModifiedAt -> lm
extractedFrom -> xf
properties -> p
root -> r
children -> ch
edges -> e
nodes -> n
from -> fr
to -> to
type -> ty
notes -> nt
```

## MCP Client Configuration

This repo includes a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "corum": {
      "command": "node",
      "args": ["dist/src/mcp/index.js"],
      "env": {
        "CORUM_GRAPH_PATH": "fixtures/sample-graph"
      }
    }
  }
}
```

Build the project before using this config from an MCP client:

```powershell
npm run build
```

The checked-in config points at `fixtures/sample-graph` so the tools return sample nodes immediately. Change `CORUM_GRAPH_PATH` to `.corum/graph` when you have graph component files there.

## MCP Smoke Test

Run a local MCP client against the configured server and print graph data:

```powershell
npm run mcp:smoke
```

The smoke test starts the MCP server over stdio and calls:

- `list_nodes`
- `list_nodes` filtered to `APIEndpoint`
- `get_cluster` for `orders.DomainModel.order`
- `get_linked_fields` for `orders.DomainModel.order`

## Useful Development Commands

Type-check without emitting files:

```powershell
npx tsc --noEmit
```

Run one compiled test file after building:

```powershell
npm run build
node --test dist/test/loader.test.js
```

Clean generated build output manually if needed:

```powershell
Remove-Item -Recurse -Force dist
```
