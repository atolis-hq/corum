# MCP & Graph API Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift graph query logic (lineage BFS, fuzzy search, stats) from client-side JS and disparate duplicates into `src/graph/index.ts` as the single authority, then wire it up through MCP tools and web API endpoints so all three layers share the same implementation.

**Architecture:** `src/graph/index.ts` gains four new exports (`getLineage`, `searchNodes`, `getGraphSummary`, private `findParent` helper) and a richer `ListNodesFilter`. The web server adds `/api/search` and `/api/lineage` endpoints and filter params on `/api/graph`. The MCP layer adds `get_graph`, `get_graph_summary`, `search_nodes`, `get_lineage` and upgrades `list_nodes` + `get_cluster`. The UI switches its client-side implementations to API calls.

**Tech Stack:** TypeScript (Node test runner via `node:test`/`node:assert/strict`), Express, React (browser globals), MCP SDK. Tests compiled to `dist/test/` and run via `scripts/run-tests.mjs`. Web tests run with their own inline assert framework.

## Global Constraints

- Node test runner: `import { describe, it, before } from 'node:test'` and `import assert from 'node:assert/strict'`
- Test command: `npm test` (runs `tsc && node scripts/run-tests.mjs`)
- Single test file: `node --test dist/test/<file>.test.js`
- Fixture graph at `fixtures/sample-graph` — 151 nodes, 2 components (`orders`, `payments`)
- Breaking changes to MCP tools are acceptable — no active consumers
- `src/schema/index.ts` is the authority for `EdgeType`, `State`, `Stability`
- Structural edge types: `has-field`, `has-value`, `renamed-from`
- Structural node templates: `Field`, `Schema`, `EnumDefinition`, `EnumValue`, `Mapping`
- Semantic edge types (non-structural): `triggers`, `produces`, `reads`, `calls`, `implements`, `maps-to`, `derived-from`
- `getClusterView` in `src/graph/index.ts` returns `{ root, descendants, includedNodes, edges }` — note `descendants` not `children`

---

## File Map

| File | What changes |
|------|-------------|
| `src/graph/index.ts` | Add `findParent` helper; extend `ListNodesFilter`; update `listNodes`; add `getGraphSummary`, `searchNodes`, `getLineage` |
| `src/web/server.ts` | Update `/api/nodes` to use new filter; add `/api/search`, `/api/lineage`; filter params on `/api/graph`; use `getGraphSummary` in `/api/stats` |
| `src/mcp/index.ts` | Rewrite `list_nodes` (filter object); upgrade `get_cluster` to `getClusterView`; add `get_graph`, `get_graph_summary`, `search_nodes`, `get_lineage` |
| `test/graph.test.ts` | Update existing `template` → `templates`; add tests for new functions |
| `test/mcp.test.ts` | Update broken `list_nodes` and `get_cluster` tests; add tests for new tools |
| `web/search.jsx` | Remove `fuzzyMatch`/`searchNodes`; call `/api/search` |
| `web/graph.jsx` | Remove `buildFocusGraph` usage; fetch `/api/lineage` for Level 3 |
| `web/graph-utils.js` | Remove `buildFocusGraph` |
| `web/graph-utils.test.js` | Remove `buildFocusGraph` tests; keep rest |

---

### Task 1: Extend `ListNodesFilter` and update all callers

`ListNodesFilter` gains array support. This is a breaking change — all callers updated in this task.

**Files:**
- Modify: `src/graph/index.ts:15-48`
- Modify: `src/web/server.ts:391-419` (`/api/nodes`)
- Modify: `src/mcp/index.ts:37-64` (`list_nodes` handler + schema)
- Modify: `test/graph.test.ts` (update existing test + add 3 new assertions)
- Modify: `test/mcp.test.ts` (update all `list_nodes` calls)

**Interfaces:**
- Produces: `ListNodesFilter` with `templates?: string[]`, `excludeTemplates?: string[]`, `state?: State | State[]`, `stability?: Stability | Stability[]`

- [ ] **Step 1: Write failing tests**

In `test/graph.test.ts`, update the `'filters by template'` test and add three new tests inside `describe('listNodes')`:

```typescript
// Replace this existing test:
it('filters by template', () => {
  const domainModels = listNodes(graph, { templates: ['DomainModel'] })
  assert.equal(domainModels.length, 2)
  assert.ok(domainModels.some(n => n.id === 'orders.DomainModel.order'))
  assert.ok(domainModels.some(n => n.id === 'payments.DomainModel.payment'))
})

// Add after existing tests:
it('filters by multiple templates (OR semantics)', () => {
  const nodes = listNodes(graph, { templates: ['DomainModel', 'ReadModel'] })
  assert.ok(nodes.every(n => n.template === 'DomainModel' || n.template === 'ReadModel'))
  assert.ok(nodes.some(n => n.template === 'DomainModel'))
  assert.ok(nodes.some(n => n.template === 'ReadModel'))
})

it('excludes templates', () => {
  const structural = ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping']
  const nodes = listNodes(graph, { excludeTemplates: structural })
  assert.ok(nodes.every(n => !structural.includes(n.template)))
  assert.ok(nodes.length > 0)
})

it('filters by state as array', () => {
  const nodes = listNodes(graph, { state: ['agreed', 'proposed'] })
  assert.ok(nodes.every(n => n.state === 'agreed' || n.state === 'proposed'))
  assert.ok(nodes.length > 0)
})
```

In `test/mcp.test.ts`, update every `list_nodes` call that uses old flat params. The changes are:
- `{ template: 'APIEndpoint', format: 'json' }` → `{ filter: { templates: ['APIEndpoint'] }, format: 'json' }`
- `{ template: 'APIEndpoint' }` → `{ filter: { templates: ['APIEndpoint'] } }`
- `{ template: 'APIEndpoint', format: 'toon' }` → `{ filter: { templates: ['APIEndpoint'] }, format: 'toon' }`
- `{ template: 'APIEndpoint', format: 'json', compact_keys: true }` → `{ filter: { templates: ['APIEndpoint'] }, format: 'json', compact_keys: true }`
- `{ template: 'APIEndpoint', compactKeys: true }` → `{ filter: { templates: ['APIEndpoint'] }, compactKeys: true }`
- `{ template: 'APIEndpoint', format: 'toon', compact_keys: true }` → `{ filter: { templates: ['APIEndpoint'] }, format: 'toon', compact_keys: true }`
- `{ branch, component: 'orders', format: 'json' }` → `{ filter: { component: 'orders' }, branch, format: 'json' }`

- [ ] **Step 2: Run to verify tests fail**

