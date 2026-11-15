# Graph View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive zoomable graph section to the Corum web UI with three drill-down levels (component map → component interior → node focus), edge type filtering, hierarchical Dagre layout, and deep links from the existing node detail view.

**Architecture:** A new `/api/graph` endpoint returns all cluster-root nodes and semantic edges in one payload. A new `web/graph.jsx` file renders the graph using React Flow (loaded via CDN) with Dagre layout; all three levels are computed client-side from that single fetch. Level selection is encoded in the URL hash so links are shareable.

**Tech Stack:** React Flow v11 (UMD via CDN), Dagre 0.8.x (UMD via CDN), Babel standalone (already present), Express (already present), Node built-in test runner.

## Global Constraints

- No build tooling — all browser JS is plain JS/JSX loaded via `<script>` or `<script type="text/babel">` tags
- JSX files must register on `window.*` globals (e.g. `window.CorumGraph = { GraphView }`)
- Follow existing code style: `const { useState, useEffect, useMemo } = React;` destructuring at top of each JSX file
- Semantic edge types in scope: `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`
- Excluded node templates (server-side): `Schema`, `EnumDefinition`, `Field`, `EnumValue`, `Mapping`
- Excluded edge types (server-side): `has-field`, `has-value`, `renamed-from`
- Edge colours must match existing `EDGE_TYPE_STYLES` in `app.jsx` for the four types already defined there (`triggers`=amber/`#b45309`, `produces`=teal/`#0f766e`, `calls`=purple/`#6d28d9`, `implements`=slate/`#475569`)
- Node card colours use `template.ui.colour` from pack YAML (same source as nav tree)
- Level state is URL-driven: `#/graph` = Level 1, `#/graph?component=X` = Level 2, `#/graph?focus=X` = Level 3
- Branch prefix in URL must be preserved when navigating within graph
- Edge type toggle state persists to `localStorage` under key `corum:graphEdgeTypes`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/web/server.ts` | Modify | Add `/api/graph` endpoint |
| `web/index.html` | Modify | Add React Flow + Dagre CDN script/link tags |
| `web/router.js` | Modify | Add `/graph` to `KNOWN_PATHS` |
| `web/graph-utils.js` | Create | Pure client-side graph logic (component collapse, n-hop BFS, edge filter, display name) |
| `web/graph-utils.test.js` | Create | Node-runnable tests for graph-utils.js |
| `web/graph.jsx` | Create | `GraphView` component: all three levels, custom RF node cards, toolbar, breadcrumb |
| `web/style.css` | Modify | Graph canvas, node card, toolbar, breadcrumb styles |
| `web/app.jsx` | Modify | NavRail item, `/graph` route, sidebar suppression, EdgePanel link, node header link |

---

## Task 1: Backend `/api/graph` Endpoint

**Files:**
- Modify: `src/web/server.ts` (after the `/api/nodes` handler, around line 419)

**Interfaces:**
- Produces: `GET /api/graph?ref=<branch>` → `{ nodes: GraphNode[], edges: GraphEdge[] }`
  where `GraphNode = { id: string, template: string, component: string, state: string, stability: string }`
  and `GraphEdge = { id: string, from: string, to: string, type: string }`

- [ ] **Step 1: Add the excluded template set and semantic edge type set constants near the top of `createApp`, after the existing `parseIncludeEdges` function (around line 209)**

```typescript
const GRAPH_EXCLUDED_TEMPLATES = new Set([
  'Schema', 'EnumDefinition', 'Field', 'EnumValue', 'Mapping',
])
const GRAPH_SEMANTIC_EDGE_TYPES = new Set([
  'triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from',
])
```

These are defined inside `createApp` (not module-level) to match the pattern of the existing `VALID_EDGE_TYPE_SET` usage.

- [ ] **Step 2: Add the `/api/graph` route handler after the `/api/nodes` handler (after line 419 in server.ts)**

```typescript
  app.get('/api/graph', async (req, res) => {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const nodes = []
    for (const node of targetGraph.nodesById.values()) {
      if (GRAPH_EXCLUDED_TEMPLATES.has(node.template)) continue
      nodes.push({
        id: node.id,
        template: node.template,
        component: node.component,
        state: node.state,
        stability: node.stability,
      })
    }

    const nodeIds = new Set(nodes.map(n => n.id))
    const edges = []
    for (const edgeList of targetGraph.edgesByFrom.values()) {
      for (const edge of edgeList) {
        if (!GRAPH_SEMANTIC_EDGE_TYPES.has(edge.type as string)) continue
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
        edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
      }
    }

    res.json({ nodes, edges })
  })
```

- [ ] **Step 3: Build and start the web server**

```bash
npm run build && npm run web
```

Expected: server starts on http://localhost:3000

- [ ] **Step 4: Verify the endpoint returns data**

```bash
curl "http://localhost:3000/api/graph" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log('nodes:', d.nodes.length, 'edges:', d.edges.length)"
```

Expected: prints node and edge counts (both > 0 if the graph has data loaded). Verify no Schema/Field/EnumDefinition nodes appear in the output by spot-checking: `curl "http://localhost:3000/api/graph" | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(d.nodes.filter(n=>['Schema','Field','EnumDefinition'].includes(n.template)).length)"` — should print `0`.

- [ ] **Step 5: Commit**

```bash
git add src/web/server.ts
git commit -m "feat: add /api/graph endpoint for graph view"
```

---

## Task 2: Scaffolding — CDN, Router, Graph Utilities

**Files:**
- Modify: `web/index.html`
- Modify: `web/router.js`
- Create: `web/graph-utils.js`
- Create: `web/graph-utils.test.js`

**Interfaces:**
- Produces (from `web/graph-utils.js`, exposed as `window.CorumGraphUtils` in browser and `module.exports` in Node):
  - `buildComponentMap(nodes, edges)` → `{ nodes: ComponentMapNode[], edges: ComponentMapEdge[] }`
    - `ComponentMapNode = { id: string, component: string, count: number }`
    - `ComponentMapEdge = { id: string, from: string, to: string, types: string[] }`
  - `buildFocusGraph(focalNodeId, nodes, edges, depth)` → `{ nodes: GraphNode[], edges: GraphEdge[] }`
    - `depth`: number (use `Infinity` for full chain)
  - `applyEdgeTypeFilter(edges, visibleTypes)` → `GraphEdge[]`
    - `visibleTypes`: `Set<string>`
  - `getDisplayName(nodeId)` → `string` (last dot-separated segment)

