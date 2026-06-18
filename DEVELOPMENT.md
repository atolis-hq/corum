# Development

## Requirements

- Node.js 24 or newer
- npm

## Install

From the repository root:

```bash
npm install
```

## Build

Compile TypeScript sources into `dist/`:

```bash
npm run build
```

## Test

Run the full test suite:

```bash
npm test
```

This compiles the project and runs the Node test runner against all `*.test.js` files under `dist/test/`. The fixture graph used by the tests is in `fixtures/sample-graph`. The tests verify that it loads as 45 nodes and 38 edges.

Run a single test file:

```bash
npm run build
node --test dist/test/loader.test.js
```

Type-check without emitting:

```bash
npx tsc --noEmit
```

## Run Locally

Build first, then use the CLI against the sample fixture:

```bash
npm run build
node dist/src/bin/corum.js mcp --graph fixtures/sample-graph
```

Or use the npm scripts directly (these use `node dist/src/mcp/index.js` and `node dist/src/web/server.js`):

```bash
CORUM_GRAPH_PATH=fixtures/sample-graph npm run mcp
CORUM_GRAPH_PATH=fixtures/sample-graph CORUM_WEB_PORT=3001 npm run web
```

On Windows (PowerShell):

```powershell
$env:CORUM_GRAPH_PATH = "fixtures/sample-graph"
$env:CORUM_WEB_PORT = 3001
npm run web
```

## Git Source

To run against a local git repository:

```bash
CORUM_SOURCE=git CORUM_GIT_LOCAL_PATH=/path/to/repo CORUM_GIT_BRANCH=main npm run mcp
```

To run against a remote repository:

```bash
CORUM_SOURCE=git CORUM_GIT_REMOTE_URL=https://github.com/org/repo CORUM_GIT_BRANCH=main npm run mcp
```

## MCP Smoke Test

Run a local MCP client against the configured server and print graph data:

```bash
npm run mcp:smoke
```

The smoke test starts the MCP server over stdio and calls `list_nodes`, `list_nodes` filtered to `APIEndpoint`, `get_cluster` for `orders.DomainModel.order`, and `get_linked_fields` for `orders.DomainModel.order`.

## MCP Client Config (local build)

The repo includes a project-level `.mcp.json` pointing at the compiled output:

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

Build the project before using this from an MCP client.
