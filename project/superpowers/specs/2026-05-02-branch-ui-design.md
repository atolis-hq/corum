# Branch UI Design

**Date:** 2026-05-02  
**Branch:** MultiBranchUI  
**Status:** Approved for implementation

## Overview

Add a persistent branch bar to the web UI that lets users switch viewing branches and overlay incoming branches from other refs. Extend the API and MCP tools to accept a `ref` parameter for branch-aware queries. The filesystem (non-git) mode is unaffected — it degrades gracefully to today's single-graph behaviour.

---

## 1. Mode Detection

The app calls `GET /api/branches` on startup.

- **Git source configured → 200**: git mode. Branch bar is visible; URLs use branch prefix; `ref` params are active.
- **No source configured → 501**: filesystem mode. Branch bar is hidden; URLs are plain (no prefix); `ref` params are silently ignored.

No other detection logic is needed. The 501 is already returned by the existing server code.

---

## 2. Layout

```
┌─────────────────────────────────────────────┐  48px  TopBar (unchanged)
├─────────────────────────────────────────────┤  38px  BranchBar (git mode only)
│  NavRail │  NavTree  │  Content             │  flex  Main area (unchanged structure)
└─────────────────────────────────────────────┘
```

The `BranchBar` is a new component rendered between `TopBar` and the `main` div. It spans the full window width. In filesystem mode it is not rendered — no empty space is left.

---

## 3. BranchBar Component

```
⎇  Viewing  [main]  overlaid with  [feat/checkout-v2 ×]  [feat/loyalty-api ×]  [+ 3 more ▾]     [Single | Selected | Consolidated]
```

**Left side:**
- Branch icon + "Viewing" label
- Active chip showing `viewingRef` — clicking opens a branch picker popover listing all available branches; selecting one changes `viewingRef`
- "overlaid with" label (hidden in Single mode)
- Accent chips for each active `overlayRef` with `×` to remove — visible in Selected and Consolidated modes
- `+ N more ▾` ghost chip when branches exist beyond those shown — clicking opens the picker to add more

**Right side:**
- Segment control: `Single | Selected | Consolidated`
  - **Single**: no overlay; only the viewing branch is shown
  - **Selected**: overlay is the explicit set of `overlayRefs` chosen by the user
  - **Consolidated**: overlay is all branches except `viewingRef` (auto-populated)

**State (session-only, not in URL):**
- `overlayRefs: string[]`
- `overlayMode: 'single' | 'selected' | 'consolidated'`

---

## 4. Routing

### 4.1 Centralised routing module — `web/router.js`

All URL construction and parsing goes through two pure functions:

```js
// Returns { branch, pathname, params }
// git mode:  '#/main/node?id=X'        → { branch: 'main', pathname: '/node', params }
// fs mode:   '#/node?id=X'             → { branch: null,   pathname: '/node', params }
parseRoute(hash)

// Returns hash string
// branch = 'main'  → '#/main/node?id=X'
// branch = null    → '#/node?id=X'
buildRoute({ pathname, params, branch })
```

Branch names containing `/` are percent-encoded as a single URL segment (e.g. `feat/checkout-v2` → `feat%2Fcheckout-v2`). Encoding and decoding is handled exclusively inside these two functions.

### 4.2 App routing changes

`App` stores `viewingRef` (string | null). All `navigate()` calls are replaced with:

```js
navigate(buildRoute({ pathname, params, branch: viewingRef }))
```

`parseRoute` is updated to handle both URL forms. The branch extracted from the URL on load is used to set initial `viewingRef` — falling back to the default branch from `/api/branches` if the URL has no prefix or the branch is unrecognised.

---

## 5. API Changes

All changes are additive and backward-compatible. Omitting `ref` falls back to the loaded default graph in both modes.

### 5.1 Updated endpoints

| Endpoint | New params | Behaviour when `ref` provided |
|---|---|---|
| `GET /api/nodes` | `?ref=` | Load branch graph via `loadMultiGraph`, return nodes for that ref |
| `GET /api/templates` | `?ref=` | As above, return templates for that ref |
| `GET /api/cluster` | `?ref=`, `?overlayRefs=` | Cluster for `ref`; when `overlayRefs` is a comma-separated list, also compute ghost data (see §5.2) |

When no `source` is configured, `?ref=` is ignored and the server uses the loaded graph as normal. No error is returned.

### 5.2 Cluster overlay response shape

When `overlayRefs` is provided to `/api/cluster`, the response gains a top-level `overlay` field:

```json
{
  "root": { ... },
  "descendants": [ ... ],
  "includedNodes": [ ... ],
  "edges": [ ... ],
  "overlay": {
    "viewingRef": "main",
    "overlayRefs": ["feat/checkout-v2"],
    "fields": [
      {
        "id": "orders.DomainModel.order.schemas.order.fields.idempotencyKey",
        "ghostState": "ghost-single",
        "sourceRef": "feat/checkout-v2",
        "node": { ... }
      }
    ]
  }
}
```

`overlay` is `null` when `overlayRefs` is empty or absent. The server uses the existing `computeOverlay()` function from `src/graph/overlay.ts` and filters the result to nodes relevant to the active overlay refs. Included ghost states: `local-modified` (viewing branch node that differs on an incoming branch), `ghost-single`, `ghost-consensus`, `ghost-conflict`, `default-only`. Excluded: `local` (only on viewing branch, no incoming counterpart) and `shared` (identical on all branches, no change to surface).

### 5.3 Unchanged endpoints

`GET /api/branches`, `GET /api/overlay/:ref`, `GET /api/events`, `GET /api/plugins` — no changes.

---

## 6. Nav Tree Changes

- Nav tree always shows nodes from `viewingRef` only (no ghost nodes in the nav)
- Nodes that appear in the overlay data for active `overlayRefs` get a signal dot
- Dot colour matches the overlay branch colour (first accent colour for first overlay branch, second for second, etc.)
- Multiple dots are shown if multiple overlay branches affect the same node (up to 2; `+N` label beyond that)
- Signal dots are driven by a separate `GET /api/overlay/:ref` fetch (existing endpoint) that the app fires whenever `overlayRefs` becomes non-empty or `viewingRef` changes. The response is filtered client-side: a node gets a dot if its `branches` array intersects with the active `overlayRefs`. This is one fetch per branch/overlay change, not per nav node.

---

## 7. Node Detail View — Ghost Rows

When `overlayRefs` is non-empty (Selected or Consolidated mode), `NodePage` fetches the cluster with `?overlayRefs=...` included. The `SchemaCard` component receives an `overlayFields` prop.

Ghost rows are rendered **inline** within the existing field table, after the last normal field in the same schema section:

- Left border stripe coloured by source branch
- Row background tinted to match (subtle, ~4% opacity)
- Field name italicised, opacity reduced
- Type shown as-is from the incoming branch
- State tag from the incoming branch
- Conflict rows: red stripe, `⚠` prefix, `conflict` badge instead of state tag

A legend bar appears above the field table when ghost rows are present, showing which stripe colour maps to which branch.

Conflict detection reuses `ghostState === 'ghost-conflict'` from the overlay computation.

---

## 8. MCP Tool Changes

All changes are additive. When no `source` is configured, `ref` is silently ignored.

| Tool | New params | Behaviour |
|---|---|---|
| `list_nodes` | optional `ref` | Returns nodes from the specified branch graph |
| `list_templates` | optional `ref` | Returns templates from the specified branch graph |
| `get_cluster` | optional `ref`, optional `overlayRefs` (array) | Cluster for ref; includes ghost field data when `overlayRefs` provided |
| `get_linked_fields` | optional `ref` | Resolves maps-to edges from the specified branch graph |

`list_branches` and `diff_branch` are unchanged.

---

## 9. Files Affected

| File | Change |
|---|---|
| `web/router.js` | **New** — `parseRoute`, `buildRoute` |
| `web/app.jsx` | BranchBar component; `viewingRef`/`overlayRefs`/`overlayMode` state; routing update; `?ref=` on all fetches |
| `web/primitives.jsx` | No change (BranchBar lives in app.jsx initially) |
| `web/style.css` | Branch bar layout styles; ghost row styles; signal dot styles |
| `src/web/server.ts` | `?ref=` handling on `/api/nodes`, `/api/templates`, `/api/cluster`; overlay cluster response shape |
| `src/mcp/index.ts` | `ref` + `overlayRefs` params on four tools |
| `test/web.test.ts` | Tests for `?ref=` on nodes/templates/cluster; overlay cluster response |
| `test/mcp.test.ts` | Tests for `ref` param on affected tools |

---

## 10. Out of Scope

- "Pull incoming field" action (ghost row CTA) — design only; not implemented in this iteration
- Rich diff and split pane overlay modes — ghost mode only in this iteration; diff/split are future
- Persisting overlay selection across sessions (localStorage) — session-only for now
- Writing/committing changes from the UI