- [ ] **Step 1: Add React Flow CSS and CDN scripts to `web/index.html`**

Add after the FontAwesome stylesheet link and before the closing `</head>`:
```html
  <link rel="stylesheet" href="https://unpkg.com/reactflow@11.11.4/dist/style.css" crossorigin="anonymous" />
```

Add after the ReactDOM script and before the Babel script:
```html
  <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/reactflow@11.11.4/dist/umd/index.js" crossorigin="anonymous"></script>
```

The final `<head>` section order should be:
```html
  <link rel="stylesheet" href="style.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.7.2/css/all.min.css" />
  <link rel="stylesheet" href="https://unpkg.com/reactflow@11.11.4/dist/style.css" crossorigin="anonymous" />
```

And the script order in `<body>` should be:
```html
  <script src="https://unpkg.com/react@18.3.1/umd/react.production.min.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/dagre@0.8.5/dist/dagre.min.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/reactflow@11.11.4/dist/umd/index.js" crossorigin="anonymous"></script>
  <script src="https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" crossorigin="anonymous"></script>
  <script src="nav.js"></script>
  <script src="router.js"></script>
  <script src="graph-utils.js"></script>
  <script type="text/babel" src="primitives.jsx"></script>
  <script type="text/babel" src="search.jsx"></script>
  <script type="text/babel" src="graph.jsx"></script>
  ... (existing plugin loader) ...
  <script type="text/babel" src="app.jsx"></script>
```

Note: `graph-utils.js` loads as a plain script (no Babel), `graph.jsx` loads as `type="text/babel"`.

- [ ] **Step 2: Add `/graph` to `KNOWN_PATHS` in `web/router.js`**

Change:
```js
var KNOWN_PATHS = new Set(['/dashboard', '/components', '/node']);
```
To:
```js
var KNOWN_PATHS = new Set(['/dashboard', '/components', '/node', '/graph']);
```

- [ ] **Step 3: Write the failing tests in `web/graph-utils.test.js`**

```js
// run with: node web/graph-utils.test.js
const { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName } = require('./graph-utils.js');

let passed = 0, failed = 0;
function assert(condition, name) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}`); failed++; }
}

const nodes = [
  { id: 'orders.DomainModel.order',        template: 'DomainModel', component: 'orders',   state: 'agreed',    stability: 'stable' },
  { id: 'orders.RestAPI.ordersApi',         template: 'RestAPI',     component: 'orders',   state: 'agreed',    stability: 'stable' },
  { id: 'payments.DomainModel.payment',     template: 'DomainModel', component: 'payments', state: 'proposed',  stability: 'unstable' },
  { id: 'payments.RestAPI.paymentsApi',     template: 'RestAPI',     component: 'payments', state: 'proposed',  stability: 'unstable' },
];

const edges = [
  { id: 'e1', from: 'orders.RestAPI.ordersApi',     to: 'orders.DomainModel.order',    type: 'reads' },
  { id: 'e2', from: 'orders.RestAPI.ordersApi',     to: 'payments.RestAPI.paymentsApi', type: 'calls' },
  { id: 'e3', from: 'payments.RestAPI.paymentsApi', to: 'payments.DomainModel.payment', type: 'reads' },
];

// getDisplayName
assert(getDisplayName('orders.DomainModel.order') === 'order', 'getDisplayName returns last segment');
assert(getDisplayName('payments.RestAPI.paymentsApi') === 'paymentsApi', 'getDisplayName handles nested id');

// buildComponentMap
const cm = buildComponentMap(nodes, edges);
assert(cm.nodes.length === 2, 'buildComponentMap: one node per component');
assert(cm.nodes.every(n => typeof n.count === 'number' && n.count > 0), 'buildComponentMap: nodes have count');
const cmOrders = cm.nodes.find(n => n.id === 'orders');
assert(cmOrders?.count === 2, 'buildComponentMap: orders has 2 nodes');
assert(cm.edges.length === 1, 'buildComponentMap: one cross-component edge');
assert(cm.edges[0].from === 'orders' && cm.edges[0].to === 'payments', 'buildComponentMap: edge direction correct');
assert(cm.edges[0].types.includes('calls'), 'buildComponentMap: edge types collected');
const sameCmEdges = buildComponentMap(nodes, [{ id: 'x', from: 'orders.DomainModel.order', to: 'orders.RestAPI.ordersApi', type: 'reads' }]);
assert(sameCmEdges.edges.length === 0, 'buildComponentMap: intra-component edges excluded');

// buildFocusGraph - depth 1
const focus1 = buildFocusGraph('orders.RestAPI.ordersApi', nodes, edges, 1);
assert(focus1.nodes.some(n => n.id === 'orders.RestAPI.ordersApi'), 'buildFocusGraph depth=1: includes focal node');
assert(focus1.nodes.some(n => n.id === 'orders.DomainModel.order'), 'buildFocusGraph depth=1: includes 1-hop neighbour (via reads)');
assert(focus1.nodes.some(n => n.id === 'payments.RestAPI.paymentsApi'), 'buildFocusGraph depth=1: includes 1-hop neighbour (via calls)');
assert(!focus1.nodes.some(n => n.id === 'payments.DomainModel.payment'), 'buildFocusGraph depth=1: excludes 2-hop neighbour');
assert(focus1.edges.length === 2, 'buildFocusGraph depth=1: includes only edges within visible nodes');

// buildFocusGraph - depth Infinity
const focusAll = buildFocusGraph('orders.RestAPI.ordersApi', nodes, edges, Infinity);
assert(focusAll.nodes.length === 4, 'buildFocusGraph depth=Infinity: includes all reachable nodes');
assert(focusAll.edges.length === 3, 'buildFocusGraph depth=Infinity: includes all reachable edges');