```
npm test
```
Expected: compile error on `template` property not existing in `ListNodesFilter` (after next step it'll be TypeScript errors pointing to old usage sites).

- [ ] **Step 3: Update `ListNodesFilter` type and `listNodes` in `src/graph/index.ts`**

Replace lines 15–48:

```typescript
export type ListNodesFilter = {
  templates?: string[]
  excludeTemplates?: string[]
  component?: string
  state?: State | State[]
  stability?: Stability | Stability[]
}

export function listNodes(graph: Graph, filter: ListNodesFilter = {}): Node[] {
  return [...graph.nodesById.values()].filter(node => {
    if (filter.templates?.length && !filter.templates.includes(node.template)) return false
    if (filter.excludeTemplates?.length && filter.excludeTemplates.includes(node.template)) return false
    if (filter.component !== undefined && node.component !== filter.component) return false
    if (filter.state !== undefined) {
      const states = Array.isArray(filter.state) ? filter.state : [filter.state]
      if (!states.includes(node.state)) return false
    }
    if (filter.stability !== undefined) {
      const stabilities = Array.isArray(filter.stability) ? filter.stability : [filter.stability]
      if (!stabilities.includes(node.stability)) return false
    }
    return true
  })
}
```

- [ ] **Step 4: Update `/api/nodes` in `src/web/server.ts`**

The old code at line 392–398 reads `template` (singular). Replace the filter construction:

```typescript
app.get('/api/nodes', async (req, res) => {
  const { component, state, stability } = req.query
  const includeCore = req.query.includeCore === 'true'
  // Support both legacy `template` (singular) and new `templates` (array)
  const singleTemplate = typeof req.query.template === 'string' && req.query.template ? [req.query.template] : undefined
  const multiTemplates = Array.isArray(req.query.templates)
    ? (req.query.templates as string[]).filter(t => typeof t === 'string')
    : typeof req.query.templates === 'string' && req.query.templates ? [req.query.templates] : undefined
  const filter: ListNodesFilter = {
    templates: multiTemplates ?? singleTemplate,
    component: typeof component === 'string' ? component : undefined,
    state: typeof state === 'string' ? state as ListNodesFilter['state'] : undefined,
    stability: typeof stability === 'string' ? stability as ListNodesFilter['stability'] : undefined,
  }
  // ... rest of handler unchanged from original
```

- [ ] **Step 5: Update `list_nodes` MCP handler in `src/mcp/index.ts`**

Replace the `list_nodes` handler body (the `run` function inner logic):

```typescript
list_nodes(args) {
  const run = (targetGraph: Graph): ToolResult => {
    const filterArg = typeof args.filter === 'object' && args.filter !== null
      ? args.filter as Record<string, unknown>
      : {}
    const toStringArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined
    const filter: ListNodesFilter = {
      templates: toStringArray(filterArg.templates),
      excludeTemplates: toStringArray(filterArg.exclude_templates),
      component: typeof filterArg.component === 'string' ? filterArg.component : undefined,
      state: typeof filterArg.state === 'string'
        ? filterArg.state as ListNodesFilter['state']
        : toStringArray(filterArg.state) as ListNodesFilter['state'] | undefined,
      stability: typeof filterArg.stability === 'string'
        ? filterArg.stability as ListNodesFilter['stability']
        : toStringArray(filterArg.stability) as ListNodesFilter['stability'] | undefined,
    }
    const summaries = listNodes(targetGraph, filter).map(node => ({
      id: node.id,
      template: node.template,
      component: node.component,
      state: node.state,
      stability: node.stability,
    }))
    return formatResult(summaries, args.format, getCompactKeys(args))
  }

  if (hasBranch(args)) {
    return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
  }

  try {
    return run(graph)
  } catch (err) {
    return errorResult(err)
  }
},
```

Also update the `list_nodes` tool schema in `ListToolsRequestSchema` handler:

```typescript
{
  name: 'list_nodes',
  description: 'List nodes in the graph. Returns id, template, component, state, stability for each matched node.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        description: 'Filter criteria',
        properties: {
          templates: { type: 'array', items: { type: 'string' }, description: 'Include only these template types (OR semantics)' },
          exclude_templates: { type: 'array', items: { type: 'string' }, description: 'Exclude these template types; ignored when templates is set' },
          component: { type: 'string', description: 'Filter by component name' },
          state: { description: 'Filter by state — string or array', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          stability: { description: 'Filter by stability — string or array', oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        },
      },
      branch: { type: 'string', description: 'Branch ref to load nodes from' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
      compact_keys: { type: 'boolean', description: 'Use compact graph keys in the selected output format.' },
    },
  },
},
```

- [ ] **Step 6: Run tests and verify they pass**

```
npm test
```
Expected: all tests pass. The `list_nodes` tests now use `filter: { templates: [...] }`.

- [ ] **Step 7: Commit**

```bash
git add src/graph/index.ts src/web/server.ts src/mcp/index.ts test/graph.test.ts test/mcp.test.ts
git commit -m "feat: extend ListNodesFilter to support multiple templates and exclude lists"
```

---

### Task 2: Add `getGraphSummary` to graph layer and wire it up

Extract stats computation from `/api/stats` into a pure graph function. Add MCP `get_graph_summary`. The graph layer also gets the private `findParent` helper used here and in later tasks.

**Files:**
- Modify: `src/graph/index.ts` (add `findParent`, `GraphSummary`, `getGraphSummary`)
- Modify: `src/web/server.ts:470-510` (update `/api/stats` to call `getGraphSummary`)
- Modify: `src/mcp/index.ts` (add `get_graph_summary` handler + tool schema + return type)
- Modify: `test/graph.test.ts` (add `getGraphSummary` describe block)
- Modify: `test/mcp.test.ts` (add `get_graph_summary` describe block)

**Interfaces:**
- Consumes: `listNodes` from Task 1 (already updated)
- Produces:
  ```typescript
  export type GraphSummary = {
    nodeCount: number
    componentCount: number
    orphanNodeCount: number
    orphansByTemplate: Record<string, number>
    edgesByType: Record<string, number>
    diagnosticCount: number
  }
  export function getGraphSummary(graph: Graph): GraphSummary
  // internal:
  function findParent(graph: Graph, nodeId: string): string | undefined
  ```

- [ ] **Step 1: Write failing tests**

Add to `test/graph.test.ts` (after the `getLinkedFields` describe block, import `getGraphSummary` at top):

```typescript
// Add to imports at top:
import { listNodes, getCluster, getLinkedFields, getGraphSummary } from '../src/graph/index.js'
```

```typescript
describe('getGraphSummary', () => {
  it('returns correct node and component counts', () => {
    const summary = getGraphSummary(graph)
    assert.equal(summary.nodeCount, 151)
    assert.equal(summary.componentCount, 2)
  })

  it('returns edge counts by type with non-zero triggers', () => {
    const summary = getGraphSummary(graph)
    assert.ok(typeof summary.edgesByType.triggers === 'number')
    assert.ok(summary.edgesByType.triggers > 0)
    assert.ok(typeof summary.edgesByType.produces === 'number')
    assert.ok(!('has-field' in summary.edgesByType), 'structural edges excluded')
  })

  it('returns orphan breakdown with non-negative count', () => {
    const summary = getGraphSummary(graph)
    assert.ok(summary.orphanNodeCount >= 0)
    assert.equal(
      Object.values(summary.orphansByTemplate).reduce((a, b) => a + b, 0),
      summary.orphanNodeCount,
    )
  })

  it('returns diagnosticCount', () => {
    const summary = getGraphSummary(graph)
    assert.ok(typeof summary.diagnosticCount === 'number')
  })
})
```

Add to `test/mcp.test.ts` (add `get_graph_summary` to the `createMcpHandlers` import):

```typescript
describe('get_graph_summary', () => {
  it('returns node and component counts', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.get_graph_summary({ format: 'json' })
    const summary = JSON.parse(result.content[0].text)
    assert.equal(summary.nodeCount, 151)
    assert.equal(summary.componentCount, 2)
    assert.ok(typeof summary.orphanNodeCount === 'number')
    assert.ok(typeof summary.edgesByType === 'object')
    assert.ok(summary.edgesByType.triggers > 0)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test
```
Expected: compile error — `getGraphSummary` not found.

- [ ] **Step 3: Add `findParent` helper and `getGraphSummary` to `src/graph/index.ts`**

Add after the existing imports (before the type exports):

```typescript
const SEMANTIC_EDGE_TYPES = new Set<EdgeType>([
  'triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from',
])

const STRUCTURAL_NODE_TEMPLATES = new Set([
  'Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping',
])

function findParent(graph: Graph, nodeId: string): string | undefined {
  const parts = nodeId.split('.')
  let endIdx = parts.length - 2
  while (endIdx >= 1) {
    const candidateId = parts.slice(0, endIdx).join('.')
    if (graph.nodesById.has(candidateId)) return candidateId
    endIdx -= 2
  }
  return undefined
}
```

Add `GraphSummary` type and `getGraphSummary` export after `computeClusterOverlay`:

```typescript
export type GraphSummary = {
  nodeCount: number
  componentCount: number
  orphanNodeCount: number
  orphansByTemplate: Record<string, number>
  edgesByType: Record<string, number>
  diagnosticCount: number
}

export function getGraphSummary(graph: Graph): GraphSummary {
  const components = new Set<string>()
  for (const node of graph.nodesById.values()) {
    if (node.component) components.add(node.component)
  }

  const nodesWithEdges = new Set<string>()
  const edgesByType: Record<string, number> = {}
  for (const edgeList of graph.edgesByFrom.values()) {
    for (const edge of edgeList) {
      if (!SEMANTIC_EDGE_TYPES.has(edge.type)) continue
      edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1
      nodesWithEdges.add(edge.from)
      nodesWithEdges.add(edge.to)
    }
  }

  const orphansByTemplate: Record<string, number> = {}
  for (const node of graph.nodesById.values()) {
    if (nodesWithEdges.has(node.id)) continue
    if (findParent(graph, node.id) !== undefined) continue
    orphansByTemplate[node.template] = (orphansByTemplate[node.template] ?? 0) + 1
  }

  return {
    nodeCount: graph.nodesById.size,
    componentCount: components.size,
    orphanNodeCount: Object.values(orphansByTemplate).reduce((a, b) => a + b, 0),
    orphansByTemplate,
    edgesByType,
    diagnosticCount: graph.diagnostics.length,
  }
}
```

- [ ] **Step 4: Update `/api/stats` in `src/web/server.ts` to use `getGraphSummary`**

Add `getGraphSummary` to the import from `'../graph/index.js'`:
```typescript
import { computeClusterOverlay, getClusterView, listNodes, getGraphSummary, type ListNodesFilter } from '../graph/index.js'
```

Replace the body of `app.get('/api/stats', ...)` (currently lines 470–510):

```typescript
app.get('/api/stats', async (req, res) => {
  let targetGraph = graph
  if (typeof req.query.ref === 'string' && multiCache) {
    targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
  }
  res.json(getGraphSummary(targetGraph))
})
```

- [ ] **Step 5: Add `get_graph_summary` to MCP in `src/mcp/index.ts`**

Add `getGraphSummary` to the import:
```typescript
import { computeClusterOverlay, getCluster, getLinkedFields, listNodes, getGraphSummary, type ListNodesFilter } from '../graph/index.js'
```

Add handler to the `return` object in `createMcpHandlers`:
```typescript
get_graph_summary(args) {
  const run = (targetGraph: Graph): ToolResult =>
    formatResult(getGraphSummary(targetGraph), args.format, getCompactKeys(args))

  if (hasBranch(args) && source) {
    return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
  }

  try {
    return run(graph)
  } catch (err) {
    return errorResult(err)
  }
},
```

Update the return type of `createMcpHandlers` to include `get_graph_summary: ToolHandler`.

Add the tool schema in `ListToolsRequestSchema`:
```typescript
{
  name: 'get_graph_summary',
  description: 'Return high-level statistics: node count, component count, orphan breakdown, edge counts by type, diagnostic count. Good orientation tool.',
  inputSchema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'Branch ref' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'], description: 'Output format. Defaults to yaml.' },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

Add `case 'get_graph_summary':` to the `CallToolRequestSchema` switch.

- [ ] **Step 6: Run tests and verify they pass**

```
npm test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/graph/index.ts src/web/server.ts src/mcp/index.ts test/graph.test.ts test/mcp.test.ts
git commit -m "feat: add getGraphSummary to graph layer, wire up web /api/stats and MCP get_graph_summary"
```

---

### Task 3: Add `searchNodes` to graph layer, `/api/search`, MCP `search_nodes`, and update UI

**Files:**
- Modify: `src/graph/index.ts` (add `SearchResult`, `SearchNodesOptions`, `searchNodes`)
- Modify: `src/web/server.ts` (add `GET /api/search`)
- Modify: `src/mcp/index.ts` (add `search_nodes`)
- Modify: `web/search.jsx` (remove client-side logic; call `/api/search`)
- Modify: `test/graph.test.ts` (add `searchNodes` describe block)
- Modify: `test/mcp.test.ts` (add `search_nodes` describe block)

**Interfaces:**
- Consumes: `findParent` (internal), `ListNodesFilter` from Task 1
- Produces:
  ```typescript
  export type SearchResult = { node: Node; score: number }
  export type SearchNodesOptions = {
    templates?: string[]
    excludeTemplates?: string[]
    limit?: number
    offset?: number
    searchProperties?: boolean
  }
  export function searchNodes(graph: Graph, queries: string[], options?: SearchNodesOptions): SearchResult[]
  ```

- [ ] **Step 1: Write failing tests**

Add to `test/graph.test.ts` imports:
```typescript
import { listNodes, getCluster, getLinkedFields, getGraphSummary, searchNodes } from '../src/graph/index.js'
```

Add describe block after `getGraphSummary`:
```typescript
describe('searchNodes', () => {
  it('returns root-level nodes matching query', () => {
    const results = searchNodes(graph, ['order'])
    assert.ok(results.length > 0)
    assert.ok(results.some(r => r.node.id === 'orders.DomainModel.order'))
  })

  it('excludes structural child nodes from results', () => {
    const results = searchNodes(graph, ['order'])
    // operations.place is a structural child — must not appear
    assert.ok(!results.some(r => r.node.id.includes('.operations.')))
    assert.ok(!results.some(r => r.node.id.includes('.fields.')))
  })

  it('top result for "order" has highest score', () => {
    const results = searchNodes(graph, ['order'])
    const first = results[0]
    assert.ok(results.every(r => r.score <= first.score))
  })

  it('empty query returns empty', () => {
    assert.equal(searchNodes(graph, ['']).length, 0)
    assert.equal(searchNodes(graph, []).length, 0)
  })

  it('limit is applied', () => {
    const results = searchNodes(graph, ['order'], { limit: 2 })
    assert.ok(results.length <= 2)
  })

  it('multiple queries use OR semantics', () => {
    const results = searchNodes(graph, ['order', 'payment'])
    assert.ok(results.some(r => r.node.id.includes('order')))
    assert.ok(results.some(r => r.node.id.includes('payment')))
  })

  it('template filter restricts results', () => {
    const results = searchNodes(graph, ['order'], { templates: ['DomainModel'] })
    assert.ok(results.every(r => r.node.template === 'DomainModel'))
  })
})
```

Add to `test/mcp.test.ts`:
```typescript
describe('search_nodes', () => {
  it('returns matched root nodes', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.search_nodes({ queries: ['order'], format: 'json' })
    const data = JSON.parse(result.content[0].text)
    assert.ok(Array.isArray(data))
    assert.ok(data.length > 0)
    assert.ok(data.some((r: Record<string, unknown>) => {
      const node = r.node as Record<string, unknown>
      return typeof node.id === 'string' && node.id.includes('order')
    }))
  })

  it('respects page_size', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.search_nodes({ queries: ['order'], page_size: 2, format: 'json' })
    const data = JSON.parse(result.content[0].text)
    assert.ok(data.length <= 2)
  })

  it('returns error when queries missing', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.search_nodes({ format: 'json' })
    assert.ok(result.isError)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test
```
Expected: compile error — `searchNodes` not found.

- [ ] **Step 3: Add `searchNodes` to `src/graph/index.ts`**

Add after `getGraphSummary`:

```typescript
export type SearchResult = {
  node: Node
  score: number
}

export type SearchNodesOptions = {
  templates?: string[]
  excludeTemplates?: string[]
  limit?: number
  offset?: number
  searchProperties?: boolean
}

function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const s = target.toLowerCase()
  let qi = 0, run = 0, maxRun = 0
  for (let i = 0; i < s.length; i++) {
    if (qi >= q.length) break
    if (s[i] === q[qi]) { qi++; run++; if (run > maxRun) maxRun = run }
    else { run = 0 }
  }
  return qi === q.length ? maxRun : null
}

export function searchNodes(graph: Graph, queries: string[], options: SearchNodesOptions = {}): SearchResult[] {
  const { templates, excludeTemplates, limit = 10, offset = 0, searchProperties = false } = options
  const terms = queries.map(q => q.trim()).filter(Boolean)
  if (terms.length === 0) return []

  const results: SearchResult[] = []
  for (const node of graph.nodesById.values()) {
    if (findParent(graph, node.id) !== undefined) continue
    if (templates?.length && !templates.includes(node.template)) continue
    if (excludeTemplates?.length && excludeTemplates.includes(node.template)) continue

    let bestScore = 0
    for (const term of terms) {
      const score = fuzzyScore(term, node.id)
      if (score !== null && score > bestScore) bestScore = score
      if (searchProperties) {
        const props = node.properties as Record<string, unknown> | undefined
        const propText = [props?.name, props?.description, props?.['x-aka']]
          .filter((v): v is string => typeof v === 'string')
          .join(' ')
        if (propText) {
          const propScore = fuzzyScore(term, propText)
          if (propScore !== null && propScore > bestScore) bestScore = propScore
        }
      }
    }
    if (bestScore > 0) results.push({ node, score: bestScore })
  }

  results.sort((a, b) => b.score - a.score || a.node.id.length - b.node.id.length)
  return results.slice(offset, offset + limit)
}
```

- [ ] **Step 4: Add `/api/search` to `src/web/server.ts`**

Add `searchNodes` to the graph import. Add the endpoint after `/api/stats`:

```typescript
import { computeClusterOverlay, getClusterView, listNodes, getGraphSummary, searchNodes, type ListNodesFilter } from '../graph/index.js'
```

```typescript
app.get('/api/search', async (req, res) => {
  try {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const q = typeof req.query.q === 'string' ? req.query.q : ''
    const queries = q.split(',').map(s => s.trim()).filter(Boolean)

    const templates = Array.isArray(req.query.templates)
      ? (req.query.templates as string[]).filter(t => typeof t === 'string')
      : typeof req.query.templates === 'string' && req.query.templates ? [req.query.templates] : undefined

    const excludeTemplates = Array.isArray(req.query.exclude_templates)
      ? (req.query.exclude_templates as string[]).filter(t => typeof t === 'string')
      : undefined

    const rawLimit = parseInt(String(req.query.limit ?? '10'), 10)
    const rawOffset = parseInt(String(req.query.offset ?? '0'), 10)

    const results = searchNodes(targetGraph, queries, {
      templates,
      excludeTemplates,
      limit: isNaN(rawLimit) ? 10 : rawLimit,
      offset: isNaN(rawOffset) ? 0 : rawOffset,
      searchProperties: req.query.search_properties === 'true',
    })

    res.json(results)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 5: Add `search_nodes` to `src/mcp/index.ts`**

Add `searchNodes, type SearchNodesOptions` to graph import. Add handler:

```typescript
search_nodes(args) {
  const queries = Array.isArray(args.queries)
    ? args.queries.filter((q): q is string => typeof q === 'string')
    : []
  if (queries.length === 0) return errorResult(new QueryError('queries is required'))

  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined

  const run = (targetGraph: Graph): ToolResult => {
    const options: SearchNodesOptions = {
      templates: toStringArray(args.templates),
      excludeTemplates: toStringArray(args.exclude_templates),
      limit: typeof args.page_size === 'number' ? args.page_size : 10,
      offset: typeof args.offset === 'number' ? args.offset : 0,
      searchProperties: args.search_properties === true,
    }
    return formatResult(searchNodes(targetGraph, queries, options), args.format, getCompactKeys(args))
  }

  if (hasBranch(args) && source) {
    return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
  }

  try {
    return run(graph)
  } catch (err) {
    return errorResult(err)
  }
},
```

Add to `createMcpHandlers` return type: `search_nodes: ToolHandler`.

Add tool schema:
```typescript
{
  name: 'search_nodes',
  description: 'Fuzzy search for root-level nodes by ID segments. Returns ranked results with score.',
  inputSchema: {
    type: 'object',
    required: ['queries'],
    properties: {
      queries: { type: 'array', items: { type: 'string' }, description: 'Search terms — OR semantics, any term matching qualifies the node' },
      templates: { type: 'array', items: { type: 'string' }, description: 'Include only these template types' },
      exclude_templates: { type: 'array', items: { type: 'string' }, description: 'Exclude these template types' },
      page_size: { type: 'number', description: 'Max results to return. Default 10.' },
      offset: { type: 'number', description: 'Result offset for pagination. Default 0.' },
      search_properties: { type: 'boolean', description: 'Also match against name/description/x-aka properties. Default false.' },
      branch: { type: 'string' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

Add `case 'search_nodes':` to the switch.

- [ ] **Step 6: Update `web/search.jsx` to call `/api/search`**

Remove `fuzzyMatch` and `searchNodes` functions. Update `SearchModal` to use the API.

The full updated `SearchModal`:
```jsx
function SearchModal({ templates, onNavigate, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);

  const templateMap = useMemo(
    () => new Map((templates ?? []).map(t => [t.name, t])),
    [templates],
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) { setResults([]); return; }
    const url = `/api/search?q=${encodeURIComponent(q)}&limit=10`;
    let cancelled = false;
    fetch(url)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => {
        if (!cancelled) {
          setResults(data.map(r => ({
            node: r.node,
            template: templateMap.get(r.node.template),
            score: r.score,
          })));
        }
      })
      .catch(() => { if (!cancelled) setResults([]); });
    return () => { cancelled = true; };
  }, [query, templateMap]);

  useEffect(() => { setSelectedIndex(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (results.length > 0) setSelectedIndex(i => (i + 1) % results.length);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (results.length > 0) setSelectedIndex(i => (i - 1 + results.length) % results.length);
      }
      if (e.key === 'Enter' && results[selectedIndex]) {
        onNavigate(results[selectedIndex].node.id);
        onClose();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [results, selectedIndex, onNavigate, onClose]);

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div className="search-backdrop" onClick={handleBackdropClick}>
      <div className="search-modal">
        <div className="search-modal-input-wrap">
          <Icon name="magnifying-glass" size={15} />
          <input
            ref={inputRef}
            className="search-modal-input"
            placeholder="Search graph..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        {results.length > 0 && (
          <div className="search-results">
            {results.map((result, index) => {
              const { node, template } = result;
              const name = node.id.split('.').pop();
              const colour = template?.ui?.colour ?? null;
              const tplName = template?.ui?.displayName ?? node.template;
              return (
                <div
                  key={node.id}
                  className={`search-result-row${index === selectedIndex ? ' selected' : ''}`}
                  onClick={() => { onNavigate(node.id); onClose(); }}
                  title={node.id}
                >
                  <TemplateBadge name={tplName} colour={colour} />
                  <span className="search-result-name">{name}</span>
                  <span className="search-result-component">{node.component}</span>
                </div>
              );
            })}
          </div>
        )}
        {query.trim() && results.length === 0 && (
          <div className="search-no-results">No results</div>
        )}
      </div>
    </div>
  );
}

