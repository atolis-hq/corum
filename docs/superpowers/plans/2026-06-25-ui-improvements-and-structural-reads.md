# Nav UI Improvements and Structural Reads Edges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix DomainModel schema field expansion, sort the nav tree at every level, and add independent collapse for nav section group headers.

**Architecture:** Three independent user-facing changes: (1) a one-liner `.sort()` in `web/nav.js`; (2) new React state + useEffect in `NavTree` for per-group collapse; (3) a cluster-loader structural reads edge generator with a `generated: true` marker that the graph writer filters out, plus removal of redundant `emitReadsEdge` calls from both adapters.

**Tech Stack:** TypeScript (Node.js), React 18 (CDN/Babel in-browser via `web/*.jsx`), YAML cluster files, Node built-in test runner (`node --test`), Express web server.

## Global Constraints

- All TypeScript must compile with `npm run build` (tsc → dist/) before committing
- `npm test` runs all tests; expects 45 nodes, 38 edges from sample-graph fixtures (existing assertions must continue to pass) — `node --test dist/test/<file>.test.js` runs a single file
- No new npm dependencies
- `web/` files are served as static browser JavaScript — no bundler, no imports; React is a browser global: `const { useState, useEffect } = React`
- Fresh install assumption: no migration handling needed

---

### Task 1: Sort navChildren groups alphabetically

**Files:**
- Modify: `web/nav.js` (line 49)
- Create: `test/nav.test.ts`

**Interfaces:**
- `buildNavTree(nodes, templates)` in `web/nav.js` is exposed as `window.CorumNav.buildNavTree`
- Each node entry may have `navChildren: Array<{ label: string, nodes: Node[] }>` — the task ensures these are sorted by `label`

- [ ] **Step 1: Write the failing test**

Create `test/nav.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadNavModule(): { buildNavTree: Function; buildOverlayIndicatorIds: Function } {
  const navJs = readFileSync(join(__dirname, '../web/nav.js'), 'utf8')
  const context = vm.createContext({ window: {} as Record<string, unknown> })
  vm.runInContext(navJs, context)
  return (context.window as Record<string, unknown>).CorumNav as any
}

describe('buildNavTree', () => {
  it('sorts navChildren groups alphabetically by label', () => {
    const { buildNavTree } = loadNavModule()

    const templates = [
      {
        name: 'DomainModel',
        info: { version: '1' },
        ui: {
          nav: {
            nestOwned: [
              { section: 'schemas', label: 'Schemas' },
              { section: 'operations', label: 'Operations' },
            ],
          },
        },
      },
      { name: 'Schema', info: { version: '1' } },
      { name: 'DomainOperation', info: { version: '1' } },
    ]

    // Schemas node appears before Operations in the array — insertion order produces ['Schemas', 'Operations']
    // The fix should sort to ['Operations', 'Schemas']
    const nodes = [
      { id: 'orders.DomainModel.Order', template: 'DomainModel', component: 'orders', state: 'proposed', stability: 'unstable' },
      { id: 'orders.DomainModel.Order.schemas.Order', template: 'Schema', component: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'schemas' },
      { id: 'orders.DomainModel.Order.operations.Place', template: 'DomainOperation', component: 'orders', state: 'proposed', stability: 'unstable', parentId: 'orders.DomainModel.Order', ownedSection: 'operations' },
    ]

    const tree = buildNavTree(nodes, templates)
    const entries = tree.get('orders')
    const templateEntry = entries.find((e: any) => e.templateName === 'DomainModel')
    const orderNode = templateEntry.nodes.find((n: any) => n.id === 'orders.DomainModel.Order')
    const groupLabels = (orderNode.navChildren ?? []).map((g: any) => g.label)

    assert.deepStrictEqual(groupLabels, ['Operations', 'Schemas'])
  })
})
```

- [ ] **Step 2: Add nav.test.ts to tsconfig include**