// applyEdgeTypeFilter
const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
assert(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
assert(filtered.every(e => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
const none = applyEdgeTypeFilter(edges, new Set([]));
assert(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
```

- [ ] **Step 4: Run the test — expect it to fail with "Cannot find module './graph-utils.js'"**

```bash
node web/graph-utils.test.js
```

Expected: error `Cannot find module './graph-utils.js'` (or similar)

- [ ] **Step 5: Create `web/graph-utils.js` with implementations**

```js
/* Pure graph utility functions — browser globals + Node require() compatible. */

function getDisplayName(nodeId) {
  return nodeId.split('.').pop();
}

function buildComponentMap(nodes, edges) {
  const componentCounts = new Map();
  for (const node of nodes) {
    componentCounts.set(node.component, (componentCounts.get(node.component) ?? 0) + 1);
  }

  const componentNodes = [...componentCounts.entries()].map(([component, count]) => ({
    id: component,
    component,
    count,
  }));

  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const compEdgeMap = new Map();
  for (const edge of edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    if (fromNode.component === toNode.component) continue;
    const key = `${fromNode.component}__${toNode.component}`;
    if (!compEdgeMap.has(key)) compEdgeMap.set(key, { from: fromNode.component, to: toNode.component, types: new Set() });
    compEdgeMap.get(key).types.add(edge.type);
  }

  const componentEdges = [...compEdgeMap.entries()].map(([key, entry]) => ({
    id: key,
    from: entry.from,
    to: entry.to,
    types: [...entry.types],
  }));

  return { nodes: componentNodes, edges: componentEdges };
}

function buildFocusGraph(focalNodeId, nodes, edges, depth) {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const visited = new Set([focalNodeId]);
  const queue = [{ id: focalNodeId, d: 0 }];

  while (queue.length > 0) {
    const { id, d } = queue.shift();
    if (d >= depth) continue;
    for (const edge of edges) {
      let neighborId = null;
      if (edge.from === id) neighborId = edge.to;
      else if (edge.to === id) neighborId = edge.from;
      if (!neighborId || visited.has(neighborId) || !nodeById.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push({ id: neighborId, d: d + 1 });
    }
  }

  return {
    nodes: [...visited].map(id => nodeById.get(id)).filter(Boolean),
    edges: edges.filter(e => visited.has(e.from) && visited.has(e.to)),
  };
}

function applyEdgeTypeFilter(edges, visibleTypes) {
  return edges.filter(e => visibleTypes.has(e.type));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName };
}
if (typeof window !== 'undefined') {
  window.CorumGraphUtils = { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName };
}
```

- [ ] **Step 6: Run tests — expect all to pass**

```bash
node web/graph-utils.test.js
```

Expected: all assertions print `✓`, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/router.js web/graph-utils.js web/graph-utils.test.js
git commit -m "feat: graph view scaffolding — CDN deps, router, graph utilities"
```

---

## Task 3: Graph Canvas — Level 1 (Component Map)

**Files:**
- Create: `web/graph.jsx`

**Interfaces:**
- Consumes: `window.CorumGraphUtils` (from Task 2), `window.ReactFlow` (from CDN), `window.dagre` (from CDN), `window.CorumPrimitives.{Icon, TemplateBadge, StateTag, StabilityTag}`, `window.CorumRouter.{parseRoute, buildRoute}`, `navigate` (from primitives.jsx)
- Produces: `window.CorumGraph = { GraphView }` — `GraphView` is a React component receiving `{ route, viewingRef, templates }`

**Key React Flow UMD note:** The global `window.ReactFlow` is the module exports object. Access components as:
```js
const { ReactFlow, MiniMap, Background, useNodesState, useEdgesState, MarkerType, ReactFlowProvider } = window.ReactFlow;
```
If `ReactFlow` is undefined after destructuring, try `window.ReactFlow.default`. Verify by opening the browser console and running `console.log(Object.keys(window.ReactFlow))`.

**Edge colour constants (used in Tasks 3–5):**
```js
const EDGE_STYLES = {
  'triggers':     { stroke: '#b45309', strokeWidth: 1.5 },
  'produces':     { stroke: '#0f766e', strokeWidth: 1.5 },
  'calls':        { stroke: '#6d28d9', strokeWidth: 1.5 },
  'implements':   { stroke: '#475569', strokeWidth: 1.5 },
  'reads':        { stroke: '#1d4ed8', strokeWidth: 1.5 },
  'maps-to':      { stroke: '#be185d', strokeWidth: 1.5 },
  'derived-from': { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '5,5' },
};

const EDGE_PILL_STYLES = {
  'triggers':     { background: '#fef3c7', color: '#b45309' },
  'produces':     { background: '#ccfbf1', color: '#0f766e' },
  'calls':        { background: '#ede9fe', color: '#6d28d9' },
  'implements':   { background: '#f1f5f9', color: '#475569' },
  'reads':        { background: '#dbeafe', color: '#1d4ed8' },
  'maps-to':      { background: '#fce7f3', color: '#be185d' },
  'derived-from': { background: '#f3f4f6', color: '#6b7280' },
};

const ALL_EDGE_TYPES = ['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from'];
```

- [ ] **Step 1: Create `web/graph.jsx` with constants, helpers, Dagre layout, and ComponentCardNode**

```jsx
/* Graph view: interactive three-level canvas using React Flow + Dagre. */

const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { Icon, TemplateBadge, StateTag, StabilityTag } = window.CorumPrimitives;
const { buildRoute, parseRoute } = window.CorumRouter;
const { buildComponentMap, buildFocusGraph, applyEdgeTypeFilter, getDisplayName } = window.CorumGraphUtils;

const RF = window.ReactFlow;
const ReactFlowCanvas = RF.ReactFlow || RF.default;
const { MiniMap, Background, useNodesState, useEdgesState, MarkerType, ReactFlowProvider } = RF;

const EDGE_STYLES = {
  'triggers':     { stroke: '#b45309', strokeWidth: 1.5 },
  'produces':     { stroke: '#0f766e', strokeWidth: 1.5 },
  'calls':        { stroke: '#6d28d9', strokeWidth: 1.5 },
  'implements':   { stroke: '#475569', strokeWidth: 1.5 },
  'reads':        { stroke: '#1d4ed8', strokeWidth: 1.5 },
  'maps-to':      { stroke: '#be185d', strokeWidth: 1.5 },
  'derived-from': { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '5,5' },
};

const EDGE_PILL_STYLES = {
  'triggers':     { background: '#fef3c7', color: '#b45309' },
  'produces':     { background: '#ccfbf1', color: '#0f766e' },
  'calls':        { background: '#ede9fe', color: '#6d28d9' },
  'implements':   { background: '#f1f5f9', color: '#475569' },
  'reads':        { background: '#dbeafe', color: '#1d4ed8' },
  'maps-to':      { background: '#fce7f3', color: '#be185d' },
  'derived-from': { background: '#f3f4f6', color: '#6b7280' },
};

const ALL_EDGE_TYPES = ['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from'];

const NODE_W = 210;
const NODE_H = 88;
const COMP_W = 180;
const COMP_H = 72;

function loadVisibleEdgeTypes() {
  try {
    const stored = localStorage.getItem('corum:graphEdgeTypes');
    if (stored) return new Set(JSON.parse(stored));
  } catch {}
  return new Set(ALL_EDGE_TYPES);
}

function saveVisibleEdgeTypes(types) {
  try { localStorage.setItem('corum:graphEdgeTypes', JSON.stringify([...types])); } catch {}
}

function computeLayout(rfNodes, rfEdges, nodeW, nodeH) {
  if (!rfNodes.length) return rfNodes;
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 50, ranksep: 80 });
  rfNodes.forEach(n => g.setNode(n.id, { width: nodeW, height: nodeH }));
  rfEdges.forEach(e => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return rfNodes.map(n => {
    const pos = g.node(n.id);
    return { ...n, position: { x: pos.x - nodeW / 2, y: pos.y - nodeH / 2 } };
  });
}

function makeRFEdge(edge, edgeStyles) {
  const style = edgeStyles[edge.type] || { stroke: '#a8acb5', strokeWidth: 1.5 };
  return {
    id: edge.id,
    source: edge.from,
    target: edge.to,
    label: edge.type,
    labelStyle: { fontSize: 10, fill: style.stroke },
    labelBgStyle: { fill: 'var(--paper)', fillOpacity: 0.85 },
    style: { stroke: style.stroke, strokeWidth: style.strokeWidth, strokeDasharray: style.strokeDasharray },
    markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 14, height: 14 },
    type: 'default',
  };
}

// Level 1: component card node
function ComponentCardNode({ data }) {
  return (
    <div className="graph-component-card" onClick={data.onClick}>
      <RF.Handle type="target" position={RF.Position.Left} style={{ opacity: 0 }} />
      <div className="graph-component-card-name">{data.label}</div>
      <div className="graph-component-card-count">{data.count} {data.count === 1 ? 'node' : 'nodes'}</div>
      <RF.Handle type="source" position={RF.Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { componentCard: ComponentCardNode };
```

- [ ] **Step 2: Add the `GraphBreadcrumb` component and `GraphToolbar` stub**

Append to `web/graph.jsx`:

```jsx
function GraphBreadcrumb({ level, selectedComponent, focalNodeId, onNavigateToRoot, onNavigateToComponent }) {
  return (
    <div className="graph-breadcrumb">
      <button className="graph-breadcrumb-item" onClick={onNavigateToRoot}>Graph</button>
      {(level === 'interior' || level === 'focus') && selectedComponent && (
        <>
          <span className="graph-breadcrumb-sep">/</span>
          {level === 'interior'
            ? <span className="graph-breadcrumb-current">{selectedComponent}</span>
            : <button className="graph-breadcrumb-item" onClick={() => onNavigateToComponent(selectedComponent)}>{selectedComponent}</button>
          }
        </>
      )}
      {level === 'focus' && focalNodeId && (
        <>
          <span className="graph-breadcrumb-sep">/</span>
          <span className="graph-breadcrumb-current">{getDisplayName(focalNodeId)}</span>
        </>
      )}
    </div>
  );
}

function GraphToolbar({ visibleEdgeTypes, onToggleEdgeType, showMinimap, onToggleMinimap, onResetLayout, level, depth, onDepth, allNodes, focalNodeId, onFocalNode }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allNodes
      .filter(n => n.id.toLowerCase().includes(q))
      .slice(0, 8);
  }, [searchQuery, allNodes]);

  useEffect(() => {
    if (!searchOpen) return;
    function handleClick(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setSearchOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [searchOpen]);

  return (
    <div className="graph-toolbar">
      {ALL_EDGE_TYPES.map(type => {
        const active = visibleEdgeTypes.has(type);
        const pill = EDGE_PILL_STYLES[type] || {};
        return (
          <span
            key={type}
            className={`graph-edge-pill${active ? '' : ' inactive'}`}
            style={active ? pill : {}}
            onClick={() => onToggleEdgeType(type)}
          >
            {type}
          </span>
        );
      })}
      <div className="graph-toolbar-sep" />
      {level === 'focus' && (
        <>
          <div className="graph-depth-seg">
            {[['1', 1], ['2', 2], ['∞', Infinity]].map(([label, val]) => (
              <button
                key={label}
                className={`graph-depth-item${depth === val ? ' active' : ''}`}
                onClick={() => onDepth(val)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="graph-focus-search" ref={searchRef}>
            <input
              className="graph-focus-search-input"
              placeholder="Focus node..."
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="graph-focus-search-dropdown">
                {searchResults.map(n => (
                  <div
                    key={n.id}
                    className={`graph-focus-search-item${n.id === focalNodeId ? ' selected' : ''}`}
                    onClick={() => { onFocalNode(n.id); setSearchQuery(''); setSearchOpen(false); }}
                  >
                    <span style={{ fontWeight: 500 }}>{getDisplayName(n.id)}</span>
                    <span style={{ color: 'var(--ink-3)', fontSize: 10, marginLeft: 4 }}>{n.component}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="graph-toolbar-sep" />
        </>
      )}
      <button className="graph-toolbar-btn" onClick={onResetLayout}>Reset layout</button>
      <button className={`graph-toolbar-btn${showMinimap ? ' active' : ''}`} onClick={onToggleMinimap}>Minimap</button>
    </div>
  );
}
```

- [ ] **Step 3: Add the Level 1 canvas rendering and `GraphView` entry point (stub for Levels 2–3)**

Append to `web/graph.jsx`:

```jsx
function GraphView({ route, viewingRef, templates }) {
  const [graphData, setGraphData] = useState(null);
  const [error, setError] = useState(null);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState(loadVisibleEdgeTypes);
  const [showMinimap, setShowMinimap] = useState(false);
  const [depth, setDepth] = useState(1);
  const [layoutKey, setLayoutKey] = useState(0);
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);

  // Derive level and selection from URL
  const selectedComponent = route.params.get('component') ?? null;
  const focalNodeId = route.params.get('focus') ?? null;
  const level = focalNodeId ? 'focus' : selectedComponent ? 'interior' : 'component';

  function navToRoot() {
    navigate(buildRoute({ pathname: '/graph', params: {}, branch: viewingRef }));
  }
  function navToComponent(component) {
    navigate(buildRoute({ pathname: '/graph', params: { component }, branch: viewingRef }));
  }
  function navToFocus(nodeId) {
    navigate(buildRoute({ pathname: '/graph', params: { focus: nodeId }, branch: viewingRef }));
  }

  useEffect(() => {
    setGraphData(null);
    setError(null);
    const refParam = viewingRef ? `?ref=${encodeURIComponent(viewingRef)}` : '';
    fetch(`/api/graph${refParam}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(setGraphData)
      .catch(err => setError(String(err)));
  }, [viewingRef]);

  const templateMap = useMemo(() => new Map((templates ?? []).map(t => [t.name, t])), [templates]);

  const templateColour = useCallback(templateName => {
    return templateMap.get(templateName)?.ui?.colour ?? 'var(--ink-4)';
  }, [templateMap]);

  // Level 1: component map
  const level1 = useMemo(() => {
    if (!graphData) return null;
    const { nodes: cmNodes, edges: cmEdges } = buildComponentMap(graphData.nodes, graphData.edges);
    const filteredEdges = applyEdgeTypeFilter(
      cmEdges.map(e => ({ ...e, type: e.types[0] ?? 'calls' })),
      visibleEdgeTypes
    );
    const rfN = cmNodes.map(n => ({
      id: n.id,
      type: 'componentCard',
      position: { x: 0, y: 0 },
      data: { label: n.component, count: n.count, onClick: () => navToComponent(n.component) },
    }));
    const rfE = filteredEdges.map(e => ({
      ...makeRFEdge({ ...e, type: e.type }, EDGE_STYLES),
      label: cmEdges.find(ce => ce.id === e.id)?.types.join(', ') ?? e.type,
    }));
    return { rfN: computeLayout(rfN, rfE, COMP_W, COMP_H), rfE };
  }, [graphData, visibleEdgeTypes, layoutKey]);

  useEffect(() => {
    if (level !== 'component' || !level1) return;
    setRfNodes(level1.rfN);
    setRfEdges(level1.rfE);
  }, [level, level1]);

  function handleToggleEdgeType(type) {
    setVisibleEdgeTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      saveVisibleEdgeTypes(next);
      return next;
    });
  }

  if (!graphData && !error) return <div className="graph-section"><p className="label-sm" style={{ padding: 24 }}>Loading graph...</p></div>;
  if (error) return <div className="graph-section"><p style={{ color: 'var(--warn)', padding: 24 }}>Error loading graph: {error}</p></div>;

  return (
    <div className="graph-section">
      <GraphBreadcrumb
        level={level}
        selectedComponent={selectedComponent}
        focalNodeId={focalNodeId}
        onNavigateToRoot={navToRoot}
        onNavigateToComponent={navToComponent}
      />
      <GraphToolbar
        visibleEdgeTypes={visibleEdgeTypes}
        onToggleEdgeType={handleToggleEdgeType}
        showMinimap={showMinimap}
        onToggleMinimap={() => setShowMinimap(v => !v)}
        onResetLayout={() => setLayoutKey(k => k + 1)}
        level={level}
        depth={depth}
        onDepth={setDepth}
        allNodes={graphData?.nodes ?? []}
        focalNodeId={focalNodeId}
        onFocalNode={navToFocus}
      />
      <div className="graph-canvas-wrap">
        <ReactFlowProvider>
          <ReactFlowCanvas
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            {showMinimap && <MiniMap />}
          </ReactFlowCanvas>
        </ReactFlowProvider>
      </div>
    </div>
  );
}