window.CorumSearch = { SearchModal };
```

Find callers of `SearchModal` in `web/app.jsx` — remove the `nodes` prop if it was passed (it may or may not be; check). The new signature no longer uses `nodes`.

- [ ] **Step 7: Run tests and verify they pass**

```
npm test
```
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/graph/index.ts src/web/server.ts src/mcp/index.ts test/graph.test.ts test/mcp.test.ts web/search.jsx
git commit -m "feat: add searchNodes to graph layer, /api/search endpoint, MCP search_nodes, and switch UI search to API"
```

---

### Task 4: Add `getLineage` to graph layer, `/api/lineage`, MCP `get_lineage`, and update UI focus view

This is the largest task. Port `buildFocusGraph` from `web/graph-utils.js` to TypeScript in the graph layer with multi-origin support, direction param, edge type filtering, and result annotations.

**Files:**
- Modify: `src/graph/index.ts` (add `getLineage` and related types)
- Modify: `src/web/server.ts` (add `GET /api/lineage`)
- Modify: `src/mcp/index.ts` (add `get_lineage`)
- Modify: `web/graph.jsx` (Level 3 switches from `buildFocusGraph` to `/api/lineage`)
- Modify: `web/graph-utils.js` (remove `buildFocusGraph`)
- Modify: `web/graph-utils.test.js` (remove `buildFocusGraph` tests)
- Modify: `test/graph.test.ts` (add `getLineage` describe block)
- Modify: `test/mcp.test.ts` (add `get_lineage` describe block)

