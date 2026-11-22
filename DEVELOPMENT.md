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

## Testing a branch

Test from your own worktree or checkout, never against a hosted instance:

```bash
npm ci && npm test
CORUM_GRAPH_PATH=fixtures/sample-graph CORUM_WEB_PORT=0 npm run web   # UI check on a free port
```

Use a Docker sandbox only when a change needs isolation, such as importing untrusted specs or
write-session tests against a throwaway git repo.

## Browser tests

Install Chromium and its OS dependencies once, then run the same browser suite used by pull request CI:

```bash
npx playwright install --with-deps chromium
npm run test:web
```

This builds the project and starts a local server on port 3002 against the sample graph and fixture plugins. The specs cover mobile navigation, history, focus, reduced motion, resizing, dashboard/graph layouts, plugins, and table scrolling. Set `CORUM_E2E_PORT` to use another port.

Failures retain screenshots and traces in `test-results/`. Open a trace with `npx playwright show-trace <path-to-trace.zip>`. CI also generates an HTML report and uploads it with the failure diagnostics as `browser-failure-diagnostics`, retained for seven days. Download and extract the artifact, then run `npx playwright show-report <path-to-playwright-report>` to inspect the report.

## PR screenshots

A pull request that changes how the web UI looks embeds before/after screenshots in its body. GitHub has no API for attaching images to a PR, so images are stored on the never-merged `pr-assets` branch and embedded by commit SHA. Do not commit screenshots to the PR branch: squash merge would put them in `main`.

Convention:
- **Where:** branch `pr-assets` (create it as an orphan branch if missing), directory `pr-<number>/`. Never merge it.
- **Names:** `<page>-<theme>-<before|after>.png`, for example `graph-dark-after.png`. Keep each under 600 KB.
- **Standard capture:** `fixtures/sample-graph`, 1280 x 800 viewport, light and dark, for Dashboard (`/#/dashboard`), Explorer (`/#/namespaces`), Graph (`/#/p/graph/view`) and any page the change touches. Capture `before` from `origin/main`.
- **Embed:** under a "Screenshots" heading in the PR body, using SHA-pinned URLs so they survive branch deletion: `![graph dark after](https://raw.githubusercontent.com/atolis-hq/corum/<commit-sha>/pr-<number>/graph-dark-after.png)`.
- If screenshots cannot be produced, say so in the PR body with the reason.

Tooling that captures and publishes these is a planned follow-up; until then capture with Playwright (`@playwright/test` is already a dependency) and push with plain git.

## Namespace metadata

Namespace metadata may be declared in `nodes/<namespace>/namespace.yaml`:

```yaml
kind: journey
description: Customer ordering journey
```

The loader keeps parsed declarations in `graph.namespaceDeclarations`.
`getNamespaces(graph)` derives current namespaces from declarations and node ID
prefixes, defaulting to kind `component`. Declarations are metadata, not nodes. Kind IDs
are exact strings; unknown kinds are retained with a warning and use generic display.
Packs may register kinds and labels through `kinds.yaml`; `component` is always available. Saves, imports, and working-session writes
preserve declaration files verbatim and do not create files for undeclared namespaces.
