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

Regenerate importer golden fixtures after an intentional output change:

```bash
npm run test:update-golden
```

Review the fixture diffs, then run `npm test` without update mode.

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
- **Names:** any `<subject>-<variant>-<before|after>.png`, for example `orders-card-mobile-dark-after.png`. Only the `-before.png` / `-after.png` suffix is required; subject and variant are free-form (letters, digits, `.`, `_`, `-`). Keep each under 600 KB.
- **What to capture:** only what the change affects. Capture the pages, components or states that show the change, and skip any page it cannot have touched (a change to one card does not need Dashboard, Explorer and Graph). Capture `before` from `origin/main`, on `fixtures/sample-graph`, in light and dark. Use 1280 x 800 for desktop. Also capture the states the change introduces: an open menu or popover, hover, focus, empty or error.
- **Mobile:** if the change is likely to affect narrow screens, include mobile captures too (`devices['Pixel 5']`, or a 375 x 812 viewport), with any menu or popover open. Treat it as likely when the change touches the nav rail or other shell chrome, menus, popovers or overlays, tables, grids or cards, layout or spacing CSS, or anything under a `@media (max-width: ...)` rule, and when the change is new UI. Check that nothing is clipped, off-screen or unreachable at 375 px. If you judge mobile unaffected, say so in one line under the Screenshots heading.
- **Embed:** under a "Screenshots" heading in the PR body, using SHA-pinned URLs so they survive branch deletion. The publish command builds this for you.
- If screenshots cannot be produced (for example the browser cannot be installed offline), say so in the PR body with the reason.

### Publish

Put the PNGs in a directory (default `tmp/screenshots`, which is gitignored), then:

```bash
npm run screenshots:publish -- --pr <number> [--dir tmp/screenshots] [--update-pr]
```

This clones the remote into a temp directory, creates or updates the orphan `pr-assets` branch, replaces `pr-<number>/` with the files, pushes, and prints the SHA and the "Screenshots" markdown (one before/after row per subject). With `--update-pr` it also replaces or appends the `## Screenshots` section in the PR body using `gh pr edit`. Rerunning for the same PR replaces the images and the section rather than duplicating them. The whole batch is refused if any file is not a PNG, lacks the `-before.png`/`-after.png` suffix, or exceeds 600 KB. A subject with only one side (a new page has no `before`) is allowed and shown with `—`.

`--remote <name-or-url>` (default `origin`) and `--repo owner/name` exist for testing against a local bare repository. Only publish to `origin` for a real PR.

### Capture

Capturing is plain Playwright, so nothing is restricted. Prerequisites on any machine, CI or agent sandbox:

```bash
npm ci
npx playwright install chromium
```

On Linux the browser also needs system libraries: use `npx playwright install --with-deps chromium` as root, or run `npx playwright install-deps chromium` once in the image or setup script. The browser is cached per user and reused after the first download.

Serve the sample graph:

```bash
npm run build
CORUM_GRAPH_PATH=fixtures/sample-graph CORUM_WEB_PORT=3100 npm run web
```

One-line capture. A device name defaults to that device's own browser (iPhone devices use WebKit), so pass `--browser=chromium` with a Chromium-based device such as `Pixel 5`, or install the other browser:

```bash
npx playwright screenshot --viewport-size=1280,800 --wait-for-timeout=1000 \
  "http://localhost:3100/#/dashboard" tmp/screenshots/dashboard-light-after.png
npx playwright screenshot --browser=chromium --device="Pixel 5" --wait-for-timeout=1000 \
  "http://localhost:3100/#/dashboard" tmp/screenshots/dashboard-mobile-light-after.png
```

`--color-scheme=light|dark` sets `prefers-color-scheme`, but the host does not follow it today: the page ships `<html data-theme="light">` and ADR-011 themes are selected by that attribute. To capture another theme, set the attribute from a script.

For one component, a theme, or an open menu, use a small script (`tmp/capture.mjs`, gitignored):

```js
import { chromium } from '@playwright/test'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
await page.goto('http://localhost:3100/#/dashboard')
await page.waitForLoadState('networkidle')
await page.evaluate(() => document.fonts.ready)
// Select a theme by name (the host reads it from <html data-theme>).
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'))
await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important}' })
await page.locator('.dashboard-panel').first().screenshot({ path: 'tmp/screenshots/dashboard-panel-light-after.png' })
await browser.close()
```

Run it with `node tmp/capture.mjs`. Use `page.hover()`, `page.click()` or a mobile `devices['Pixel 5']` context from `@playwright/test` for hover, open-menu and mobile states. For stable images, wait for fonts and network idle, disable animations (as above), and if a tiny pixel difference appears between runs, rerun once before treating it as a real change.

For the `before` images, build `origin/main` in a second worktree and serve it on another port:

```bash
git fetch origin main
git worktree add --detach tmp/base origin/main
ln -s "$PWD/node_modules" tmp/base/node_modules
(cd tmp/base && npx tsc)
(cd tmp/base && CORUM_GRAPH_PATH=fixtures/sample-graph CORUM_WEB_PORT=3101 node dist/src/web/server.js) &
# capture the same pages from http://localhost:3101 as <name>-before.png, then stop the server
git worktree remove --force tmp/base
```

Remove the worktree even if a step fails.

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