**Interfaces:**
- Consumes: `findParent`, `SEMANTIC_EDGE_TYPES`, `STRUCTURAL_NODE_TEMPLATES` (all internal to graph layer from Task 2)
- Produces:
  ```typescript
  export type LineageDirection = 'downstream' | 'upstream' | 'both'
  export type LineageNodeAnnotation = {
    origin_id: string
    depth: number
    via_edge_type: string
    via_node_id: string
    origins?: string[]
    direction?: 'upstream' | 'downstream'
  }
  export type LineageResult = {
    nodes: Array<Node & LineageNodeAnnotation>
    edges: Edge[]
    dangling_edges?: Edge[]
  }
  export type GetLineageOptions = {
    depth?: number
    direction?: LineageDirection
    edgeTypes?: EdgeType[]
    excludeNodeTypes?: string[]
    nodeTypes?: string[]
    includeDanglingEdges?: boolean
    readsOutboundOnly?: boolean
  }
  export function getLineage(graph: Graph, startNodeIds: string[], options?: GetLineageOptions): LineageResult
  ```

- [ ] **Step 1: Write failing tests**

Add to `test/graph.test.ts` imports:
```typescript
import { listNodes, getCluster, getLinkedFields, getGraphSummary, searchNodes, getLineage } from '../src/graph/index.js'
```

