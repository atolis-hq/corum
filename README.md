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

The MCP server exposes these tools:

- `list_nodes`: lists graph nodes, optionally filtered by `template`, `component`, `state`, or `stability`
- `get_cluster`: returns a root node, owned child nodes, and edges inside that cluster
- `get_linked_fields`: returns `maps-to` edges touching fields owned by a root node

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