Open `tsconfig.json`. The `include` is `["src/**/*", "test/**/*"]` — `test/nav.test.ts` is already covered. No change needed.

- [ ] **Step 3: Run test to verify it fails**

```bash
npm run build && node --test dist/test/nav.test.js
```

Expected: `AssertionError` — groupLabels is `['Schemas', 'Operations']`, not `['Operations', 'Schemas']`.

- [ ] **Step 4: Implement the sort**

In `web/nav.js`, change lines 49-52 from:

```js
    const navChildren = [...(nestedByParent.get(node.id)?.values() ?? [])].map(group => ({
      label: group.label,
      nodes: group.nodes.sort((a, b) => a.id.localeCompare(b.id)),
    }));
```

to:

```js
    const navChildren = [...(nestedByParent.get(node.id)?.values() ?? [])]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(group => ({
        label: group.label,
        nodes: group.nodes.sort((a, b) => a.id.localeCompare(b.id)),
      }));
```

- [ ] **Step 5: Run tests**

```bash
npm run build && npm test
```

Expected: all tests pass including the new nav test.

- [ ] **Step 6: Commit**

```bash
git add web/nav.js test/nav.test.ts
git commit -m "feat: sort nav section groups alphabetically"
```

---

### Task 2: Independent collapse for nav section group headers

**Files:**
- Modify: `web/app.jsx` — `NavTree` component only

**Interfaces:**
- Consumes: `node.navChildren: Array<{ label: string, nodes: Node[] }>` (already sorted by Task 1)
- New state: `openGroupKeys` (`Set<string>`) — keys are `` `${node.id}:${group.label}` ``
- `activeNodeId` prop drives the useEffect that resets open groups on navigation

- [ ] **Step 1: Add openGroupKeys state**

In `web/app.jsx`, in the `NavTree` function, find line 93:

```js
  const [openEntryKeys, setOpenEntryKeys] = useState(new Set());
```

Add immediately after it:

```js
  const [openGroupKeys, setOpenGroupKeys] = useState(new Set());
```

- [ ] **Step 2: Add auto-expand useEffect**

After the existing second `useEffect` block (line 130, which ends `}, [activeNodeId, navTree]);`), add a third `useEffect`:

```js
  // Auto-expand groups for the active node; collapse all others.
  useEffect(() => {
    if (!activeNodeId || !navTree.size) return;
    for (const entries of navTree.values()) {
      for (const entry of entries) {
        if (entry.kind === 'group') continue;
        for (const node of entry.nodes) {
          const isOwner =
            node.id === activeNodeId ||
            (node.navChildren ?? []).some(g => g.nodes.some(c => c.id === activeNodeId));
          if (isOwner) {
            setOpenGroupKeys(new Set((node.navChildren ?? []).map(g => `${node.id}:${g.label}`)));
            return;
          }
        }
      }
    }
    setOpenGroupKeys(new Set());
  }, [activeNodeId, navTree]);
```

- [ ] **Step 3: Replace the navChildren render block**

Find the existing static group render at lines 237-262:

```js
                        {(node.navChildren ?? []).map(group => (
                          <div className="nav-child-group" key={group.label}>
                            <div className="nav-child-head">{group.label}</div>
                            {group.nodes.map(child => {
                              const childTemplate = templateMap.get(child.template);
                              const childColour = childTemplate?.ui?.colour ?? colour;
                              const childIsActive = child.id === activeNodeId;
                              return (
                                <div
                                  key={child.id}
                                  className={`nav-node-item nav-node-child${childIsActive ? ' active' : ''}`}
                                  onClick={() => onNode(child.id)}
                                  title={child.id}
                                  style={childIsActive ? { '--nav-node-active-bg': childColour } : undefined}
                                >
                                  {displayName(child.id)}
                                  {overlayIndicatorIds && overlayIndicatorIds.has(child.id) && (
                                    <span className="signal-dots">
                                      <span className="signal-dot signal-dot-0" />
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ))}
```