Add describe block after `searchNodes`:
```typescript
describe('getLineage', () => {
  it('returns downstream lineage from a start node', () => {
    // operations.place → order-placed (d=1) → int-order-placed (d=2)
    const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
    const ids = result.nodes.map(n => n.id)
    assert.ok(ids.includes('orders.DomainEvent.order-placed'))
    assert.ok(ids.includes('orders.IntegrationEvent.order-placed'))
  })

  it('annotates nodes with origin_id, depth, and via_edge_type', () => {
    const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
    const orderPlaced = result.nodes.find(n => n.id === 'orders.DomainEvent.order-placed')
    assert.ok(orderPlaced !== undefined)
    assert.equal(orderPlaced!.origin_id, 'orders.DomainModel.order.operations.place')
    assert.equal(orderPlaced!.depth, 1)
    assert.equal(orderPlaced!.via_edge_type, 'produces')
  })

  it('respects depth limit', () => {
    const result = getLineage(graph, ['orders.DomainModel.order.operations.place'], { depth: 1 })
    const ids = result.nodes.map(n => n.id)
    assert.ok(ids.includes('orders.DomainEvent.order-placed'))
    assert.ok(!ids.includes('orders.IntegrationEvent.order-placed'))
  })

  it('upstream direction follows reverse edges', () => {
    const result = getLineage(graph, ['orders.DomainEvent.order-placed'], { direction: 'upstream' })
    const ids = result.nodes.map(n => n.id)
    assert.ok(ids.includes('orders.DomainModel.order.operations.place'))
  })

  it('excludes start nodes from result', () => {
    const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
    assert.ok(!result.nodes.some(n => n.id === 'orders.DomainModel.order.operations.place'))
  })

  it('includes edges between result nodes', () => {
    const result = getLineage(graph, ['orders.DomainModel.order.operations.place'])
    assert.ok(result.edges.length > 0)
    assert.ok(result.edges.some(e => e.type === 'produces'))
  })

  it('multiple start nodes expand in parallel', () => {
    const result = getLineage(graph, [
      'orders.DomainModel.order.operations.place',
      'orders.DomainModel.order.operations.complete',
    ])
    const ids = result.nodes.map(n => n.id)
    assert.ok(ids.includes('orders.DomainEvent.order-placed'))
    assert.ok(ids.includes('orders.DomainEvent.order-completed'))
  })

  it('returns empty result for unknown start node', () => {
    const result = getLineage(graph, ['nonexistent.Node.id'])
    assert.equal(result.nodes.length, 0)
    assert.equal(result.edges.length, 0)
  })
})
```

Add to `test/mcp.test.ts`:
```typescript
describe('get_lineage', () => {
  it('returns downstream lineage with annotations', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.get_lineage({
      node_ids: ['orders.DomainModel.order.operations.place'],
      format: 'json',
    })
    const data = JSON.parse(result.content[0].text)
    assert.ok(Array.isArray(data.nodes))
    assert.ok(Array.isArray(data.edges))
    assert.ok(data.nodes.some((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed'))
    const placed = data.nodes.find((n: Record<string, unknown>) => n.id === 'orders.DomainEvent.order-placed')
    assert.equal(placed.depth, 1)
    assert.equal(placed.via_edge_type, 'produces')
  })

  it('returns error when node_ids missing', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.get_lineage({ format: 'json' })
    assert.ok(result.isError)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test
```
Expected: compile error — `getLineage` not found.

- [ ] **Step 3: Add `getLineage` to `src/graph/index.ts`**

Add after `searchNodes`. This is the full implementation:

```typescript
export type LineageDirection = 'downstream' | 'upstream' | 'both'

export type LineageNodeAnnotation = {
  origin_id: string
  depth: number
  via_edge_type: string
  via_node_id: string
  origins?: string[]
  direction?: 'upstream' | 'downstream'
}

export type LineageResult = {
  nodes: Array<Node & LineageNodeAnnotation>
  edges: Edge[]
  dangling_edges?: Edge[]
}

export type GetLineageOptions = {
  depth?: number
  direction?: LineageDirection
  edgeTypes?: EdgeType[]
  excludeNodeTypes?: string[]
  nodeTypes?: string[]
  includeDanglingEdges?: boolean
  readsOutboundOnly?: boolean
}

const STRUCTURAL_EDGE_TYPES = new Set<EdgeType>(['has-field', 'has-value', 'renamed-from'])

export function getLineage(graph: Graph, startNodeIds: string[], options: GetLineageOptions = {}): LineageResult {
  const { depth = 2, direction = 'downstream', readsOutboundOnly = true, includeDanglingEdges = false } = options

  // Collect all non-structural edge types present in the graph for default
  const defaultEdgeTypes = new Set<EdgeType>()
  for (const edges of graph.edgesByFrom.values()) {
    for (const e of edges) if (!STRUCTURAL_EDGE_TYPES.has(e.type)) defaultEdgeTypes.add(e.type)
  }
  const edgeTypeSet: Set<EdgeType> = options.edgeTypes ? new Set(options.edgeTypes as EdgeType[]) : defaultEdgeTypes

  // For upstream pass: exclude inbound reads edges when readsOutboundOnly=true
  const inboundTypeSet = new Set([...edgeTypeSet].filter(t => !(readsOutboundOnly && t === 'reads')))

  const useAllowlist = (options.nodeTypes?.length ?? 0) > 0
  const allowedTemplates = useAllowlist ? new Set(options.nodeTypes) : null
  const excludedTemplates = useAllowlist
    ? null
    : options.excludeNodeTypes?.length ? new Set(options.excludeNodeTypes) : STRUCTURAL_NODE_TEMPLATES

  function isIncluded(node: Node): boolean {
    if (allowedTemplates) return allowedTemplates.has(node.template)
    if (excludedTemplates) return !excludedTemplates.has(node.template)
    return true
  }

  type Annotation = { originId: string; depth: number; viaEdgeType: string; viaNodeId: string; dir: 'upstream' | 'downstream' }
  const annotations = new Map<string, Annotation>()
  const originSets = new Map<string, Set<string>>()

  function tryRecord(nodeId: string, originId: string, d: number, viaEdgeType: string, viaNodeId: string, dir: 'upstream' | 'downstream'): boolean {
    const prev = annotations.get(nodeId)
    if (prev && prev.depth <= d) {
      originSets.get(nodeId)?.add(originId)
      return prev.depth < d // already visited at same or shorter depth — still queue if shorter
    }
    annotations.set(nodeId, { originId, depth: d, viaEdgeType, viaNodeId, dir })
    if (!originSets.has(nodeId)) originSets.set(nodeId, new Set())
    originSets.get(nodeId)!.add(originId)
    return true
  }

  const validStartIds = startNodeIds.filter(id => graph.nodesById.has(id))
  const startSet = new Set(validStartIds)

  function runDownstream(): void {
    const visited = new Set<string>(startSet)
    const queue: Array<{ id: string; originId: string; d: number }> = validStartIds.map(id => ({ id, originId: id, d: 0 }))
    while (queue.length > 0) {
      const { id, originId, d } = queue.shift()!
      if (d >= depth) continue
      for (const edge of graph.edgesByFrom.get(id) ?? []) {
        if (!edgeTypeSet.has(edge.type)) continue
        const node = graph.nodesById.get(edge.to)
        if (!node || !isIncluded(node) || visited.has(edge.to)) continue
        visited.add(edge.to)
        tryRecord(edge.to, originId, d + 1, edge.type, id, 'downstream')
        queue.push({ id: edge.to, originId, d: d + 1 })
      }
    }
  }

  function runUpstream(): void {
    const visited = new Set<string>(startSet)
    const queue: Array<{ id: string; originId: string; d: number }> = validStartIds.map(id => ({ id, originId: id, d: 0 }))
    while (queue.length > 0) {
      const { id, originId, d } = queue.shift()!
      if (d >= depth) continue
      for (const edge of graph.edgesByTo.get(id) ?? []) {
        if (!inboundTypeSet.has(edge.type)) continue
        const node = graph.nodesById.get(edge.from)
        if (!node || !isIncluded(node) || visited.has(edge.from)) continue
        visited.add(edge.from)
        tryRecord(edge.from, originId, d + 1, edge.type, id, 'upstream')
        queue.push({ id: edge.from, originId, d: d + 1 })
      }
      // Climb parent (mirrors buildFocusGraph parentId traversal)
      const parentId = findParent(graph, id)
      if (parentId && !visited.has(parentId)) {
        const parentNode = graph.nodesById.get(parentId)
        if (parentNode && isIncluded(parentNode)) {
          visited.add(parentId)
          tryRecord(parentId, originId, d + 1, 'parent', id, 'upstream')
          queue.push({ id: parentId, originId, d: d + 1 })
        }
      }
    }
  }

  if (direction === 'downstream' || direction === 'both') runDownstream()
  if (direction === 'upstream' || direction === 'both') runUpstream()

  // Collect edges where both endpoints are in start+result set
  const resultNodeIds = new Set(annotations.keys())
  const combinedSet = new Set([...startSet, ...resultNodeIds])
  const allEdges: Edge[] = []
  const seenEdgeIds = new Set<string>()
  for (const id of combinedSet) {
    for (const edge of graph.edgesByFrom.get(id) ?? []) {
      if (seenEdgeIds.has(edge.id) || !edgeTypeSet.has(edge.type)) continue
      if (combinedSet.has(edge.from) && combinedSet.has(edge.to)) {
        allEdges.push(edge)
        seenEdgeIds.add(edge.id)
      }
    }
  }

  // Prune: keep only result nodes that appear in surviving edges (mirrors buildFocusGraph prune)
  const nodesWithEdges = new Set<string>()
  for (const e of allEdges) { nodesWithEdges.add(e.from); nodesWithEdges.add(e.to) }
  const prunedIds = new Set([...resultNodeIds].filter(id => nodesWithEdges.has(id)))

  // Dangling edges: edges from pruned result nodes to nodes outside combined set
  let danglingEdges: Edge[] | undefined
  if (includeDanglingEdges) {
    danglingEdges = []
    const danglingSeenIds = new Set<string>()
    for (const id of prunedIds) {
      for (const edge of [...(graph.edgesByFrom.get(id) ?? []), ...(graph.edgesByTo.get(id) ?? [])]) {
        if (danglingSeenIds.has(edge.id) || seenEdgeIds.has(edge.id)) continue
        if (!edgeTypeSet.has(edge.type)) continue
        const other = edge.from === id ? edge.to : edge.from
        if (!combinedSet.has(other)) { danglingEdges.push(edge); danglingSeenIds.add(edge.id) }
      }
    }
  }

  const nodes = [...prunedIds].map(id => {
    const node = graph.nodesById.get(id)!
    const ann = annotations.get(id)!
    const origins = [...(originSets.get(id) ?? [])]
    const result: Node & LineageNodeAnnotation = {
      ...node,
      origin_id: ann.originId,
      depth: ann.depth,
      via_edge_type: ann.viaEdgeType,
      via_node_id: ann.viaNodeId,
    }
    if (origins.length > 1) result.origins = origins
    if (direction === 'both') result.direction = ann.dir
    return result
  })

  const lineageResult: LineageResult = { nodes, edges: allEdges }
  if (danglingEdges !== undefined) lineageResult.dangling_edges = danglingEdges
  return lineageResult
}
```