window.CorumGraph = { GraphView };
```

- [ ] **Step 4: Add a minimal graph route to `app.jsx` temporarily to test Level 1 renders**

In `app.jsx`, inside the `NavRail` `items` array, add:
```js
{ id: 'graph', icon: 'diagram-project', label: 'Graph' },
```

In the `App` function's route section, add before the `else` at the bottom:
```jsx
} else if (route.pathname === '/graph') {
  page = (
    <window.CorumGraph.GraphView
      route={route}
      viewingRef={viewingRef}
      templates={templates}
    />
  );
```

Also change `showTree` to hide the nav tree on graph:
```js
const showTree = (activeSection === 'components' || activeNodeId) && activeSection !== 'graph';
```

And add `graph.jsx` to `index.html` before `app.jsx` (already instructed in Task 2 Step 1).

- [ ] **Step 5: Start the web server and verify Level 1 renders**

```bash
npm run build && npm run web
```

Open http://localhost:3000, click the "Graph" nav item (diagram-project icon). Expected: the canvas renders with one card per component, edges between components, full-width without the left nav tree.

- [ ] **Step 6: Commit**

```bash
git add web/graph.jsx web/app.jsx
git commit -m "feat: graph view Level 1 — component map canvas"
```

---

## Task 4: Graph Canvas — Levels 2 & 3 (Interior + Focus)

**Files:**
- Modify: `web/graph.jsx` (add NodeCardNode, Level 2 and 3 memo blocks, wire into GraphView)

**Interfaces:**
- Consumes: `buildFocusGraph`, `buildComponentMap` from `window.CorumGraphUtils`, existing `computeLayout`, `makeRFEdge`, `EDGE_STYLES` from Task 3
- Produces: clicking component card drills to Level 2; clicking node card drills to Level 3; clicking `↗` on node card navigates to `#/node?id=<nodeId>` 

- [ ] **Step 1: Add `NodeCardNode` custom RF node component**

In `web/graph.jsx`, after the `ComponentCardNode` function and before `const nodeTypes = ...`, insert:

```jsx
function NodeCardNode({ data }) {
  const colour = data.colour ?? 'var(--ink-4)';
  return (
    <div className="graph-node-card" onClick={data.onClick}>
      <RF.Handle type="target" position={RF.Position.Left} style={{ opacity: 0 }} />
      <div className="graph-node-card-bar" style={{ background: colour }} />
      <div className="graph-node-card-header">
        <TemplateBadge name={data.templateLabel} colour={colour} />
        <StateTag state={data.state} />
      </div>
      <div className="graph-node-card-body">
        <div className="graph-node-card-name" title={data.nodeId}>{data.label}</div>
        <div className="graph-node-card-component">{data.component}</div>
      </div>
      <div className="graph-node-card-footer">
        <StabilityTag stability={data.stability} />
        <button
          className="graph-node-card-link"
          title="View node details"
          onClick={e => { e.stopPropagation(); navigate(`#/node?id=${encodeURIComponent(data.nodeId)}`); }}
        >
          <Icon name="arrow-up-right-from-square" size={11} />
        </button>
      </div>
      <RF.Handle type="source" position={RF.Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}
```

Change `const nodeTypes = ...` to:
```js
const nodeTypes = { componentCard: ComponentCardNode, nodeCard: NodeCardNode };
```

- [ ] **Step 2: Add helpers to convert graph nodes/edges to RF format**

In `web/graph.jsx`, after the `computeLayout` function, add:

```jsx
function buildRFNodesForNodes(graphNodes, templateMap, onNodeClick) {
  return graphNodes.map(n => {
    const tmpl = templateMap.get(n.template);
    const colour = tmpl?.ui?.colour ?? 'var(--ink-4)';
    return {
      id: n.id,
      type: 'nodeCard',
      position: { x: 0, y: 0 },
      data: {
        nodeId: n.id,
        label: getDisplayName(n.id),
        component: n.component,
        templateLabel: tmpl?.ui?.displayName ?? n.template,
        colour,
        state: n.state,
        stability: n.stability,
        onClick: () => onNodeClick(n.id),
      },
    };
  });
}

function buildRFEdgesForEdges(edges, visibleEdgeTypes) {
  return applyEdgeTypeFilter(edges, visibleEdgeTypes).map(e => makeRFEdge(e, EDGE_STYLES));
}
```

- [ ] **Step 3: Add Level 2 (component interior) memo inside `GraphView`**

In `web/graph.jsx`, inside `GraphView`, after the `level1` useMemo block, add:

```jsx
  const level2 = useMemo(() => {
    if (!graphData || !selectedComponent) return null;
    const compNodes = graphData.nodes.filter(n => n.component === selectedComponent);
    const compNodeIds = new Set(compNodes.map(n => n.id));
    const internalEdges = graphData.edges.filter(e => compNodeIds.has(e.from) && compNodeIds.has(e.to));
    const crossEdges = graphData.edges.filter(e =>
      (compNodeIds.has(e.from) && !compNodeIds.has(e.to)) ||
      (!compNodeIds.has(e.from) && compNodeIds.has(e.to))
    );
    const externalNodeIds = new Set([
      ...crossEdges.map(e => e.from).filter(id => !compNodeIds.has(id)),
      ...crossEdges.map(e => e.to).filter(id => !compNodeIds.has(id)),
    ]);
    const externalNodes = graphData.nodes.filter(n => externalNodeIds.has(n.id));
    const allVisibleNodes = [...compNodes, ...externalNodes];
    const allVisibleEdges = [...internalEdges, ...crossEdges];
    const rfN = buildRFNodesForNodes(allVisibleNodes, templateMap, navToFocus);
    const rfE = buildRFEdgesForEdges(allVisibleEdges, visibleEdgeTypes).map(e => {
      const isCross = crossEdges.some(ce => ce.id === e.id);
      return isCross ? { ...e, style: { ...e.style, opacity: 0.45 }, labelStyle: { ...e.labelStyle, opacity: 0.45 } } : e;
    });
    return { rfN: computeLayout(rfN, rfE, NODE_W, NODE_H), rfE };
  }, [graphData, selectedComponent, visibleEdgeTypes, templateMap, layoutKey]);

  useEffect(() => {
    if (level !== 'interior' || !level2) return;
    setRfNodes(level2.rfN);
    setRfEdges(level2.rfE);
  }, [level, level2]);
```

- [ ] **Step 4: Add Level 3 (node focus) memo inside `GraphView`**

In `web/graph.jsx`, inside `GraphView`, after the `level2` useMemo block, add:

```jsx
  const level3 = useMemo(() => {
    if (!graphData || !focalNodeId) return null;
    const { nodes: focusNodes, edges: focusEdges } = buildFocusGraph(
      focalNodeId, graphData.nodes, graphData.edges, depth
    );
    const rfN = buildRFNodesForNodes(focusNodes, templateMap, nodeId => {
      navigate(buildRoute({ pathname: '/graph', params: { focus: nodeId }, branch: viewingRef }));
    });
    const rfE = buildRFEdgesForEdges(focusEdges, visibleEdgeTypes);
    const layoutedN = computeLayout(rfN, rfE, NODE_W, NODE_H);
    return {
      rfN: layoutedN.map(n => n.id === focalNodeId
        ? { ...n, data: { ...n.data }, style: { outline: '2px solid var(--accent)', outlineOffset: '2px', borderRadius: 'var(--radius)' } }
        : n
      ),
      rfE,
    };
  }, [graphData, focalNodeId, depth, visibleEdgeTypes, templateMap, layoutKey, viewingRef]);

  useEffect(() => {
    if (level !== 'focus' || !level3) return;
    setRfNodes(level3.rfN);
    setRfEdges(level3.rfE);
  }, [level, level3]);
```

- [ ] **Step 5: Build and test all three levels manually**

```bash
npm run build && npm run web
```

Open http://localhost:3000 and verify:
1. `#/graph` — component map with component cards and edges
2. Click a component card → URL changes to `#/graph?component=<name>`, node cards appear
3. Click a node card body → URL changes to `#/graph?focus=<id>`, focal node highlighted with accent outline
4. Depth controls (1 / 2 / ∞) change the visible neighbourhood
5. Breadcrumb segments navigate back up
6. `↗` icon on a node card navigates to the node detail page (`#/node?id=...`)

- [ ] **Step 6: Commit**

```bash
git add web/graph.jsx
git commit -m "feat: graph view Levels 2 and 3 — interior and focus drill-down"
```

---

## Task 5: App Integration & Deep Links

**Files:**
- Modify: `web/app.jsx`

**Interfaces:**
- Consumes: `window.CorumGraph.GraphView`
- Produces:
  - NavRail "Graph" item (permanent)
  - `/graph` route renders `<GraphView>`
  - `EdgePanel` rows have a graph link icon navigating to `#/graph?focus=<nodeId>`
  - Node detail page header has a "Graph" link navigating to `#/graph?focus=<nodeId>`

Note: Task 3 Step 4 added a temporary wiring of the route and NavRail item. This task makes it permanent and complete, and adds the deep links.

- [ ] **Step 1: Confirm NavRail "Graph" item is in place**

In `web/app.jsx`, the `NavRail` `items` array should read:
```js
const items = [
  { id: 'dashboard', icon: 'grip', label: 'Dashboard' },
  { id: 'components', icon: 'circle-nodes', label: 'Models' },
  { id: 'graph', icon: 'diagram-project', label: 'Graph' },
];
```

- [ ] **Step 2: Confirm `showTree` excludes the graph section**

```js
const showTree = (activeSection === 'components' || activeNodeId) && activeSection !== 'graph';
```

- [ ] **Step 3: Confirm the `/graph` route in the `App` render block**

The route block should include:
```jsx
} else if (route.pathname === '/graph') {
  page = (
    <window.CorumGraph.GraphView
      route={route}
      viewingRef={viewingRef}
      templates={templates}
    />
  );
```

- [ ] **Step 4: Add graph link to `EdgePanel`'s `EdgeRow`**

In the `EdgeRow` function inside `EdgePanel`, after the `<StateTag>` and before the closing `</div>`, add a graph link button:

```jsx
<button
  className="graph-nav-link"
  title="View in graph"
  onClick={e => { e.stopPropagation(); navigate(`#/graph?focus=${encodeURIComponent(linkedNodeId)}`); }}
  style={{ marginLeft: 'auto' }}
>
  <Icon name="diagram-project" size={11} />
</button>
```

The full `EdgeRow` return should look like:
```jsx
return (
  <div
    onClick={() => onNavigate(linkedNodeId)}
    title={linkedNodeId}
    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', cursor: 'pointer' }}
  >
    <span className="tag" style={EDGE_TYPE_STYLES[edge.type] ?? {}}>{edge.type}</span>
    <TemplateBadge name={tmpl?.ui?.displayName ?? node?.template ?? '?'} colour={colour} />
    <span style={{ fontWeight: 500, fontSize: 13 }}>{name}</span>
    {node && <StateTag state={node.state} />}
    {node && <StabilityTag stability={node.stability} />}
    <button
      className="graph-nav-link"
      title="View in graph"
      onClick={e => { e.stopPropagation(); navigate(`#/graph?focus=${encodeURIComponent(linkedNodeId)}`); }}
      style={{ marginLeft: 'auto' }}
    >
      <Icon name="diagram-project" size={11} />
    </button>
  </div>
);
```

- [ ] **Step 5: Add graph link to the node detail page header in `NodePage`**

In `NodePage`, find the header `<div>` that contains `<h1>`, `<TemplateBadge>`, `<StateTag>`, `<StabilityTag>`. Add a graph link after the stability tag:

```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
  <h1 style={{ margin: 0 }}>{displayName(root.id)}</h1>
  <TemplateBadge name={templateDisplayName(template)} colour={colour} />
  <StateTag state={root.state} />
  <StabilityTag stability={root.stability} />
  <button
    className="graph-nav-link"
    onClick={() => navigate(`#/graph?focus=${encodeURIComponent(root.id)}`)}
    title="View in graph"
  >
    <Icon name="diagram-project" size={11} />
    <span>Graph</span>
  </button>
</div>
```

- [ ] **Step 6: Build and test the deep links**

```bash
npm run build && npm run web
```

1. Navigate to any node detail page
2. Verify the "Graph" link appears in the header and clicking it opens the graph at Level 3 focused on that node
3. Open the Connections panel (EdgePanel) on a node with edges
4. Verify each edge row has a `diagram-project` icon that opens the graph focused on the linked node
5. Verify clicking the edge row itself still navigates to that node's detail page (not overridden)

- [ ] **Step 7: Commit**

```bash
git add web/app.jsx
git commit -m "feat: graph view integration — NavRail item, route, deep links from EdgePanel and node header"
```

---

## Task 6: CSS — Graph Styles

**Files:**
- Modify: `web/style.css` (append at end)

**Interfaces:**
- Consumes: CSS custom properties from `:root` (`--paper`, `--paper-2`, `--paper-3`, `--ink`, `--ink-3`, `--ink-4`, `--rule`, `--rule-2`, `--accent`, `--radius`)
- Produces: all class names used in `graph.jsx` and the `graph-nav-link` class used in `app.jsx`

- [ ] **Step 1: Append graph styles to `web/style.css`**

```css
/* ── Graph view ── */

.graph-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

.graph-breadcrumb {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 12px;
  color: var(--ink-3);
  background: var(--paper);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
}

.graph-breadcrumb-item {
  color: var(--ink-3);
  cursor: pointer;
  background: none;
  border: none;
  font: inherit;
  font-size: 12px;
  padding: 0;
}

.graph-breadcrumb-item:hover { color: var(--ink); }

.graph-breadcrumb-sep { color: var(--ink-4); }

.graph-breadcrumb-current { color: var(--ink); font-weight: 600; }

.graph-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--paper);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
  flex-wrap: wrap;
}

