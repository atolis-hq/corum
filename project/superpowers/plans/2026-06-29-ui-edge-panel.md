# UI Edge Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible EdgePanel to NodePage showing inbound and outbound semantic edges (triggers, produces, calls, implements) in a two-column layout.

**Architecture:** Extend the existing `/api/cluster` fetch to request the four semantic edge types. All data comes back in the existing `edges` + `includedNodes` arrays — no backend changes needed. A new `EdgePanel` component classifies edges as inbound/outbound and renders a collapsible card with a two-column grid. Wired into `NodePage` between the meta strip and the Properties card.

**Tech Stack:** React 18 (UMD, browser), JSX via Babel standalone, FontAwesome icons, existing CSS classes (`.card`, `.card-head`, `.card-body`, `.tag`, `.label-xs`, `.label-sm`).

## Global Constraints

- No backend changes — `getClusterView` already handles the new edge types when passed via `includeEdges`
- No new CSS classes — use existing `.card`, `.card-head`, `.card-body`, `.tag`, `.label-xs`, `.label-sm`
- No new files — all changes are in `web/app.jsx`
- Existing `TemplateBadge`, `StateTag`, `StabilityTag`, `Icon` primitives from `window.CorumPrimitives`
- localStorage key for panel open state: `'corum:edgePanelOpen'`
- Edge types shown in panel: `triggers`, `produces`, `calls`, `implements` only
- `maps-to`, `reads`, `has-field`, `has-value`, `derived-from`, `renamed-from` are NOT shown in the panel

---

### Task 1: Extend cluster fetch and add edge classification helper

**Files:**
- Modify: `web/app.jsx` (fetch URL in `NodePage`, add `classifyEdges` helper near top of file)

**Interfaces:**
- Produces: `classifyEdges(edges, clusterIds)` → `{ inbound: Edge[], outbound: Edge[] }`
  - `edges`: array of edge objects with shape `{ id, from, to, type, state, stability }`
  - `clusterIds`: `Set<string>` of node IDs belonging to the cluster (root + all descendants)
  - Returns edges where `type` is one of `triggers|produces|calls|implements` only
  - `inbound`: edges where `to` is in `clusterIds` and `from` is not
  - `outbound`: edges where `from` is in `clusterIds` and `to` is not

- [ ] **Step 1: Extend the fetch URL in `NodePage`**

In `web/app.jsx`, find the fetch call inside the `NodePage` `useEffect` (line ~438). Change:

```js
fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}&includeEdges=maps-to,reads${refParam}${overlayParam}`)
```

to:

```js
fetch(`/api/cluster?nodeId=${encodeURIComponent(nodeId)}&includeEdges=maps-to,reads,triggers,produces,calls,implements${refParam}${overlayParam}`)
```

- [ ] **Step 2: Add `PANEL_EDGE_TYPES` constant and `classifyEdges` helper**

Add these two items in `web/app.jsx` immediately after the destructuring of `window.CorumPrimitives` (after line ~13, before `function displayName`):

```js
const PANEL_EDGE_TYPES = new Set(['triggers', 'produces', 'calls', 'implements']);

function classifyEdges(edges, clusterIds) {
  const inbound = [];
  const outbound = [];
  for (const edge of edges) {
    if (!PANEL_EDGE_TYPES.has(edge.type)) continue;
    if (clusterIds.has(edge.from) && !clusterIds.has(edge.to)) {
      outbound.push(edge);
    } else if (!clusterIds.has(edge.from) && clusterIds.has(edge.to)) {
      inbound.push(edge);
    }
  }
  return { inbound, outbound };
}
```

- [ ] **Step 3: Start the dev server and verify the API response includes semantic edges**

```bash
npm run web
```

Open the browser to `http://localhost:3000`, navigate to any node that you know has cross-cluster edges. Open browser DevTools → Network tab, find the `/api/cluster` request for that node. Confirm the response's `edges` array contains entries with `type` values like `triggers`, `produces`, `calls`, or `implements`, and that `includedNodes` contains the linked nodes.

Expected: edges array includes entries with semantic types; the linked nodes appear in `includedNodes`.

- [ ] **Step 4: Commit**

```bash
git add web/app.jsx
git commit -m "feat: extend cluster fetch to include semantic edge types"
```

---

### Task 2: Add EdgePanel component and wire into NodePage

**Files:**
- Modify: `web/app.jsx` (add `EDGE_TYPE_STYLES` constant, add `EdgePanel` component, wire into `NodePage`)

**Interfaces:**
- Consumes: `classifyEdges(edges, clusterIds)` from Task 1
- Consumes: `TemplateBadge`, `StateTag`, `StabilityTag`, `Icon` from `window.CorumPrimitives`
- `EdgePanel` props:
  - `inbound`: `Edge[]` — edges where `to` is in the cluster
  - `outbound`: `Edge[]` — edges where `from` is in the cluster
  - `allNodes`: `Node[]` — all nodes to look up linked node metadata; pass `[root, ...descendants, ...includedNodes]`
  - `templates`: template objects array (already in scope in `NodePage`)
  - `onNavigate`: `(nodeId: string) => void`

- [ ] **Step 1: Add `EDGE_TYPE_STYLES` constant**

Add this immediately after `PANEL_EDGE_TYPES` in `web/app.jsx`:

```js
const EDGE_TYPE_STYLES = {
  triggers: { background: '#fef3c7', color: '#b45309' },
  produces: { background: '#ccfbf1', color: '#0f766e' },
  calls: { background: '#ede9fe', color: '#6d28d9' },
  implements: { background: '#f1f5f9', color: '#475569' },
};
```

- [ ] **Step 2: Add `EdgePanel` component**

Add the following component in `web/app.jsx` immediately before `function NodePage` (around line ~426):

```jsx
function EdgePanel({ inbound, outbound, allNodes, templates, onNavigate }) {
  const { useState: useLocalState } = React;
  const [open, setOpen] = useLocalState(() => {
    try { return localStorage.getItem('corum:edgePanelOpen') === 'true'; } catch { return false; }
  });

  if (inbound.length === 0 && outbound.length === 0) return null;

  function toggle() {
    setOpen(prev => {
      const next = !prev;
      try { localStorage.setItem('corum:edgePanelOpen', String(next)); } catch {}
      return next;
    });
  }

  const nodeMap = new Map(allNodes.map(n => [n.id, n]));
  const templateMap = new Map(templates.map(t => [t.name, t]));

  function EdgeRow({ edge, linkedNodeId }) {
    const node = nodeMap.get(linkedNodeId);
    const tmpl = node ? templateMap.get(node.template) : null;
    const colour = tmpl?.ui?.colour ?? null;
    const name = linkedNodeId.split('.').pop();
    return (
      <div
        onClick={() => onNavigate(linkedNodeId)}
        title={linkedNodeId}
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}
      >
        <TemplateBadge name={tmpl?.ui?.displayName ?? node?.template ?? '?'} colour={colour} />
        <span style={{ fontWeight: 500, fontSize: 13 }}>{name}</span>
        <span className="tag" style={EDGE_TYPE_STYLES[edge.type] ?? {}}>{edge.type}</span>
        {node && <StateTag state={node.state} />}
        {node && <StabilityTag stability={node.stability} />}
      </div>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div
        className="card-head"
        onClick={toggle}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, userSelect: 'none' }}
      >
        <span>Connections</span>
        {inbound.length > 0 && <span className="label-sm">← {inbound.length} inbound</span>}
        {outbound.length > 0 && <span className="label-sm">→ {outbound.length} outbound</span>}
        <span style={{ marginLeft: 'auto' }}><Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} /></span>
      </div>
      {open && (
        <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div className="label-xs" style={{ marginBottom: 8 }}>Inbound</div>
            {inbound.length === 0
              ? <span className="label-sm">None</span>
              : inbound.map(edge => <EdgeRow key={edge.id} edge={edge} linkedNodeId={edge.from} />)
            }
          </div>
          <div>
            <div className="label-xs" style={{ marginBottom: 8 }}>Outbound</div>
            {outbound.length === 0
              ? <span className="label-sm">None</span>
              : outbound.map(edge => <EdgeRow key={edge.id} edge={edge} linkedNodeId={edge.to} />)
            }
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire EdgePanel into NodePage**

In `NodePage`, after the line `const { root, descendants, includedNodes, edges } = cluster;` (line ~448), add:

```js
const clusterIds = new Set([root.id, ...descendants.map(d => d.id)]);
const { inbound: panelInbound, outbound: panelOutbound } = classifyEdges(edges, clusterIds);
```

Then in the JSX return of `NodePage`, add `<EdgePanel>` between the closing `</div>` of the meta strip and the Properties card check. The meta strip closes with `</div>` around line ~507. Insert after it:

```jsx
      <EdgePanel
        inbound={panelInbound}
        outbound={panelOutbound}
        allNodes={[root, ...descendants, ...includedNodes]}
        templates={templates}
        onNavigate={onNavigate}
      />
```

The relevant section of `NodePage`'s return should look like this after the edit:

```jsx
      <div className="meta-strip">
        {[
          ['Component', root.component],
          ['State', root.state],
          ['Stability', root.stability],
          ['Schema version', root.schemaVersion],
          ['Last modified', root.lastModifiedAt],
        ].map(([label, value]) => (
          <div key={label} className="meta-cell">
            <div className="label-xs">{label}</div>
            <div style={{ fontSize: 12, marginTop: 3 }}>{value}</div>
          </div>
        ))}
      </div>

      <EdgePanel
        inbound={panelInbound}
        outbound={panelOutbound}
        allNodes={[root, ...descendants, ...includedNodes]}
        templates={templates}
        onNavigate={onNavigate}
      />

      {Object.keys(root.properties ?? {}).length > 0 && (
        <div className="card">
```

- [ ] **Step 4: Visual verification**

With the dev server running (`npm run web`), navigate to a node that has cross-cluster semantic edges.

Expected behaviours to check:
1. A "Connections" bar appears below the meta strip, showing counts like `← 1 inbound → 2 outbound`
2. Clicking the bar expands a two-column card (Inbound left, Outbound right)
3. Each edge row shows: template badge, node name, coloured edge-type chip, state tag, stability tag
4. Clicking a row navigates to the linked node
5. For a node with zero semantic edges, the panel does not render at all
6. Collapse/expand state persists across page refreshes (localStorage)

- [ ] **Step 5: Run backend tests to confirm nothing broken**

```bash
npm test
```

Expected: all tests pass (the suite tests the loader/graph layer, not the UI — this step just confirms the fetch URL change didn't break anything server-side).

- [ ] **Step 6: Commit**

```bash
git add web/app.jsx
git commit -m "feat: add EdgePanel to NodePage for inbound/outbound semantic edges"
```