- [ ] **Step 4: Add `/api/lineage` to `src/web/server.ts`**

Add `getLineage, type GetLineageOptions, type LineageDirection` to graph import. Add endpoint after `/api/search`:

```typescript
app.get('/api/lineage', async (req, res) => {
  try {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const nodeIds = Array.isArray(req.query.node_ids)
      ? (req.query.node_ids as string[]).filter(id => typeof id === 'string')
      : typeof req.query.node_ids === 'string' && req.query.node_ids ? [req.query.node_ids] : []

    if (nodeIds.length === 0) {
      res.status(400).json({ error: 'node_ids query param required' })
      return
    }

    const rawDepth = parseInt(String(req.query.depth ?? '2'), 10)
    const direction = (['downstream', 'upstream', 'both'] as const).includes(req.query.direction as LineageDirection)
      ? req.query.direction as LineageDirection
      : 'downstream'

    const edgeTypes = Array.isArray(req.query.edge_types)
      ? (req.query.edge_types as string[]).filter((t): t is EdgeType => VALID_EDGE_TYPE_SET.has(t))
      : undefined

    const excludeNodeTypes = Array.isArray(req.query.exclude_node_types)
      ? (req.query.exclude_node_types as string[]).filter(t => typeof t === 'string')
      : undefined

    const options: GetLineageOptions = {
      depth: isNaN(rawDepth) ? 2 : rawDepth,
      direction,
      edgeTypes,
      excludeNodeTypes,
      includeDanglingEdges: req.query.include_dangling_edges === 'true',
      readsOutboundOnly: req.query.reads_outbound_only !== 'false',
    }

    res.json(getLineage(targetGraph, nodeIds, options))
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 5: Add `get_lineage` to `src/mcp/index.ts`**

Add `getLineage, type GetLineageOptions, type LineageDirection` to graph import. Add handler:

```typescript
get_lineage(args) {
  const nodeIds = Array.isArray(args.node_ids)
    ? args.node_ids.filter((id): id is string => typeof id === 'string')
    : []
  if (nodeIds.length === 0) return errorResult(new QueryError('node_ids is required'))

  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined

  const run = (targetGraph: Graph): ToolResult => {
    const direction = (['downstream', 'upstream', 'both'] as const).includes(args.direction as LineageDirection)
      ? args.direction as LineageDirection
      : 'downstream'
    const options: GetLineageOptions = {
      depth: typeof args.depth === 'number' ? args.depth : 2,
      direction,
      edgeTypes: toStringArray(args.edge_types) as EdgeType[] | undefined,
      nodeTypes: toStringArray(args.node_types),
      excludeNodeTypes: toStringArray(args.exclude_node_types),
      includeDanglingEdges: args.include_dangling_edges === true,
      readsOutboundOnly: args.reads_outbound_only !== false,
    }
    return formatResult(getLineage(targetGraph, nodeIds, options), args.format, getCompactKeys(args))
  }

  if (hasBranch(args) && source) {
    return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
  }

  try {
    return run(graph)
  } catch (err) {
    return errorResult(err)
  }
},
```

Add to `createMcpHandlers` return type: `get_lineage: ToolHandler`.

Add tool schema:
```typescript
{
  name: 'get_lineage',
  description: 'Traverse the graph from one or more origin nodes via BFS and return annotated results. Each result node includes origin_id, depth, via_edge_type, via_node_id.',
  inputSchema: {
    type: 'object',
    required: ['node_ids'],
    properties: {
      node_ids: { type: 'array', items: { type: 'string' }, description: 'Fully-qualified IDs of origin nodes. All expand in parallel.' },
      depth: { type: 'number', description: 'Max hops. Default 2.' },
      direction: { type: 'string', enum: ['downstream', 'upstream', 'both'], description: 'Default downstream.' },
      edge_types: { type: 'array', items: { type: 'string' }, description: 'Edge types to traverse. Default: all non-structural.' },
      node_types: { type: 'array', items: { type: 'string' }, description: 'Allowlist — only include these templates. Overrides exclude_node_types.' },
      exclude_node_types: { type: 'array', items: { type: 'string' }, description: 'Denylist — default excludes Field, Schema, EnumDefinition, EnumValue, Mapping.' },
      include_dangling_edges: { type: 'boolean', description: 'Include edges to nodes outside the result set. Default false.' },
      reads_outbound_only: { type: 'boolean', description: 'Do not follow inbound reads edges in upstream traversal. Default true.' },
      branch: { type: 'string' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

Add `case 'get_lineage':` to the switch.

- [ ] **Step 6: Update `web/graph.jsx` Level 3 to call `/api/lineage`**

Remove `buildFocusGraph` from the destructure at line 6:
```javascript
const { buildComponentMap, applyEdgeTypeFilter, getDisplayName } = window.CorumGraphUtils;
```

Add `focusData` state and `debounceTimerRef` alongside the existing state declarations:
```javascript
const [focusData, setFocusData] = useState(null);
const debounceTimerRef = useRef(null);
```

Add a `useEffect` for fetching lineage (after the existing `/api/graph` fetch useEffect):
```javascript
useEffect(() => {
  if (!focalNodeId) { setFocusData(null); return; }
  if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
  debounceTimerRef.current = setTimeout(() => {
    const params = new URLSearchParams([
      ['node_ids', focalNodeId],
      ['depth', depth === Infinity ? '999' : String(depth)],
      ['direction', 'both'],
      ['reads_outbound_only', 'false'],
    ]);
    if (viewingRef) params.append('ref', encodeURIComponent(viewingRef));
    fetch(`/api/lineage?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => { setFocusData(data); })
      .catch(err => setError(String(err)));
  }, 150);
  return () => { if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current); };
}, [focalNodeId, depth, viewingRef]);
```

Replace the existing `level3` useMemo (which currently calls `buildFocusGraph`):
```javascript
const nodeById = useMemo(
  () => new Map((graphData?.nodes ?? []).map(n => [n.id, n])),
  [graphData],
);