.graph-canvas-wrap {
  flex: 1;
  position: relative;
  min-height: 0;
}

/* Node cards (Levels 2 & 3) */
.graph-node-card {
  background: var(--paper);
  border: 1.5px solid var(--rule-2);
  border-radius: var(--radius);
  width: 210px;
  font-size: 12px;
  cursor: pointer;
  overflow: visible;
  position: relative;
  transition: box-shadow 0.12s;
}

.graph-node-card:hover { box-shadow: 0 2px 10px rgba(0,0,0,0.1); }

.graph-node-card-bar {
  width: 3px;
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: var(--radius) 0 0 var(--radius);
}

.graph-node-card-header {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 8px 4px 10px;
}

.graph-node-card-body { padding: 2px 8px 4px 10px; }

.graph-node-card-name {
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 180px;
}

.graph-node-card-component {
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.graph-node-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 3px 8px 5px 10px;
  border-top: 1px solid var(--rule);
  margin-top: 3px;
}

.graph-node-card-link {
  color: var(--ink-4);
  cursor: pointer;
  font-size: 11px;
  background: none;
  border: none;
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
}

.graph-node-card-link:hover { color: var(--ink-2); }

/* Component cards (Level 1) */
.graph-component-card {
  background: var(--paper);
  border: 1.5px solid var(--rule-2);
  border-radius: var(--radius);
  width: 180px;
  padding: 14px 16px;
  cursor: pointer;
  transition: box-shadow 0.12s, border-color 0.12s;
  position: relative;
}

