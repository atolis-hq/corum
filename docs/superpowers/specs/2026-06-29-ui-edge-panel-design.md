# UI Edge Panel Design

**Date:** 2026-06-29  
**Branch:** feat/ui-edge-panel  
**Status:** Approved

## Overview

Add a collapsible `EdgePanel` to the `NodePage` that shows all cross-cluster semantic edges (triggers, produces, calls, implements) for the selected node. The panel appears between the meta strip and the Properties card, with a collapsed summary row showing edge counts and an expanded two-column layout for full detail.

## Data

### API change

The `NodePage` fetch is extended to also request `triggers`, `produces`, `calls`, and `implements` in the `includeEdges` parameter:

```
/api/cluster?nodeId=...&includeEdges=maps-to,reads,triggers,produces,calls,implements
```

The server (`getClusterView`) already handles these types — it collects both outbound edges (from cluster nodes) and inbound edges (to cluster nodes) for any requested type. No backend changes are required. The linked nodes appear in `includedNodes`; their template, state, and stability are available there.

### Edge classification

Edges are partitioned by checking the root node ID (and its descendants by prefix):

- **Inbound**: `edge.to` is within the cluster (root or descendant), `edge.from` is outside
- **Outbound**: `edge.from` is within the cluster, `edge.to` is outside

Only the four semantic types are shown in the panel. `maps-to` and `reads` continue to be used for field-level linking in `SchemaCard` but are not shown in `EdgePanel`. `has-field`, `has-value`, `derived-from`, and `renamed-from` are excluded entirely.

## Component: `EdgePanel`

### Placement

Rendered in `NodePage` between the meta strip and the Properties card. Not rendered at all if both inbound and outbound counts are zero.

### Collapsed state (default)

A single-row slim header:

```
Connections   ← 1 inbound   → 3 outbound   ⌄
```

- Chevron toggles open/closed
- Expanded state persisted in `localStorage` under key `'corum:edgePanelOpen'`

### Expanded state

A full-width card body with a two-column grid:

| Inbound (left) | Outbound (right) |
|---|---|
| Nodes that point *to* this node | Nodes this node points *to* |

Each column renders a list of edge rows. If a direction has no edges, the column shows "None" as an empty-state message so the grid does not collapse asymmetrically.

### Edge row

Each row in a column:

```
[TemplateBadge]  NodeDisplayName  [edge-type chip]  [StateTag]  [StabilityTag]
```

- `NodeDisplayName`: last dot-segment of the node ID; full ID shown on `title` tooltip
- `TemplateBadge`: uses the same component and template colour as elsewhere in the UI; template looked up from `templates` prop already in scope in `NodePage`
- Edge-type chip: styled with the existing `tag` CSS class; each type gets a distinct muted colour via inline style map:
  - `triggers` → amber
  - `produces` → teal
  - `calls` → violet
  - `implements` → slate
- `StateTag` and `StabilityTag`: existing components, sourced from the linked node (found in `includedNodes`)
- Clicking anywhere on the row calls `onNavigate(linkedNodeId)`

## No backend changes

All required data is already produced by `getClusterView` when the additional edge types are passed via `includeEdges`. No new API endpoints or server-side logic needed.

## CSS

No new CSS classes required. The panel uses the existing `.card`, `.card-head`, `.card-body` classes for the container, and existing `tag` classes for edge-type chips. The two-column layout uses an inline `display: grid; grid-template-columns: 1fr 1fr; gap: 16px` style on the card body.

## Out of scope

- `derived-from`, `renamed-from`, `has-field`, `has-value` edge types — not shown
- Edge notes field — not shown in this iteration
- Filtering or sorting edges within the panel