Replace it with:

```js
                        {(node.navChildren ?? []).map(group => {
                          const groupKey = `${node.id}:${group.label}`;
                          const groupOpen = openGroupKeys.has(groupKey);
                          return (
                            <div className="nav-child-group" key={group.label}>
                              <div
                                className="nav-child-head"
                                style={{ cursor: 'pointer' }}
                                onClick={() => setOpenGroupKeys(prev => {
                                  const next = new Set(prev);
                                  next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
                                  return next;
                                })}
                              >
                                <Icon name={groupOpen ? 'chevron-down' : 'chevron-right'} size={10} />
                                {group.label}
                              </div>
                              {groupOpen && group.nodes.map(child => {
                                const childTemplate = templateMap.get(child.template);
                                const childColour = childTemplate?.ui?.colour ?? colour;
                                const childIsActive = child.id === activeNodeId;
                                return (
                                  <div
                                    key={child.id}
                                    className={`nav-node-item nav-node-child${childIsActive ? ' active' : ''}`}
                                    onClick={() => onNode(child.id)}
                                    title={child.id}
                                    style={childIsActive ? { '--nav-node-active-bg': childColour } : undefined}
                                  >
                                    {displayName(child.id)}
                                    {overlayIndicatorIds && overlayIndicatorIds.has(child.id) && (
                                      <span className="signal-dots">
                                        <span className="signal-dot signal-dot-0" />
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })}
```

- [ ] **Step 4: Build and manual browser test**

```bash
npm run build && npm run web
```

Open the browser. Verify:
- Navigate to a DomainModel node → its Operations/Schemas groups auto-expand
- Click a group header → that group collapses; chevron changes to right-pointing
- Click the same header again → group expands; chevron changes to down-pointing
- Navigate to a different node → previous node's groups collapse, new node's groups auto-expand

- [ ] **Step 5: Commit**

```bash
git add web/app.jsx
git commit -m "feat: independent collapse for nav section group headers"
```

---

### Task 3: Add `generated` flag to Edge type

**Files:**
- Modify: `src/schema/index.ts`

**Interfaces:**
- Produces: `Edge.generated?: true` — internal only, never written to YAML; used by Tasks 4 and 5

- [ ] **Step 1: Add the field**

In `src/schema/index.ts`, find the `Edge` interface (lines 23-33):

```typescript
export interface Edge {
  id: string
  from: string
  to: string
  type: EdgeType
  state: State
  stability: Stability
  notes?: string
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
}
```

Add `generated?: true` after `derivedBy`:

```typescript
export interface Edge {
  id: string
  from: string
  to: string
  type: EdgeType
  state: State
  stability: Stability
  notes?: string
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
  generated?: true
}
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: clean compile, no test changes needed.

- [ ] **Step 3: Commit**

```bash
git add src/schema/index.ts
git commit -m "feat: add generated flag to Edge type for auto-inferred structural edges"
```

---

### Task 4: Auto-generate structural reads edges in cluster-loader

**Files:**
- Modify: `src/loader/cluster-loader.ts`
- Modify: `test/loader.test.ts`

**Interfaces:**
- Consumes: `Edge.generated?: true` from Task 3
- Produces: for every owned child node whose template has a `format: node-ref` property with a non-local string value, a `reads` edge is emitted: `{ from: clusterRoot.id, to: globalNodeId, type: 'reads', generated: true, state: clusterRoot.state, stability: clusterRoot.stability }`; de-duplicated by edge ID

- [ ] **Step 1: Write the failing test**

In `test/loader.test.ts`, add a new `describe` block at the bottom of the file:

```typescript
describe('cluster loader — structural reads edges', () => {
  it('auto-generates a reads edge from a field with a global node-ref $ref', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, 'pack load errors')

    // Two clusters: orders DomainModel with a field referencing payments DomainModel
    const content: ContentMap = new Map([
      ['components/orders/DomainModels/cross-ref-test.yaml', [
        'id: orders.DomainModel.cross-ref-test',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
        'schemas:',
        '  item:',
        '    fields:',
        '      price:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
      ].join('\n')],
      ['components/payments/DomainModels/payment.yaml', [
        'id: payments.DomainModel.payment',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: payments',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)
    assert.equal(
      diagnostics.filter(d => d.severity === 'error').length,
      0,
      `load errors: ${JSON.stringify(diagnostics.filter(d => d.severity === 'error'))}`,
    )

    const allEdges = [...result.edgesByFrom.values()].flat()
    const structuralReads = allEdges.filter(e => e.type === 'reads' && e.generated === true)

    assert.ok(structuralReads.length > 0, 'expected at least one structural reads edge')

    const edge = structuralReads.find(
      e => e.from === 'orders.DomainModel.cross-ref-test' && e.to === 'payments.DomainModel.payment',
    )
    assert.ok(edge, 'expected reads edge from orders.DomainModel.cross-ref-test to payments.DomainModel.payment')
    assert.strictEqual(edge!.generated, true)
    assert.strictEqual(edge!.from, 'orders.DomainModel.cross-ref-test')
  })

  it('deduplicates structural reads edges when multiple fields reference the same external node', async () => {
    const diagnostics: Diagnostic[] = []
    const templates = loadPacks(await buildPackContentMap(), diagnostics)

    const content: ContentMap = new Map([
      ['components/orders/DomainModels/multi-ref-test.yaml', [
        'id: orders.DomainModel.multi-ref-test',
        'template: DomainModel',
        'schemaVersion: "1"',
        'metadata:',
        '  component: orders',
        '  state: proposed',
        '  stability: unstable',
        '  lastModifiedAt: "2026-06-25"',
        'schemas:',
        '  first:',
        '    fields:',
        '      price:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
        '  second:',
        '    fields:',
        '      amount:',
        '        $ref: payments.DomainModel.payment',
        '        nullable: false',
      ].join('\n')],
    ])

    const result = loadClusters(content, templates, diagnostics)

    const allEdges = [...result.edgesByFrom.values()].flat()
    const readsToPayment = allEdges.filter(
      e => e.type === 'reads' && e.to === 'payments.DomainModel.payment' && e.generated === true,
    )
    assert.equal(readsToPayment.length, 1, 'duplicate reads edges must be de-duplicated')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A5 "structural reads"
```

Expected: FAIL — `structuralReads.length > 0` assertion fails (0 reads edges generated).

- [ ] **Step 3: Add helpers to cluster-loader**

In `src/loader/cluster-loader.ts`, add two helper functions immediately before `function materialiseChildren`:

```typescript
function getPropertySchemasFromTemplate(props: Record<string, unknown>): Record<string, Record<string, unknown>> {
  if (Array.isArray(props.allOf)) {
    const merged: Record<string, Record<string, unknown>> = {}
    for (const schema of props.allOf) {
      Object.assign(merged, getPropertySchemasFromTemplate(schema as Record<string, unknown>))
    }
    return merged
  }
  if (typeof props.properties === 'object' && props.properties !== null) {
    return props.properties as Record<string, Record<string, unknown>>
  }
  return {}
}

function getNodeRefTargets(node: Node, template: Template): string[] {
  if (!template.properties) return []
  const propSchemas = getPropertySchemasFromTemplate(template.properties as Record<string, unknown>)
  const targets: string[] = []
  for (const [key, schema] of Object.entries(propSchemas)) {
    if ((schema as Record<string, unknown>).format !== 'node-ref') continue
    const value = node.properties[key]
    if (typeof value === 'string' && !value.startsWith('#/')) targets.push(value)
  }
  return targets
}
```

- [ ] **Step 4: Add clusterRoot parameter to materialiseChildren**

Change the `materialiseChildren` function signature (line 73) from:

```typescript
function materialiseChildren(
  result: ClusterResult,
  parent: Node,
  source: Record<string, unknown>,
  templates: Map<string, Template>,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
```

to:

```typescript
function materialiseChildren(
  result: ClusterResult,
  parent: Node,
  clusterRoot: Node,
  source: Record<string, unknown>,
  templates: Map<string, Template>,
  filePath: string,
  diagnostics: Diagnostic[],
): void {
```

- [ ] **Step 5: Update the initial call in loadClusters**

At line 67, change:

```typescript
    materialiseChildren(result, root, record, templates, key, diagnostics)
```

to:

```typescript
    materialiseChildren(result, root, root, record, templates, key, diagnostics)
```

- [ ] **Step 6: Emit structural reads edges inside materialiseChildren**

Inside `materialiseChildren`, after the `if (edgeType) { addEdge(...) }` block (after line 125) and before the recursive call to `materialiseChildren`, add:

```typescript
      const childTemplate = templates.get(child.template)
      if (childTemplate) {
        for (const target of getNodeRefTargets(child, childTemplate)) {
          const readsId = `${clusterRoot.id}__reads__${target}`
          const existingFrom = result.edgesByFrom.get(clusterRoot.id) ?? []
          if (!existingFrom.some(e => e.id === readsId)) {
            addEdge(result, {
              id: readsId,
              from: clusterRoot.id,
              to: target,
              type: 'reads',
              state: clusterRoot.state,
              stability: clusterRoot.stability,
              generated: true,
            })
          }
        }
      }
```

- [ ] **Step 7: Update the recursive call**

At line 126 (the recursive `materialiseChildren` call), change:

```typescript
      materialiseChildren(result, child, value, templates, filePath, diagnostics)
```

to:

```typescript
      materialiseChildren(result, child, clusterRoot, value, templates, filePath, diagnostics)
```

- [ ] **Step 8: Build and run all tests**

```bash
npm run build && npm test
```

Expected: all existing tests pass (151 nodes, has-field/has-value edge counts unchanged). New structural reads tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/loader/cluster-loader.ts test/loader.test.ts
git commit -m "feat: auto-generate structural reads edges from node-ref properties in cluster-loader"
```

---

### Task 5: Filter generated edges from graph-writer output

**Files:**
- Modify: `src/writer/graph-writer.ts` (line 33)
- Modify: `test/writer.test.ts`

**Interfaces:**
- Consumes: `Edge.generated?: true` from Task 3
- `serializeGraph` must exclude edges with `generated === true` from edge file output (same as existing `STRUCTURAL_EDGE_TYPES` filter)

- [ ] **Step 1: Write the failing test**

In `test/writer.test.ts`, add at the top after existing imports:

```typescript
import type { Edge } from '../src/schema/index.js'
```

Then add a new test inside the existing `describe('serializeGraph', ...)` block:

```typescript
  it('excludes generated reads edges from edge file output', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })

    const syntheticEdge: Edge = {
      id: 'orders.DomainModel.order__reads__payments.DomainModel.payment',
      from: 'orders.DomainModel.order',
      to: 'payments.DomainModel.payment',
      type: 'reads',
      state: 'proposed',
      stability: 'unstable',
      generated: true,
    }
    const fromEdges = graph.edgesByFrom.get('orders.DomainModel.order') ?? []
    graph.edgesByFrom.set('orders.DomainModel.order', [...fromEdges, syntheticEdge])

    const map = serializeGraph(graph)
    for (const [key, content] of map) {
      if (!key.startsWith('edges/')) continue
      assert.ok(
        !content.includes('orders.DomainModel.order__reads__payments.DomainModel.payment'),
        `generated edge must not appear in edge file ${key}`,
      )
    }
  })
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test dist/test/writer.test.js 2>&1 | grep -A5 "generated reads"
```

Expected: FAIL — the generated edge ID appears in the edge file content.

- [ ] **Step 3: Extend the filter in serializeGraph**

In `src/writer/graph-writer.ts`, change line 33 from:

```typescript
  const explicitEdges = getAllEdges(graph)
    .filter(edge => !STRUCTURAL_EDGE_TYPES.has(edge.type))
```

to:

```typescript
  const explicitEdges = getAllEdges(graph)
    .filter(edge => !STRUCTURAL_EDGE_TYPES.has(edge.type) && edge.generated !== true)
```

- [ ] **Step 4: Build and run all tests**

```bash
npm run build && npm test
```

Expected: all existing tests pass, new writer test passes.

- [ ] **Step 5: Commit**

```bash
git add src/writer/graph-writer.ts test/writer.test.ts
git commit -m "feat: filter generated edges from graph-writer edge file output"
```

---

### Task 6: Remove emitReadsEdge from adapters

**Files:**
- Modify: `src/adapters/openapi/mapper.ts`
- Modify: `src/adapters/asyncapi/mapper.ts`

**Interfaces:**
- Removes `emitReadsEdge` function and all call sites from both files
- Cleans up the now-unused `readsSource` local variable and parameter in each file

#### openapi/mapper.ts changes

- [ ] **Step 1: Delete the emitReadsEdge function**

In `src/adapters/openapi/mapper.ts`, delete lines 64-69:

```typescript
function emitReadsEdge(from: string, to: string, edges: Edge[]): void {
  const id = `${from}__reads__${to}`
  if (!edges.some(e => e.id === id)) {
    edges.push({ id, from, to, type: 'reads', state: 'implemented', stability: 'unstable' })
  }
}
```

- [ ] **Step 2: Remove the call in emitSchemaNode**

Find the block around line 346 in `emitSchemaNode`:

```typescript
    const globalId = sharedSchemas.get(schemaName)
    if (globalId) {
      if (rootId) emitReadsEdge(rootId, globalId, edges)
      return globalId
    }
```

Change to:

```typescript
    const globalId = sharedSchemas.get(schemaName)
    if (globalId) {
      return globalId
    }
```

- [ ] **Step 3: Remove readsSource parameter from resolveFieldRef**

Find the `resolveFieldRef` function declaration. Its current signature has `readsSource: string` as the 5th parameter (after `rootId: string | undefined`). Remove it:

```typescript
// BEFORE (the 5th param):
function resolveFieldRef(
  schemaName: string,
  collection: 'one' | 'array',
  required: boolean,
  rootId: string | undefined,
  readsSource: string,
  refSchema: OpenAPIV3.ReferenceObject,
  ...

// AFTER:
function resolveFieldRef(
  schemaName: string,
  collection: 'one' | 'array',
  required: boolean,
  rootId: string | undefined,
  refSchema: OpenAPIV3.ReferenceObject,
  ...
```

- [ ] **Step 4: Remove the emitReadsEdge call inside resolveFieldRef**

Find the block around line 414:

```typescript
  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    emitReadsEdge(readsSource, globalId, edges)
    return { $ref: globalId, ...extra }
  }
```

Change to:

```typescript
  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    return { $ref: globalId, ...extra }
  }
```

- [ ] **Step 5: Remove readsSource from emitFields**

In the `emitFields` function, find and delete line ~533:

```typescript
  const readsSource = rootId ?? parentId
```

Then at the two `resolveFieldRef` call sites (~line 543 and ~line 561), remove the `readsSource` argument. Before the change, the call for scalar field refs looks like:

```typescript
      fieldNode.properties = resolveFieldRef(
        refName(fieldSchema.$ref), 'one', required, rootId, readsSource,
        fieldSchema as OpenAPIV3.ReferenceObject,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
      )
```

After:

```typescript
      fieldNode.properties = resolveFieldRef(
        refName(fieldSchema.$ref), 'one', required, rootId,
        fieldSchema as OpenAPIV3.ReferenceObject,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
      )
```

Do the same for the array item call (~line 561):

```typescript
      // BEFORE:
          fieldNode.properties = resolveFieldRef(
            refName(items.$ref), 'array', required, rootId, readsSource,
            items as OpenAPIV3.ReferenceObject,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
          )

      // AFTER:
          fieldNode.properties = resolveFieldRef(
            refName(items.$ref), 'array', required, rootId,
            items as OpenAPIV3.ReferenceObject,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
          )
```

#### asyncapi/mapper.ts changes

- [ ] **Step 6: Delete the emitReadsEdge function**

In `src/adapters/asyncapi/mapper.ts`, delete lines 433-438:

```typescript
function emitReadsEdge(from: string, to: string, edges: Edge[]): void {
  const id = `${from}__reads__${to}`
  if (!edges.some(e => e.id === id)) {
    edges.push({ id, from, to, type: 'reads', state: 'implemented', stability: 'unstable' })
  }
}
```

- [ ] **Step 7: Remove readsSource parameter from resolveSchemaRef**

Find the `resolveSchemaRef` function declaration. It currently has `readsSource: string` as the 4th parameter (after `collection: 'array' | undefined`). Remove it:

```typescript
// BEFORE:
function resolveSchemaRef(
  schemaName: string,
  nullable: boolean,
  collection: 'array' | undefined,
  readsSource: string,
  rootId: string | undefined,
  component: string,
  ...

// AFTER:
function resolveSchemaRef(
  schemaName: string,
  nullable: boolean,
  collection: 'array' | undefined,
  rootId: string | undefined,
  component: string,
  ...
```

- [ ] **Step 8: Remove the emitReadsEdge call inside resolveSchemaRef**

Find the block around line 475:

```typescript
  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    emitReadsEdge(readsSource, globalId, edges)
    return { $ref: globalId, ...extra }
  }
```

Change to:

```typescript
  const globalId = sharedSchemas.get(schemaName)
  if (globalId) {
    return { $ref: globalId, ...extra }
  }
```

- [ ] **Step 9: Remove readsSource from emitSchemaFields**

In the `emitSchemaFields` function, find and delete line ~575:

```typescript
  const readsSource = rootId ?? parentId
```

Then at the two `resolveSchemaRef` call sites (~line 592 and ~line 611), remove the `readsSource` argument (the 4th positional argument).

Before (~line 592):

```typescript
      fieldNode.properties = resolveSchemaRef(
        schemaName, !required, undefined, readsSource, rootId, component,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
      )
```

After:

```typescript
      fieldNode.properties = resolveSchemaRef(
        schemaName, !required, undefined, rootId, component,
        packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
      )
```

Before (~line 611):

```typescript
          fieldNode.properties = resolveSchemaRef(
            refName((items as { $ref: string }).$ref), nullable, 'array', readsSource, rootId, component,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
          )
```

After:

```typescript
          fieldNode.properties = resolveSchemaRef(
            refName((items as { $ref: string }).$ref), nullable, 'array', rootId, component,
            packConfig, specPath, nodes, edges, diagnostics, sharedSchemas, sourceSchemas, localSchemas, localMappings,
          )
```

- [ ] **Step 10: Build**

```bash
npm run build
```

Expected: clean compile. TypeScript will catch any missed `readsSource` references.

- [ ] **Step 11: Run all tests**

```bash
npm test
```

Expected: all existing tests pass (adapter tests don't run imports, so removing emitReadsEdge does not affect fixture counts).

- [ ] **Step 12: Commit**

```bash
git add src/adapters/openapi/mapper.ts src/adapters/asyncapi/mapper.ts
git commit -m "feat: remove emitReadsEdge from adapters — structural reads now auto-generated by cluster-loader"
```

---

### Task 7: Amend ADR-004b

**Files:**
- Modify: `docs/adr/ADR-004b-edge-type-vocabulary-and-constraints.md`

- [ ] **Step 1: Add the amendment**

Open `docs/adr/ADR-004b-edge-type-vocabulary-and-constraints.md` and append the following section at the bottom of the file:

```markdown
---

## Amendment: 2026-06-25 — Structural reads edges

**Context:** ADR-003d established that `objectRef` values resolving to global node IDs "generate a reads edge". This amendment formalises auto-generation of reads edges from node-ref properties and extends the cluster-loader to implement it.

**Three categories of edges:**

| Category | Types | Generated by | In edge files? |
|---|---|---|---|
| Structural ownership | `has-field`, `has-value` | cluster-loader (ownership hierarchy) | Never |
| **Structural reads** | `reads` | cluster-loader (node-ref properties) | Never |
| Semantic | all types + explicitly declared `reads` | Human-authored | Always |

**Structural reads rule:** When the cluster loader materialises an owned child node whose template has a property with `format: node-ref`, and that property's value is a global node ID (not a local `#/...` ref), the loader emits a `reads` edge: `from = cluster root ID`, `to = global node ID`, marked `generated: true`. The `from` is always the cluster root, keeping reads root-to-root per the original ADR. Multiple child nodes referencing the same external cluster produce exactly one reads edge (de-duplicated by edge ID).

**`reads` has dual status:** auto-generated when derivable from node-ref properties (structural reads, never in edge files); human-authored in edge files for explicit architectural intent (semantic reads, always in edge files). Semantic `reads` edges coexist harmlessly with structural reads for the same target — `getClusterView` uses a Set for `includedNodeIds`.

**`generated: true` marker:** Added to `Edge` interface in `src/schema/index.ts`. Internal only — never written to YAML. `serializeGraph` in `src/writer/graph-writer.ts` extends its filter: `edge.generated !== true` alongside the existing `STRUCTURAL_EDGE_TYPES` filter.

**Adapter impact:** `emitReadsEdge` removed from `src/adapters/openapi/mapper.ts` and `src/adapters/asyncapi/mapper.ts`. Reads edges for shared schema references in imported specs are now generated by the cluster-loader when loading the written cluster YAML files.

**Why this matters:** Hand-crafted cluster files (DomainModels, ValueObjects) declare field types via `$ref` pointing to external cluster roots. Without structural reads edges, `getClusterView` excludes the external clusters from `includedNodes`, `buildSchemaModel` cannot find referenced schemas, and schema field expansion silently fails for those field types. This amendment fixes the root cause without requiring explicit reads edges in edge files.
```

- [ ] **Step 2: Commit**

```bash
git add "docs/adr/ADR-004b-edge-type-vocabulary-and-constraints.md"
git commit -m "docs: amend ADR-004b with structural reads edge category"
```

---

## Self-Review

**Spec coverage:**
- ✅ Item 1 (nav sort): Task 1 — sorts navChildren groups alphabetically in `buildNavTree`
- ✅ Item 2 (group collapse): Task 2 — `openGroupKeys` state, useEffect auto-expand, header toggle
- ✅ Item 3 structural reads: Tasks 3–6 — Edge type, cluster-loader generation, graph-writer filter, adapter cleanup
- ✅ ADR amendment: Task 7
- ✅ TDD for all testable changes: Tasks 1, 4, 5 have failing-first test steps
- ✅ Migration: explicitly excluded (fresh install assumption per spec)

**Placeholder scan:** None found.

**Type consistency:**
- `Edge.generated?: true` defined in Task 3, used in Task 4 (`generated: true`), filtered in Task 5 (`edge.generated !== true`) — exact property name consistent
- `getNodeRefTargets(node: Node, template: Template): string[]` defined and used only in Task 4 — no cross-task reference
- `clusterRoot: Node` added to `materialiseChildren` in Task 4 — both the initial call (`root, root`) and recursive call (`child, clusterRoot`) updated
- `readsSource` removed from both adapters in Task 6 — both the declaration and all argument sites covered