.graph-component-card:hover {
  box-shadow: 0 2px 10px rgba(0,0,0,0.1);
  border-color: var(--ink-4);
}

.graph-component-card-name { font-weight: 700; font-size: 14px; color: var(--ink); margin-bottom: 4px; }

.graph-component-card-count { font-size: 11px; color: var(--ink-3); }

/* Edge type toggle pills */
.graph-edge-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  border: 1.5px solid transparent;
  user-select: none;
  transition: opacity 0.1s;
  white-space: nowrap;
}

.graph-edge-pill.inactive {
  background: transparent !important;
  color: var(--ink-3) !important;
  border-color: var(--rule-2) !important;
}

.graph-toolbar-sep {
  width: 1px;
  height: 20px;
  background: var(--rule);
  flex-shrink: 0;
}

/* Depth segmented control */
.graph-depth-seg {
  display: flex;
  border: 1px solid var(--rule-2);
  border-radius: var(--radius);
  overflow: hidden;
}

.graph-depth-item {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  background: none;
  border: none;
  border-right: 1px solid var(--rule-2);
  color: var(--ink-3);
  font: inherit;
}

.graph-depth-item:last-child { border-right: none; }
.graph-depth-item.active { background: var(--paper-3); color: var(--ink); }

/* Toolbar buttons */
.graph-toolbar-btn {
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  background: none;
  border: 1px solid var(--rule-2);
  border-radius: var(--radius);
  color: var(--ink-3);
  font: inherit;
}

