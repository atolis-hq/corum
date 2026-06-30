# Dashboard Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first version of the dashboard page with an at-a-glance hero strip, optional branch diff callout, and a detail grid covering node types, state/stability distributions, edge types, diagnostics, and branch health.

**Architecture:** A new `GET /api/stats` server endpoint computes graph metrics (node/component/orphan counts, edge type counts, diagnostic count) server-side and returns them as JSON. The `DashboardPage` component in `app.jsx` receives `nodes`, `templates`, `gitMode`, `viewingRef`, `branches`, and `branchResults` as props from `App`, derives node/component counts client-side for instant render, and fetches `/api/stats` and (when on a non-default branch) `/api/overlay/:ref` for the remaining data. Layout uses a hero strip of four stat cards, an optional branch diff callout, and a 2-column CSS grid of detail panels.

**Tech Stack:** TypeScript (server), plain JSX loaded via Babel CDN (browser), Node built-in test runner, Express, CSS custom properties.

## Global Constraints

- All JS in `web/` is plain browser-compatible JSX — no imports, no bundler. Loaded by Babel CDN in index.html. Add new functions/components before their first use in the file.
- Tests live in `test/` and use Node's built-in test runner (`node:test`, `node:assert/strict`). Run with `npm test`.
- New endpoint follows the exact same pattern as all others in `createApp`: `app.get('/api/...', async (req, res) => { ... })`, uses `getGraphForRef` for `?ref=` support, returns JSON.
- The `SEMANTIC_EDGE_TYPES` constant already exists in `server.ts` as `GRAPH_SEMANTIC_EDGE_TYPES` (a `Set<EdgeType>`). Reuse it, do not redefine.
- `makeTestGraph()` in `test/web.test.ts` has: 7 nodes, 2 components (orders, billing), 1 `maps-to` edge (field→field), 0 diagnostics. Orphan count = 5 (the 2 nodes with `maps-to` edges are not orphans).
- `EDGE_TYPE_STYLES` is already defined near the top of `web/app.jsx`. Reference it from `DashboardPage` directly (same file scope).
- `.card-head` and `.card-body` CSS classes are already defined in `web/style.css`. Reuse them for dashboard panels.
- `{ useState, useEffect, useCallback, useMemo }` are already destructured from `React` at the top of `app.jsx`. Do not re-destructure.
- `{ StateTag, StabilityTag, Icon }` are already imported from `window.CorumPrimitives` at the top of `app.jsx`.

---

### Task 1: `GET /api/stats` endpoint

**Files:**
- Modify: `src/web/server.ts`
- Modify: `test/web.test.ts`

**Interfaces:**
- Produces: `GET /api/stats?ref=<branch>` → `{ nodeCount: number, componentCount: number, orphanNodeCount: number, edgesByType: Record<string, number>, diagnosticCount: number }`

- [ ] **Step 1: Write failing tests**

Add inside the existing `describe('web server', () => {` block in `test/web.test.ts`, after the `describe('GET /api/graph', ...)` block:

```typescript
describe('GET /api/stats', () => {
  it('returns counts matching the test graph', async () => {
    const res = await fetch(`http://localhost:${handle.port}/api/stats`)
    assert.equal(res.status, 200)
    const body = await res.json() as {
      nodeCount: number
      componentCount: number
      orphanNodeCount: number
      edgesByType: Record<string, number>
      diagnosticCount: number
    }
    assert.equal(body.nodeCount, 7)
    assert.equal(body.componentCount, 2)
    assert.equal(body.orphanNodeCount, 5)
    assert.equal(body.edgesByType['maps-to'], 1)
    assert.equal(body.edgesByType['triggers'], 0)
    assert.equal(body.diagnosticCount, 0)
  })

  it('returns all seven semantic edge type keys', async () => {
    const res = await fetch(`http://localhost:${handle.port}/api/stats`)
    const body = await res.json() as { edgesByType: Record<string, number> }
    for (const type of ['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from']) {
      assert.ok(type in body.edgesByType, `missing edge type: ${type}`)
    }
  })

  it('falls back to default graph for unknown ?ref=', async () => {
    const res = await fetch(`http://localhost:${handle.port}/api/stats?ref=nonexistent-branch`)
    assert.equal(res.status, 200)
    const body = await res.json() as { nodeCount: number }
    assert.ok(body.nodeCount > 0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test
```

Expected: new tests fail with "fetch failed" or "404" (endpoint not yet defined).

- [ ] **Step 3: Add `/api/stats` endpoint to `src/web/server.ts`**

Add after the `app.get('/api/graph', ...)` block (around line 461), inside `createApp`:

```typescript
app.get('/api/stats', async (req, res) => {
  let targetGraph = graph
  if (typeof req.query.ref === 'string' && multiCache) {
    targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
  }

  const components = new Set<string>()
  for (const node of targetGraph.nodesById.values()) {
    if (node.component) components.add(node.component)
  }

  const nodesWithEdges = new Set<string>()
  const edgesByType: Record<string, number> = {
    triggers: 0, produces: 0, reads: 0, calls: 0, implements: 0, 'maps-to': 0, 'derived-from': 0,
  }
  for (const edgeList of targetGraph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (!GRAPH_SEMANTIC_EDGE_TYPES.has(edge.type)) continue
      edgesByType[edge.type]++
      nodesWithEdges.add(edge.from)
      nodesWithEdges.add(edge.to)
    }
  }

  const orphanNodeCount = [...targetGraph.nodesById.keys()]
    .filter(id => !nodesWithEdges.has(id)).length

  res.json({
    nodeCount: targetGraph.nodesById.size,
    componentCount: components.size,
    orphanNodeCount,
    edgesByType,
    diagnosticCount: targetGraph.diagnostics.length,
  })
})
```

- [ ] **Step 4: Run tests to verify they pass**

```
npm test
```

Expected: all tests pass including the three new `/api/stats` tests.

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts test/web.test.ts
git commit -m "feat: add /api/stats endpoint"
```

---

### Task 2: Dashboard styles

**Files:**
- Modify: `web/style.css`

**Interfaces:**
- Produces: CSS classes `.dashboard-hero`, `.hero-card`, `.hero-number`, `.hero-label`, `.branch-diff-callout`, `.branch-diff-branch`, `.branch-diff-label`, `.branch-diff-added`, `.branch-diff-removed`, `.dashboard-grid`, `.dashboard-panel`, `.stat-row`, `.stat-row-label`, `.stat-row-value`, `.stat-colour-dot`

- [ ] **Step 1: Add dashboard styles to `web/style.css`**

Append at the end of the file:

```css
/* ── Dashboard ────────────────────────────────────── */

.dashboard-hero {
  display: flex;
  gap: 16px;
  margin-bottom: 24px;
}

.hero-card {
  flex: 1;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 20px 24px;
}

.hero-number {
  font-size: 32px;
  font-weight: 700;
  line-height: 1;
  color: var(--ink);
  margin-bottom: 6px;
  font-family: 'Space Grotesk', system-ui, sans-serif;
}

.hero-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--ink-3);
}

.branch-diff-callout {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--paper-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  margin-bottom: 24px;
  font-size: 12px;
}

.branch-diff-branch {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--ink-2);
}

.branch-diff-label {
  color: var(--ink-3);
  font-size: 11px;
}

.branch-diff-added {
  color: var(--ok);
  font-weight: 600;
}

.branch-diff-removed {
  color: var(--warn);
  font-weight: 600;
}

.dashboard-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.dashboard-panel {
  overflow: hidden;
  border: 1px solid var(--rule-2);
  border-radius: 8px;
  background: var(--paper);
}

.stat-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 0;
}

.stat-row-label {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-size: 12px;
}

.stat-row-value {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  flex-shrink: 0;
}

.stat-colour-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Run tests to verify nothing is broken**

```
npm test
```

Expected: all tests pass (CSS changes don't affect test assertions).

- [ ] **Step 3: Commit**

```bash
git add web/style.css
git commit -m "feat: dashboard styles"
```

---

### Task 3: DashboardPage component and App wiring

**Files:**
- Modify: `web/app.jsx`
- Modify: `test/web.test.ts`

**Interfaces:**
- Consumes:
  - `GET /api/stats?ref=` from Task 1
  - `GET /api/overlay/:ref` (existing endpoint)
  - CSS classes from Task 2
  - `StateTag`, `StabilityTag`, `Icon` from `window.CorumPrimitives` (already imported at top of `app.jsx`)
  - `EDGE_TYPE_STYLES` (already defined in `app.jsx`)
- Produces: `DashboardPage({ nodes, templates, gitMode, viewingRef, branches, branchResults })` component replacing the current stub

- [ ] **Step 1: Write failing web asset tests**

Add to `test/web.test.ts` inside the existing `describe('web assets', () => {` block:

```typescript
it('app: DashboardPage receives graph data props from App', () => {
  assert.match(app, /page = <DashboardPage/)
  assert.match(app, /nodes=\{nodes\}/)
  assert.match(app, /gitMode=\{gitMode\}/)
  assert.match(app, /viewingRef=\{viewingRef\}/)
  assert.match(app, /branches=\{branches\}/)
  assert.match(app, /branchResults=\{branchResults\}/)
})

it('app: DashboardPage fetches /api/stats and /api/overlay', () => {
  assert.match(app, /\/api\/stats/)
  assert.match(app, /\/api\/overlay\//)
})

it('style: dashboard hero and grid layout classes defined', () => {
  assert.match(styles, /\.dashboard-hero\s*\{/)
  assert.match(styles, /\.hero-card\s*\{/)
  assert.match(styles, /\.dashboard-grid\s*\{[^}]*grid-template-columns:/)
  assert.match(styles, /\.dashboard-panel\s*\{/)
})
```

- [ ] **Step 2: Run tests to verify they fail**

```
npm test
```

Expected: the three new web asset tests fail.

- [ ] **Step 3: Replace `DashboardPage` stub and add `HeroCard` in `web/app.jsx`**

Find the current stub (around line 496):
```javascript
function DashboardPage() {
  return <div className="content"><h1>Dashboard</h1></div>;
}
```

Replace the entire `DashboardPage` function with the following (add `HeroCard` first, then `DashboardPage`):

```javascript
function HeroCard({ value, label }) {
  return (
    <div className="hero-card">
      <div className="hero-number">{value}</div>
      <div className="hero-label">{label}</div>
    </div>
  );
}

function DashboardPage({ nodes, templates, gitMode, viewingRef, branches, branchResults }) {
  const [stats, setStats] = useState(null);
  const [branchDiff, setBranchDiff] = useState(null);

  const defaultBranchRef = branches.find(b => b.isDefault)?.ref ?? null;
  const isOnNonDefaultBranch = gitMode && viewingRef && defaultBranchRef && viewingRef !== defaultBranchRef;

  useEffect(() => {
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/stats${refParam}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(setStats)
      .catch(() => setStats(null));
  }, [viewingRef]);

  useEffect(() => {
    if (!isOnNonDefaultBranch) { setBranchDiff(null); return; }
    fetch(`/api/overlay/${encodeURIComponent(viewingRef)}`)
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => {
        const added = (data.nodes || []).filter(n => n.ghostState === 'local').length;
        const removed = (data.nodes || []).filter(n => n.ghostState === 'default-only').length;
        setBranchDiff({ added, removed, defaultBranch: defaultBranchRef });
      })
      .catch(() => setBranchDiff(null));
  }, [isOnNonDefaultBranch, viewingRef, defaultBranchRef]);

  const componentCount = new Set(nodes.map(n => n.component).filter(Boolean)).size;
  const nodeCount = nodes.length;
  const totalEdges = stats ? Object.values(stats.edgesByType).reduce((a, b) => a + b, 0) : '…';

  const templateMap = new Map(templates.map(t => [t.name, t]));

  const nodesByTemplate = [...nodes.reduce((acc, node) => {
    acc.set(node.template, (acc.get(node.template) ?? 0) + 1);
    return acc;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]);

  const nodesByState = [...nodes.reduce((acc, node) => {
    acc.set(node.state, (acc.get(node.state) ?? 0) + 1);
    return acc;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]);

  const nodesByStability = [...nodes.reduce((acc, node) => {
    acc.set(node.stability, (acc.get(node.stability) ?? 0) + 1);
    return acc;
  }, new Map()).entries()].sort((a, b) => b[1] - a[1]);

  const edgeRows = stats
    ? Object.entries(stats.edgesByType).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="content">
      <div className="dashboard-hero">
        <HeroCard value={componentCount} label="Components" />
        <HeroCard value={nodeCount} label="Nodes" />
        <HeroCard value={totalEdges} label="Edges" />
        <HeroCard value={stats ? stats.orphanNodeCount : '…'} label="Orphan Nodes" />
      </div>

      {branchDiff && (
        <div className="branch-diff-callout">
          <span className="branch-diff-branch">⎇ {viewingRef}</span>
          <span className="branch-diff-label">vs {branchDiff.defaultBranch}</span>
          {branchDiff.added > 0 && <span className="branch-diff-added">+{branchDiff.added} added</span>}
          {branchDiff.removed > 0 && <span className="branch-diff-removed">−{branchDiff.removed} removed</span>}
          {branchDiff.added === 0 && branchDiff.removed === 0 && (
            <span className="branch-diff-label">No changes</span>
          )}
        </div>
      )}

      <div className="dashboard-grid">
        <div className="dashboard-panel">
          <div className="card-head">Nodes by Type</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {nodesByTemplate.map(([name, count]) => {
              const tmpl = templateMap.get(name);
              const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
              return (
                <div key={name} className="stat-row">
                  <span className="stat-row-label">
                    <span className="stat-colour-dot" style={{ background: colour }} />
                    {tmpl?.ui?.displayName ?? name}
                  </span>
                  <span className="stat-row-value">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">State Distribution</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {nodesByState.map(([state, count]) => (
              <div key={state} className="stat-row">
                <span className="stat-row-label"><StateTag state={state} /></span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Edge Types</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {stats !== null && edgeRows.length === 0 && <div className="label-sm">No semantic edges.</div>}
            {edgeRows.map(([type, count]) => (
              <div key={type} className="stat-row">
                <span className="stat-row-label">
                  <span className="tag" style={EDGE_TYPE_STYLES[type] ?? {}}>{type}</span>
                </span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Stability</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {nodesByStability.map(([stability, count]) => (
              <div key={stability} className="stat-row">
                <span className="stat-row-label"><StabilityTag stability={stability} /></span>
                <span className="stat-row-value">{count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="dashboard-panel">
          <div className="card-head">Diagnostics</div>
          <div className="card-body" style={{ padding: '12px 16px' }}>
            {stats === null && <div className="label-sm">Loading…</div>}
            {stats !== null && stats.diagnosticCount > 0 && (
              <span style={{ color: 'var(--warn)' }}>
                {stats.diagnosticCount} load warning{stats.diagnosticCount !== 1 ? 's' : ''}
              </span>
            )}
            {stats !== null && stats.diagnosticCount === 0 && (
              <span style={{ color: 'var(--ok)' }}>No issues</span>
            )}
          </div>
        </div>

        {gitMode && (
          <div className="dashboard-panel">
            <div className="card-head">Branch Health</div>
            <div className="card-body" style={{ padding: '12px 16px' }}>
              {branchResults.map(result => (
                <div key={result.ref} className="stat-row">
                  <span className="stat-row-label">
                    <Icon
                      name={result.status === 'loaded' ? 'circle-check' : 'circle-xmark'}
                      size={12}
                    />
                    <span>{result.ref}</span>
                  </span>
                  {result.status === 'failed' && (
                    <span className="label-sm" style={{ color: 'var(--warn)', maxWidth: 200, textAlign: 'right' }}>
                      {result.diagnostics?.[0]?.message ?? result.error ?? 'failed'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire props into `DashboardPage` from `App`**

In the `App` function's render block, find:
```javascript
  } else if (route.pathname === '/dashboard' || route.pathname === '/') {
    page = <DashboardPage />;
```

Replace with:
```javascript
  } else if (route.pathname === '/dashboard' || route.pathname === '/') {
    page = (
      <DashboardPage
        nodes={nodes}
        templates={templates}
        gitMode={gitMode}
        viewingRef={viewingRef}
        branches={branches}
        branchResults={branchResults}
      />
    );
```

- [ ] **Step 5: Run tests to verify all pass**

```
npm test
```

Expected: all tests pass including the three new web asset tests.

- [ ] **Step 6: Verify in browser**

```
npm run web
```

Open http://localhost:3000. Verify:
- Clicking "Dashboard" in the nav rail shows the hero strip with 4 stat cards (Components, Nodes, Edges, Orphan Nodes)
- Numbers in Components and Nodes cards fill in immediately (from props)
- Edges and Orphan Nodes fill in after the `/api/stats` fetch
- Detail grid shows at least: Nodes by Type, State Distribution, Edge Types, Stability, Diagnostics panels
- Diagnostics panel shows "No issues" in green for a clean graph
- If using gitMode (multi-branch source), Branch Health panel appears

- [ ] **Step 7: Commit**

```bash
git add web/app.jsx test/web.test.ts
git commit -m "feat: dashboard page with hero strip and detail panels"
```