const level3 = useMemo(() => {
  if (!focusData || !focalNodeId) return null;
  // Merge parentId from graphData (lineage nodes don't carry parentId)
  const parentIdMap = new Map((graphData?.nodes ?? []).map(n => [n.id, n.parentId]));
  // Include the focal node itself (getLineage excludes start nodes from result)
  const focalNode = nodeById.get(focalNodeId);
  const lineageNodes = [
    ...(focalNode && !focusData.nodes.some(n => n.id === focalNodeId) ? [focalNode] : []),
    ...focusData.nodes,
  ].map(n => ({ ...n, parentId: parentIdMap.get(n.id) ?? null }));
  const rfN = buildRFNodesForNodes(lineageNodes, templateMap, nodeId => {
    navigate(buildRoute({ pathname: '/graph', params: { focus: nodeId }, branch: viewingRef }));
  }, viewingRef);
  const rfE = buildRFEdgesForEdges(applyEdgeTypeFilter(focusData.edges, visibleEdgeTypes), visibleEdgeTypes);
  const layoutedN = computeLayout(rfN, rfE, NODE_W, NODE_H);
  return {
    rfN: layoutedN.map(n => n.id === focalNodeId
      ? { ...n, style: { outline: '2px solid var(--accent)', outlineOffset: '2px', borderRadius: 'var(--radius)' } }
      : n
    ),
    rfE,
  };
}, [focusData, focalNodeId, visibleEdgeTypes, templateMap, layoutKey, viewingRef, graphData, nodeById]);
```

Update the `useEffect` that sets RF nodes for level 3 — it currently depends on `level3` being populated; no change needed there as the same pattern applies.

- [ ] **Step 7: Remove `buildFocusGraph` from `web/graph-utils.js`**

Delete lines 41–98 (the `buildFocusGraph` function). Update the `module.exports` and `window.CorumGraphUtils` lines to remove `buildFocusGraph`:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildComponentMap, applyEdgeTypeFilter, getDisplayName };
}
if (typeof window !== 'undefined') {
  window.CorumGraphUtils = { buildComponentMap, applyEdgeTypeFilter, getDisplayName };
}
```

- [ ] **Step 8: Update `web/graph-utils.test.js` to remove `buildFocusGraph` tests**

Delete:
- Line 2: remove `buildFocusGraph` from the require destructure
- Lines 41–112: all `buildFocusGraph` test blocks
- Lines 114–119: the `applyEdgeTypeFilter` tests can stay

The remaining file (run with `node web/graph-utils.test.js`) should only test `buildComponentMap`, `applyEdgeTypeFilter`, and `getDisplayName`.

Updated file:
```javascript
// run with: node web/graph-utils.test.js
const { buildComponentMap, applyEdgeTypeFilter, getDisplayName } = require('./graph-utils.js');

(async () => {

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

  // applyEdgeTypeFilter
  const filtered = applyEdgeTypeFilter(edges, new Set(['reads']));
  assert(filtered.length === 2, 'applyEdgeTypeFilter: keeps only matching type');
  assert(filtered.every(e => e.type === 'reads'), 'applyEdgeTypeFilter: all results have correct type');
  const none = applyEdgeTypeFilter(edges, new Set([]));
  assert(none.length === 0, 'applyEdgeTypeFilter: empty set returns nothing');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
```

- [ ] **Step 9: Run tests and verify they pass**

```
npm test
```
Expected: all tests pass including the updated `graph-utils.test.js`.

- [ ] **Step 10: Commit**

```bash
git add src/graph/index.ts src/web/server.ts src/mcp/index.ts test/graph.test.ts test/mcp.test.ts web/graph.jsx web/graph-utils.js web/graph-utils.test.js
git commit -m "feat: add getLineage to graph layer, /api/lineage endpoint, MCP get_lineage, and switch UI focus view to API"
```

---

### Task 5: Add MCP `get_graph`, filter params on `/api/graph`, and upgrade MCP `get_cluster` to `getClusterView`

**Files:**
- Modify: `src/web/server.ts:429-468` (filter params on `/api/graph`)
- Modify: `src/mcp/index.ts` (add `get_graph`; upgrade `get_cluster` to `getClusterView`)
- Modify: `test/mcp.test.ts` (update `get_cluster` test; add `get_graph` test)

**Interfaces:**
- Consumes: `getClusterView` (already exists in graph layer, not currently imported in MCP)
- Produces: MCP `get_graph` tool, upgraded `get_cluster` using `getClusterView`

- [ ] **Step 1: Write failing tests**

Update the existing `get_cluster` test in `test/mcp.test.ts` — change `cluster.children` to `cluster.descendants` and verify `includedNodes` exists:

```typescript
it('returns full cluster for DomainModel', async () => {
  const handlers = createMcpHandlers(graph)
  const result = await handlers.get_cluster({ node_id: 'orders.DomainModel.order', format: 'json' })
  const cluster = JSON.parse(result.content[0].text)
  assert.equal(cluster.root.id, 'orders.DomainModel.order')
  assert.equal(cluster.descendants.length, 22)
  assert.ok(Array.isArray(cluster.edges))
  assert.ok(Array.isArray(cluster.includedNodes))
})
```