.graph-toolbar-btn:hover { color: var(--ink); }
.graph-toolbar-btn.active { background: var(--paper-3); color: var(--ink); }

/* Focus node search */
.graph-focus-search { display: flex; align-items: center; gap: 6px; position: relative; }

.graph-focus-search-input {
  font: inherit;
  font-size: 12px;
  padding: 3px 8px;
  border: 1px solid var(--rule-2);
  border-radius: var(--radius);
  background: var(--paper);
  color: var(--ink);
  width: 180px;
}

.graph-focus-search-input:focus { outline: none; border-color: var(--accent); }

.graph-focus-search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 280px;
  background: var(--paper);
  border: 1px solid var(--rule-2);
  border-radius: var(--radius);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 100;
  overflow: hidden;
}

.graph-focus-search-item {
  display: flex;
  align-items: center;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 12px;
  gap: 6px;
}

.graph-focus-search-item:hover,
.graph-focus-search-item.selected { background: var(--paper-2); }

/* Graph nav link (used in EdgePanel and node header) */
.graph-nav-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--ink-4);
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-size: 11px;
  line-height: 1;
}

.graph-nav-link:hover { color: var(--ink-2); }
```

- [ ] **Step 2: Build and do a visual review**

```bash
npm run build && npm run web
```

Check each of the following visually:
- Level 1: component cards render with name and node count; edges have labels and arrowheads
- Level 2: node cards render with coloured left bar, template badge, state/stability, and `↗` icon
- Level 3: focal node has accent outline; depth controls change the visible nodes
- Edge type pill toggles work — inactive pills show as ghost outlines, canvas edges disappear for hidden types
- Minimap toggle shows/hides the minimap overlay
- Reset layout button re-runs Dagre and fits the view
- Graph nav link in EdgePanel rows is visible and correctly styled
- Graph link in node detail header renders next to the stability tag

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all existing tests pass (45 nodes, 38 edges from fixtures), `graph-utils.test.js` passes.

- [ ] **Step 4: Commit**

```bash
git add web/style.css
git commit -m "feat: graph view CSS — node cards, toolbar, breadcrumb, deep link styles"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| New nav rail item "Graph" after "Models" | Task 5 Step 1 |
| `/api/graph` endpoint with semantic edges only | Task 1 |
| Excluded templates server-side | Task 1 Step 2 (GRAPH_EXCLUDED_TEMPLATES) |
| React Flow + Dagre via CDN | Task 2 Step 1 |
| `/graph` added to KNOWN_PATHS | Task 2 Step 2 |
| Level 1: component map | Task 3 |
| Level 2: component interior with ghost cross-edges | Task 4 Step 3 |
| Level 3: focal node + n-hop with depth control | Task 4 Step 4 |
| Breadcrumb navigation | Task 3 Step 2 |
| URL-driven level state (shareable links) | Task 3 Step 3 (navToRoot/Component/Focus) |
| Branch prefix preserved in graph URLs | Task 3 Step 3 (buildRoute passes branch) |
| Edge colour consistency with EDGE_TYPE_STYLES | Task 3 Step 1 (EDGE_STYLES constants match) |
| Template colour from pack YAML | Task 4 Step 2 (buildRFNodesForNodes uses templateMap) |
| Edge type toggle pills | Task 3 Step 2 (GraphToolbar) |
| Toggle state in localStorage | Task 3 Step 3 (loadVisibleEdgeTypes / saveVisibleEdgeTypes) |
| Focal node search selector | Task 3 Step 2 (GraphToolbar search) |
| Node card `↗` link to node detail page | Task 4 Step 1 (NodeCardNode) |
| Minimap toggle | Task 3 Step 2 (GraphToolbar) |
| Layout reset button | Task 3 Step 2 (GraphToolbar, layoutKey) |
| Deep link from EdgePanel rows | Task 5 Step 4 |
| Deep link from node detail header | Task 5 Step 5 |
| Full-width canvas (no sidebar) | Task 3 Step 4 (showTree excludes graph) |

All spec requirements are covered.
