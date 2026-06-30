# Dashboard Page Design

**Date:** 2026-06-30
**Branch:** feat/ui-dashboard (branched from main)

## Overview

Build the first version of the dashboard page, which is currently a placeholder (`<h1>Dashboard</h1>`). The dashboard gives users an at-a-glance picture of the graph they are viewing: how many nodes and edges exist, how they are distributed, and — when on a non-default branch in gitMode — how the current branch differs from the default.

---

## 1. Layout

### Hero strip — four stat cards (full width, top of page)

Left to right:

| Card | Value |
|------|-------|
| Components | Unique component values across all nodes |
| Nodes | Total node count |
| Edges | Total semantic edge count |
| Orphan Nodes | Nodes with no semantic edges (inbound or outbound) |

Each card: large number, muted label beneath.

### Branch diff callout (gitMode only, viewingRef ≠ default branch)

Shown immediately below the hero strip when applicable:

```
⎇ feat/my-branch vs main   +4 added   −1 removed
```

Derived from `/api/overlay/:viewingRef`. Counts nodes whose `ghostState` indicates presence only on the viewing branch (added) or only on the default branch (removed).

### Detail grid — two columns, below the callout

| Left column | Right column |
|-------------|--------------|
| Nodes by Type | State Distribution |
| Edge Types | Stability Distribution |
| Diagnostics | Branch Health (gitMode only) |

**Nodes by Type:** List of template name + node count + template colour dot, sorted descending by count. Only templates that have at least one node are shown. Core templates (`template.info.core === true`) are excluded — consistent with how `/api/nodes` filters by default.

**Edge Types:** List of semantic edge type + count, sorted descending. Types shown: `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`. Only types with count > 0 are shown.

**Diagnostics:** If `diagnosticCount > 0`, shows a warning with the count. Otherwise shows a green "No issues" indicator.

**State Distribution:** Count pill per state value (`draft`, `proposed`, `agreed`, `future`, `removed`, `implemented`). Uses the same `StateTag` colour classes already in the CSS. Only states with count > 0 are shown.

**Stability Distribution:** Count pill per stability value (`unstable`, `stable`, `deprecated`). Uses `StabilityTag` colour classes. Only values with count > 0 shown.

**Branch Health (gitMode only):** List of all branches with a pass/fail indicator. Failed branches show the first diagnostic message as a subtitle. Sourced from `branchResults` prop already available in App.

---

## 2. API

### New endpoint: `GET /api/stats`

**Query params:** `?ref=<branch>` (optional, same pattern as all other endpoints)

**Response:**

```json
{
  "nodeCount": 45,
  "componentCount": 5,
  "orphanNodeCount": 7,
  "edgesByType": {
    "triggers": 3,
    "produces": 5,
    "reads": 2,
    "calls": 4,
    "implements": 1,
    "maps-to": 8,
    "derived-from": 0
  },
  "diagnosticCount": 0
}
```

**Server-side computation:**

- `nodeCount`: `graph.nodesById.size`
- `componentCount`: unique `node.component` values across all nodes
- `orphanNodeCount`: nodes that appear in neither `edgesByFrom` nor `edgesByTo` for any semantic edge type (`triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`)
- `edgesByType`: scan `edgesByFrom`, count by `edge.type` for semantic types only
- `diagnosticCount`: `graph.diagnostics.length`

Respects `?ref=` via `getGraphForRef` (same pattern as `/api/nodes`, `/api/templates`, `/api/graph`).

---

## 3. Data Flow

**Props passed from `App` to `DashboardPage`:**
- `nodes` — already loaded; used for client-side node/component counts and detail breakdowns
- `templates` — used for Nodes by Type colour dots
- `gitMode` — controls branch diff callout and Branch Health panel visibility
- `viewingRef` — the currently selected branch ref
- `branches` — used to find the default branch ref (`branch.isDefault`)
- `branchResults` — used for Branch Health panel

**DashboardPage API calls:**
1. `GET /api/stats?ref=<viewingRef>` on mount and when `viewingRef` changes — provides edge counts, orphan count, diagnostic count
2. `GET /api/overlay/<viewingRef>` — only when `gitMode && viewingRef !== defaultBranch` — provides added/removed node counts

**Render strategy:** Hero node/component counts derive from `nodes` prop instantly (no loading state). Edge count and orphan count show a placeholder until the stats API call resolves. Branch diff callout shows only after overlay call resolves.

---

## 4. Styling

New CSS classes added to `style.css`:

- `.dashboard` — page container, padding, max-width centred
- `.dashboard-hero` — flex row, gap between cards
- `.hero-card` — individual stat card; border, rounded, padding; large number + label
- `.branch-diff-callout` — horizontal strip below hero; branch name + added/removed counts
- `.dashboard-grid` — two-column CSS grid for detail panels
- `.dashboard-panel` — individual detail panel; matches `.card` visual style (border, radius, head/body)
- `.stat-row` — row within a detail panel (label left, count right)

The hero cards and detail panels use existing CSS variables (`--paper`, `--paper-2`, `--rule`, `--ink`, `--ink-3`, `--accent`, `--ok`) for consistency with the rest of the UI.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `src/web/server.ts` | Add `GET /api/stats` endpoint |
| `web/app.jsx` | Pass props to `DashboardPage`; implement `DashboardPage` component |
| `web/style.css` | Add dashboard layout and panel styles |

---

## 6. Out of Scope

- Clicking stat cards/rows to navigate (e.g. clicking a template row to filter the components view)
- Historical trend data or sparklines
- Node-level list of orphans (counts only for now)
- Branch diff list of specific added/removed nodes (counts only)
- Edge counts filtered by component
