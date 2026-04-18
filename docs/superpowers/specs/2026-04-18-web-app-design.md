# Web App Design — 2026-04-18

## Overview

Add a browser-based web UI to the Corum MCP server. The UI reads graph data via a REST API served by the same process, driven entirely by templates and node data — no hardcoded layouts per template type.

## Architecture

The MCP stdio process grows an optional Express HTTP server running concurrently in the same Node.js process. The graph is loaded once and shared between both the MCP handlers and the web API handlers.

**Entry points:**
- `npm run mcp` — MCP stdio + web server (default)
- `npm run mcp -- --no-web` — MCP stdio only
- `npm run web` — web server only (no MCP stdio); loads graph itself

**Port:** `3000` by default, overridable via `CORUM_WEB_PORT`.

**Web server enabled by default.** Disabled with `--no-web` flag.

## File Structure

```
src/
  web/
    server.ts          # Express HTTP server, API routes, static file serving
  mcp/
    index.ts           # existing — calls startWebServer() unless --no-web

web/                   # frontend (CDN React + Babel, no build step)
  index.html           # shell: loads React, Babel, style.css, plugins, app.jsx
  app.jsx              # router, nav shell, page components
  primitives.jsx       # Icon, StateTag, StabilityTag, Chip, SchemaCard — adapted from wireframes
  style.css            # design tokens + layout — adapted from wire.css
  plugins/             # empty; drop .jsx files here to override node rendering

docs/
  adr/
    001-web-app-tech-stack.md
```

## REST API

All endpoints are read-only GET. Served at `/api/*`.

| Endpoint | Graph function | Notes |
|---|---|---|
| `GET /api/templates` | `listTemplates` | Core templates excluded by default. `?includeCore=true` to include. |
| `GET /api/nodes` | `listNodes` | Supports `?template=`, `?component=`, `?state=`, `?stability=` filters. No filter returns all nodes. |
| `GET /api/nodes/:nodeId/cluster` | `getCluster` | `nodeId` is URL-encoded. |
| `GET /api/plugins` | — | Lists `.jsx` filenames found in `web/plugins/`. |
| `GET /health` | — | Returns `{ ok: true }`. |

**Core template filtering:** Templates with `core: true` are excluded server-side from `/api/templates`. This covers `Schema`, `Field`, `Enum`, `EnumValue`, and any other core templates. The frontend never needs to filter these.

**Data loading strategy:** On app startup, the frontend makes two calls — `GET /api/templates` and `GET /api/nodes` (unfiltered) — and builds the full nav tree client-side. Node detail pages lazy-load `GET /api/nodes/:nodeId/cluster` on demand.

## UI Structure

### Top Bar
BrandMark SVG + "corum" text. Nothing else. No search, no user, no breadcrumb.

### Side Nav (2-pane)
**Pane 1 (72px icon rail):** Two hardcoded items — Dashboard and Components. Active item gets inverted treatment.

**Pane 2 (220px, visible when Components is active):** Scrollable tree.
- Sections are components (e.g. "orders"), each collapsible
- Under each component: template groups, styled with `template.ui.colour` as left-accent
- Under each template group: individual nodes listed by display name (last segment of `node.id` after the final `.`)
- Node list items show name only — no state or stability badges
- Active node highlighted

### Pages

**Dashboard (`/`):** `<h1>Dashboard</h1>` only.

**Components (`/components`):** `<h1>Components</h1>` only.

**Node page (`/nodes/:nodeId`):**
- **Header strip** (fixed fields only): template name (badge coloured with `template.ui.colour`), component, state, stability, last modified. No arbitrary properties here.
- **Properties card:** Full-width key/value table of `node.properties`. All properties shown here regardless of template type.
- **Schemas card** (if cluster has children): Child nodes grouped by template, each rendered as a simple field table of the child's own properties.
- No relationships section. No signals section.

### Design rationale for node page
`node.properties` is unbounded and varies per template. Putting it in a fixed header strip doesn't scale. The header shows only the small set of guaranteed-present fields (`template`, `component`, `state`, `stability`, `lastModifiedAt`). All template-specific data lives in the Properties card below.

## Plugin System

Plugins are `.jsx` files dropped into `web/plugins/`. The server scans that directory on startup and exposes the list via `GET /api/plugins`. The frontend loads each file as a `<script>` tag before mounting the app.

### Plugin contract

```js
window.CorumPlugins = window.CorumPlugins || {};
window.CorumPlugins['TemplateName'] = function CustomNode({ node, cluster, template }) {
  // node: Node object
  // cluster: { root, children, edges } from getCluster
  // template: full Template object including ui config
  return <div>custom rendering</div>;
};
```

When the node page renders, it checks `window.CorumPlugins[node.template]` first. If found, that component renders. Otherwise the generic node page renders.

**Shared components:** Key primitives (e.g. `SchemaCard`) will be exported on `window.CorumPrimitives` so plugins can reuse them. Not implemented in the initial build — the contract is established so plugins remain forward-compatible.

The registry key (template name string) is the only coupling point between the core app and plugins. This contract is stable across future migrations to a bundler.

## Not in scope (initial build)

- Branch bar / branch selector
- User journeys, delivery, graph explorer nav items
- Relationships section on node pages
- Signals section on node pages
- Search
- Any plugin implementations
