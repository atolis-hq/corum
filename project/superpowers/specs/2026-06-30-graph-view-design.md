# Graph View Design

**Date:** 2026-06-30  
**Branch:** feat/ui-graph

## Overview

Add an interactive graph section to the Corum web UI that visualises nodes and their semantic edges across three drill-down levels: component map → component interior → node focus. The view is a zoomable, pannable canvas using React Flow with Dagre hierarchical layout.

---

## 1. API

### New endpoint: `GET /api/graph`

Returns all graph nodes whose template is not a structural/leaf type, plus all semantic edges between them in one payload. "Cluster-root" here means the top-level nodes you navigate to in the components section — the server filters by template name, not by parentId, so child nodes that happen to be top-level in a different context are excluded consistently.

**Excluded node templates (server-side):** `Schema`, `EnumDefinition`, `Field`, `EnumValue`, `Mapping`

**Included edge types:** `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`  
**Excluded edge types:** `has-field`, `has-value`, `renamed-from`

**Response shape:**
```json
{
  "nodes": [
    { "id": "string", "template": "string", "component": "string", "state": "string", "stability": "string" }
  ],
  "edges": [
    { "id": "string", "from": "string", "to": "string", "type": "string" }
  ]
}
```

Supports `?ref=<branch>` query param (same pattern as `/api/nodes`).

Data is loaded once on graph mount. All three drill-down levels are computed client-side from this payload — no additional API calls when navigating between levels.

---

## 2. Libraries

Both loaded via CDN `<script>` tags in `index.html` — no build tooling required, consistent with existing stack.

- **React Flow v11** (UMD build) — node/edge canvas, pan/zoom, minimap, node selection
- **Dagre** — hierarchical graph layout computation (left-to-right BFS layering by in-degree)

Both are MIT licensed.

---

## 3. Three-Level Navigation

### Level 1 — Component Map (default)

- One card per component
- Edges between components derived by collapsing cross-component semantic edges: if any nodes in component A have edges to nodes in component B, show a component-to-component edge labelled with the set of edge types present (deduped)
- Component card shows: component name (large), node count ("5 nodes")
- Clicking a component card drills to Level 2

### Level 2 — Component Interior

- Shows all cluster-root nodes within the selected component
- Cross-component edges from these nodes to external nodes are shown with faded (50% opacity) external node stubs at canvas edges
- Clicking a node card drills to Level 3

### Level 3 — Node Focus

- Shows the focal node and its neighbours
- Depth control (toolbar): **1-hop** | **2-hop** | **Full chain** (transitive closure)
- Clicking a different node in the canvas re-focuses on it (stays at Level 3)
- Focal node search selector (fuzzy match, reusing logic from `search.jsx`) to switch focal node without navigating back up

### Breadcrumb

Sits above the canvas toolbar at all levels. Each segment is clickable:

```
Graph  >  orders  >  order
```

Back arrow also available. Clicking "Graph" returns to Level 1.

---

## 4. URL State & Routing

The graph section is a new named route. Level and selection are encoded in the URL so links are shareable and browser back/forward works.

| URL | State |
|-----|-------|
| `#/graph` | Level 1 — component map |
| `#/graph?component=orders` | Level 2 — orders component interior |
| `#/graph?focus=orders.DomainModel.order` | Level 3 — node focus |

Branch prefix works as normal: `#/main/graph?focus=...`

**Changes to `router.js`:** add `/graph` to `KNOWN_PATHS`.

**Changes to `app.jsx`:**
- Add "Graph" to `NavRail` (icon: `diagram-project`, after "Models")
- Add `/graph` route handler rendering `<GraphView>`
- Hide `NavTree` sidebar on the graph section (graph is full-width)
- `activeSection` logic extended to include `'graph'`

---

## 5. Node Cards

Rendered as React Flow custom node components. All three levels use the same card design, scaled to context.