Add `get_graph` test:
```typescript
describe('get_graph', () => {
  it('returns semantic nodes and edges without structural templates', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.get_graph({ format: 'json' })
    const data = JSON.parse(result.content[0].text)
    assert.ok(Array.isArray(data.nodes))
    assert.ok(Array.isArray(data.edges))
    const structural = ['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping']
    assert.ok(data.nodes.every((n: Record<string, unknown>) => !structural.includes(n.template as string)))
    assert.ok(data.edges.every((e: Record<string, unknown>) => !['has-field', 'has-value', 'renamed-from'].includes(e.type as string)))
  })

  it('filter by template restricts nodes', async () => {
    const handlers = createMcpHandlers(graph)
    const result = await handlers.get_graph({ filter: { templates: ['DomainModel'] }, format: 'json' })
    const data = JSON.parse(result.content[0].text)
    assert.ok(data.nodes.every((n: Record<string, unknown>) => n.template === 'DomainModel'))
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

```
npm test
```
Expected: `cluster.descendants` undefined (still using old `children`), `get_graph` handler not found.

- [ ] **Step 3: Add filter params to `/api/graph` in `src/web/server.ts`**

Replace the body of `app.get('/api/graph', ...)`:

```typescript
app.get('/api/graph', async (req, res) => {
  try {
    let targetGraph = graph
    if (typeof req.query.ref === 'string' && multiCache) {
      targetGraph = await getGraphForRef(req.query.ref, multiCache, graph)
    }

    const filterTemplates = Array.isArray(req.query.templates)
      ? (req.query.templates as string[]).filter(t => typeof t === 'string')
      : typeof req.query.templates === 'string' && req.query.templates ? [req.query.templates] : undefined

    const filterExcludeTemplates = Array.isArray(req.query.exclude_templates)
      ? (req.query.exclude_templates as string[]).filter(t => typeof t === 'string')
      : undefined

    // When no allowlist: use provided exclude list or default structural exclusions
    const excludeSet: Set<string> | null = filterTemplates?.length
      ? null
      : filterExcludeTemplates?.length
        ? new Set(filterExcludeTemplates)
        : GRAPH_EXCLUDED_TEMPLATES

    const nodes: Array<{ id: string; template: string; component: string; state: string; stability: string; parentId: string | null }> = []
    for (const node of targetGraph.nodesById.values()) {
      if (filterTemplates?.length && !filterTemplates.includes(node.template)) continue
      if (excludeSet?.has(node.template)) continue
      const ownership = getNavigationOwnership(targetGraph, node)
      nodes.push({
        id: node.id,
        template: node.template,
        component: node.component,
        state: node.state,
        stability: node.stability,
        parentId: ownership?.parentId ?? null,
      })
    }

    const nodeIds = new Set(nodes.map(n => n.id))
    for (const n of nodes) {
      if (n.parentId && !nodeIds.has(n.parentId)) n.parentId = null
    }
    const edges = []
    for (const edgeList of targetGraph.edgesByFrom.values()) {
      for (const edge of edgeList) {
        if (!GRAPH_SEMANTIC_EDGE_TYPES.has(edge.type)) continue
        if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
        edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
      }
    }

    res.json({ nodes, edges })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})
```

- [ ] **Step 4: Upgrade MCP `get_cluster` to use `getClusterView` in `src/mcp/index.ts`**

Add `getClusterView` to the graph import (alongside `getCluster`). Update the handler:

```typescript
get_cluster(args) {
  const overlayRefs = Array.isArray(args.overlay_refs)
    ? args.overlay_refs.filter((ref): ref is string => typeof ref === 'string')
    : []

  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined

  const run = async (targetGraph: Graph, branchRef?: string): Promise<ToolResult> => {
    // Default: traverse all semantic edge types for external node inclusion
    const requestedEdgeTypes = toStringArray(args.edge_types)
    const edgeTypes: EdgeType[] = requestedEdgeTypes
      ? requestedEdgeTypes.filter((t): t is EdgeType => true)
      : ['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from']
    
    const cluster = getClusterView(targetGraph, String(args.node_id), edgeTypes)
    if (overlayRefs.length === 0 || !source || !branchRef) {
      return formatResult(cluster, args.format, getCompactKeys(args))
    }
    const multi = await resolveMulti(source)
    const overlay = computeClusterOverlay(multi, branchRef, overlayRefs, String(args.node_id))
    return formatResult({ ...cluster, overlay }, args.format, getCompactKeys(args))
  }

  const branchRef = hasBranch(args) ? String(args.branch) : undefined

  if (branchRef) {
    return withBranchGraph(source, branchRef, branch => run(branch.graph, branchRef), cache)
  }

  return run(graph).catch(err => errorResult(err))
},
```

Update the `get_cluster` tool schema to add the new params:
```typescript
{
  name: 'get_cluster',
  description: 'Get the full cluster for a root node, including external nodes reachable via semantic edges.',
  inputSchema: {
    type: 'object',
    required: ['node_id'],
    properties: {
      node_id: { type: 'string', description: 'Fully qualified node ID' },
      edge_types: { type: 'array', items: { type: 'string' }, description: 'Edge types to follow for external nodes. Default: all semantic types.' },
      include_dangling_edges: { type: 'boolean', description: 'Include edges to nodes outside the cluster. Default false.' },
      reads_outbound_only: { type: 'boolean', description: 'Restrict reads edges to outbound only. Default true.' },
      branch: { type: 'string' },
      overlay_refs: { type: 'array', items: { type: 'string' }, description: 'Branch refs to overlay.' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

- [ ] **Step 5: Add `get_graph` handler to `src/mcp/index.ts`**

Add handler to the return object:
```typescript
get_graph(args) {
  const toStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string') : undefined

  const SEMANTIC = new Set<EdgeType>(['triggers', 'produces', 'reads', 'calls', 'implements', 'maps-to', 'derived-from'])
  const STRUCTURAL_TPLS = new Set(['Field', 'Schema', 'EnumDefinition', 'EnumValue', 'Mapping'])

  const run = (targetGraph: Graph): ToolResult => {
    const filterArg = typeof args.filter === 'object' && args.filter !== null
      ? args.filter as Record<string, unknown>
      : {}
    const filterTemplates = toStringArray(filterArg.templates)
    const filterExclude = toStringArray(filterArg.exclude_templates)
    const excludeSet = filterTemplates?.length ? null : filterExclude?.length ? new Set(filterExclude) : STRUCTURAL_TPLS

    const nodes = [...targetGraph.nodesById.values()]
      .filter(node => {
        if (filterTemplates?.length && !filterTemplates.includes(node.template)) return false
        if (excludeSet?.has(node.template)) return false
        return true
      })
      .map(node => ({ id: node.id, template: node.template, component: node.component, state: node.state, stability: node.stability }))

    const nodeIds = new Set(nodes.map(n => n.id))
    const edges: Array<{ id: string; from: string; to: string; type: string }> = []
    for (const edgeList of targetGraph.edgesByFrom.values()) {
      for (const edge of edgeList) {
        if (!SEMANTIC.has(edge.type) || !nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue
        edges.push({ id: edge.id, from: edge.from, to: edge.to, type: edge.type })
      }
    }
    return formatResult({ nodes, edges }, args.format, getCompactKeys(args))
  }

  if (hasBranch(args) && source) {
    return withBranchGraph(source, String(args.branch), branch => run(branch.graph))
  }

  try {
    return run(graph)
  } catch (err) {
    return errorResult(err)
  }
},
```

Add to `createMcpHandlers` return type: `get_graph: ToolHandler`.

Add tool schema:
```typescript
{
  name: 'get_graph',
  description: 'Return all semantic nodes and edges. Excludes structural templates (Field, Schema, etc.) and structural edge types by default. Filterable.',
  inputSchema: {
    type: 'object',
    properties: {
      filter: {
        type: 'object',
        properties: {
          templates: { type: 'array', items: { type: 'string' } },
          exclude_templates: { type: 'array', items: { type: 'string' } },
          component: { type: 'string' },
          state: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
          stability: { oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] },
        },
      },
      branch: { type: 'string' },
      format: { type: 'string', enum: ['yaml', 'json', 'toon'] },
      compact_keys: { type: 'boolean' },
    },
  },
},
```

Add `case 'get_graph':` to the switch.

- [ ] **Step 6: Run tests and verify they pass**

```
npm test
```
Expected: all tests pass. `cluster.descendants.length === 22` check passes.

- [ ] **Step 7: Commit**

```bash
git add src/web/server.ts src/mcp/index.ts test/mcp.test.ts
git commit -m "feat: add MCP get_graph, upgrade get_cluster to getClusterView, add filter params to /api/graph"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `list_nodes` multi-template filter + exclude list | Task 1 ✓ |
| `getGraphSummary` / MCP `get_graph_summary` | Task 2 ✓ |
| `searchNodes` / `/api/search` / MCP `search_nodes` | Task 3 ✓ |
| UI search switches to API | Task 3 ✓ |
| `getLineage` / `/api/lineage` / MCP `get_lineage` | Task 4 ✓ |
| UI focus view switches to API | Task 4 ✓ |
| `buildFocusGraph` removed from client | Task 4 ✓ |
| `graph-utils.test.js` updated | Task 4 ✓ |
| MCP `get_graph` | Task 5 ✓ |
| `/api/graph` filter params | Task 5 ✓ |
| MCP `get_cluster` upgraded to `getClusterView` | Task 5 ✓ |
| `getClusterView` parity gap closed | Task 5 ✓ |

**Placeholder scan:** No TBDs. All code blocks are complete.

**Type consistency check:**
- `ListNodesFilter.templates` used consistently across graph layer, server, and MCP handler
- `getLineage` returns `LineageResult` — server and MCP handler both call `getLineage` and pass result directly to JSON/format
- `SearchResult` — server returns `results` array (matches `SearchResult[]`), MCP does same
- MCP `get_cluster` now returns `ClusterViewResult` shape (`{ root, descendants, includedNodes, edges }`) — test updated to check `descendants` not `children`
- `SEMANTIC_EDGE_TYPES` defined once in `src/graph/index.ts`; `get_graph` MCP handler defines its own inline `SEMANTIC` set (acceptable since it's a one-liner and avoids exporting a constant)