**Card anatomy (top to bottom):**
- Left edge: 3px colour bar using `template.ui.colour` from pack YAML (same source as nav and template badges)
- Header row: `TemplateBadge` (template display name, coloured) + `StateTag`
- Body: node display name (last segment of ID, bold, 14px) + component name (muted, 11px — visible at all levels)
- Footer: `StabilityTag` + `↗` external link icon (right-aligned)

**`↗` external link:** navigates to `#/node?id=<nodeId>` in the components section (opens the existing node detail page). Does not use React router — sets `window.location.hash` directly.

**Click target:** clicking anywhere on the card body (excluding the `↗` icon) triggers graph navigation (drill down at Level 2, re-focus at Level 3).

**Level 1 component cards:** slightly larger, no template badge, show component name as title + node count subtitle.

**States:**
- Default: white background, `var(--rule)` border, `var(--radius)` corners
- Hover: subtle box-shadow elevation
- Selected (focal node at Level 3): `var(--accent)` border ring (2px)

---

## 6. Edge Rendering

React Flow handles SVG paths and arrowheads. Edge colours are consistent with the existing `EDGE_TYPE_STYLES` in `app.jsx` — the same pill colours used in the Connections panel.

| Edge type | Stroke colour | Style |
|-----------|---------------|-------|
| `triggers` | `#b45309` (amber) | solid |
| `produces` | `#0f766e` (teal) | solid |
| `calls` | `#6d28d9` (purple) | solid |
| `implements` | `#475569` (slate) | solid |
| `reads` | `#1d4ed8` (blue) | solid |
| `maps-to` | `#be185d` (rose) | solid |
| `derived-from` | `#6b7280` (grey) | dashed |

Edge labels show the edge type name, small (10px), centred on the curve. At Level 1 (component map), labels show the set of edge types collapsed (e.g. "triggers, calls").

Cross-component external node stubs at Level 2: edges rendered at 50% opacity.

> **Future enhancement:** Allow pack YAML to define edge type UI metadata (colour, label) — this would require adding edge type definitions to the pack schema, analogous to how template `ui.colour` is currently configured.

---

## 7. Toolbar

Sits above the canvas, below the breadcrumb.

**All levels:**
- Edge type toggle pills — one per semantic edge type. Active = filled pill (matching edge colour), inactive = ghost pill. Clicking toggles that edge type on/off globally across the canvas.
- Toggle state persisted to `localStorage` under key `corum:graphEdgeTypes`.
- Minimap toggle button (right side) — shows/hides React Flow's built-in `<MiniMap>`.
- Layout reset button — re-runs Dagre and fits the canvas to the viewport.

**Level 3 only (additional controls):**
- Depth selector: **1-hop** | **2-hop** | **Full chain** — segmented control
- Focal node search input: fuzzy match across all graph nodes, selecting a result re-focuses the canvas on that node

---

## 8. Links from Existing UI

### EdgePanel (Connections panel)

Each edge row gets a `diagram-project` icon link at the right that navigates to `#/graph?focus=<linkedNodeId>`. This opens the graph at Level 3 focused on the linked node. The icon uses the same `Icon` primitive, at size 12, styled muted until hover.

### Node detail page header

The header row (next to name, template badge, state/stability tags) gets a "Graph" link — `diagram-project` icon + "Graph" text — that navigates to `#/graph?focus=<thisNodeId>`.

---

## 9. File Structure

| File | Change |
|------|--------|
| `web/index.html` | Add React Flow + Dagre CDN script tags |
| `web/graph.jsx` | New — `GraphView` component, exports `window.CorumGraph` |
| `web/style.css` | Add graph canvas and card styles |
| `web/app.jsx` | NavRail item, route, sidebar logic, EdgePanel link, node header link |
| `web/router.js` | Add `/graph` to `KNOWN_PATHS` |
| `src/web/server.ts` | Add `/api/graph` endpoint |

---

## 10. Out of Scope

- Physics-based force simulation layout (Dagre hierarchical only)
- Editing nodes/edges from the graph view
- Exporting the graph as an image
- Pack-configurable edge colours (noted as future enhancement above)
