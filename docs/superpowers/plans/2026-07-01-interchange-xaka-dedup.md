# Interchange x-aka + Cross-Adapter Deduplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `x-aka` to the corum interchange format and implement a post-import deduplication pass that merges nodes from different adapters, rewriting edges from dropped nodes to their kept counterparts.

**Architecture:** `x-aka` values flow from the interchange YAML through the corum parser and mapper into `node.properties['x-aka']`. After all adapters run, a new standalone `dedup.ts` module resolves x-aka matches and same-ID collisions according to config-declared rules, rewrites affected edge endpoints (including child-node prefix substitution), drops secondary nodes and their children, then strips the transient `x-aka` property. The runner is restructured to collect-then-dedup-then-apply instead of applying inline.

**Tech Stack:** TypeScript, Node.js test runner (`node --test`), `yaml` YAML parser.

## Global Constraints

- Build: `npm run build` (tsc → dist/) must pass with zero errors before every commit.
- Tests: `npm test` (build + Node test runner) must pass before every commit.
- No external dependencies — use only what is already in `package.json`.
- No comments in code. No semicolons where the codebase omits them.
- `Diagnostic.file` is a required `string`; use `''` where no source file applies (dedup warnings).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `.corum/packs/extract/interchange.schema.yaml` | Modify | Add `x-aka` field to node entry definition |
| `src/adapters/corum/parser.ts` | Modify | Add `'x-aka'?: string[]` to `CorumInterchangeNodeEntry` |
| `src/adapters/corum/mapper.ts` | Modify | Write `x-aka` values into `node.properties['x-aka']` |
| `src/import/config.ts` | Modify | Add `DeduplicationRule` + `deduplication?` to `ImportConfig`; validate in loader |
| `src/import/dedup.ts` | Create | Pure deduplication logic — x-aka matching, same-ID collision, edge rewriting, node dropping |
| `src/import/runner.ts` | Modify | Collect all adapter results, run dedup, then apply to graph |
| `test/adapters/corum/parser.test.ts` | Modify | Add test: x-aka values parsed from YAML |
| `test/adapters/corum/mapper.test.ts` | Modify | Add tests: x-aka passes through to properties; absent x-aka leaves no property |
| `test/import/dedup.test.ts` | Create | Unit tests for all dedup behaviours |

---

## Task 1: Add x-aka to interchange schema and parser type

**Files:**
- Modify: `.corum/packs/extract/interchange.schema.yaml`
- Modify: `src/adapters/corum/parser.ts`
- Test: `test/adapters/corum/parser.test.ts`

**Produces:** `CorumInterchangeNodeEntry['x-aka']?: string[]` available to Task 2.

- [ ] **Step 1: Add x-aka to the interchange schema**

In `.corum/packs/extract/interchange.schema.yaml`, under `nodes.additionalProperties.properties`, add after the `provenance` entry:

```yaml
        x-aka:
          type: array
          description: |
            Alternative names for this node. Used by the import reconciler to match
            nodes produced by different adapters — e.g. a C# controller class name
            matched to an OpenAPI operationId, or an IntegrationEvent class name to
            an AsyncAPI channel message name.
          items:
            type: string
```

- [ ] **Step 2: Add x-aka to the parser interface**

In `src/adapters/corum/parser.ts`, update `CorumInterchangeNodeEntry`:

```typescript
export interface CorumInterchangeNodeEntry {
  type: string
  title?: string
  schema?: { $ref: string }
  'x-aka'?: string[]
  provenance?: CorumInterchangeProvenance
}
```

- [ ] **Step 3: Add parser test for x-aka**

In `test/adapters/corum/parser.test.ts`, add inside the `describe('parseSpec', ...)` block:

```typescript
  it('parses x-aka when present on a node', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  billing.APIEndpoint.GetInvoiceController:
    type: APIEndpoint
    x-aka:
      - GetInvoice
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    const node = document.nodes['billing.APIEndpoint.GetInvoiceController']
    assert.deepEqual(node['x-aka'], ['GetInvoice'])
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })
```

- [ ] **Step 4: Build and run parser tests**

```
npm run build && node --test dist/test/adapters/corum/parser.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add .corum/packs/extract/interchange.schema.yaml src/adapters/corum/parser.ts test/adapters/corum/parser.test.ts
git commit -m "feat: add x-aka field to interchange schema and parser type"
```

---

## Task 2: Mapper x-aka passthrough

**Files:**
- Modify: `src/adapters/corum/mapper.ts`
- Test: `test/adapters/corum/mapper.test.ts`

**Consumes:** `CorumInterchangeNodeEntry['x-aka']` from Task 1.
**Produces:** `node.properties['x-aka']` on emitted nodes — consumed by Task 4 (dedup) and Task 5 (runner strips it).

- [ ] **Step 1: Write failing mapper tests**

In `test/adapters/corum/mapper.test.ts`, add inside `describe('mapDocument — nodes (basic)', ...)`:

```typescript
  it('passes x-aka through to node properties', () => {
    const doc = makeDoc({
      nodes: {
        'billing.APIEndpoint.GetInvoiceController': {
          type: 'APIEndpoint',
          'x-aka': ['GetInvoice'],
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.deepEqual(nodes[0].properties['x-aka'], ['GetInvoice'])
  })

  it('does not set x-aka property when absent', () => {
    const doc = makeDoc({
      nodes: {
        'billing.APIEndpoint.GetInvoiceController': {
          type: 'APIEndpoint',
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.ok(!('x-aka' in nodes[0].properties))
  })
```

- [ ] **Step 2: Run to confirm they fail**

```
npm run build && node --test dist/test/adapters/corum/mapper.test.js
```

Expected: the two new tests fail ("Expected values to be strictly deep-equal" / property not found).

- [ ] **Step 3: Add x-aka passthrough to mapper**

In `src/adapters/corum/mapper.ts`, in the `mapDocument` function inside the `for (const [nodeId, entry] of Object.entries(document.nodes))` loop, add after the `entry.title` block and before the `makeNode` call:

```typescript
    if (entry['x-aka']?.length) {
      properties['x-aka'] = entry['x-aka']
    }
```

The relevant section should look like:

```typescript
    if (entry.title && !schemaName) {
      properties.description = entry.title
    }

    if (entry['x-aka']?.length) {
      properties['x-aka'] = entry['x-aka']
    }

    const node = makeNode(entry.type, component, specPath, nodeId, entry.provenance, properties)
```

- [ ] **Step 4: Build and run mapper tests**

```
npm run build && node --test dist/test/adapters/corum/mapper.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/adapters/corum/mapper.ts test/adapters/corum/mapper.test.ts
git commit -m "feat: pass x-aka through corum mapper into node properties"
```

---

## Task 3: Config types and validation

**Files:**
- Modify: `src/import/config.ts`

**Produces:** `DeduplicationRule` and `ImportConfig.deduplication` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Add DeduplicationRule and update ImportConfig**

In `src/import/config.ts`, add before `ImportConfig`:

```typescript
export interface DeduplicationRule {
  primary: string
  secondary: string
}
```

Update `ImportConfig`:

```typescript
export interface ImportConfig {
  componentNameReplacements?: ComponentNameReplacement[]
  deduplication?: DeduplicationRule[]
  imports: ImportEntry[]
}
```

- [ ] **Step 2: Validate deduplication rules in loadImportConfig**

In `loadImportConfig`, after the `componentNameReplacements` validation loop, add:

```typescript
  for (const rule of cfg.deduplication ?? []) {
    if (!rule.primary || !rule.secondary) {
      throw new Error(`Invalid import config: deduplication entries must have non-empty "primary" and "secondary"`)
    }
  }
```

- [ ] **Step 3: Build**

```
npm run build
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/import/config.ts
git commit -m "feat: add DeduplicationRule type and deduplication config validation"
```

---

## Task 4: Deduplication module

**Files:**
- Create: `src/import/dedup.ts`
- Create: `test/import/dedup.test.ts`

**Consumes:** `DeduplicationRule` from Task 3; `node.properties['x-aka']` from Task 2; `Node`, `Edge`, `Diagnostic` from `src/schema/index.ts`.
**Produces:** `deduplicateResults(results, rules): DedupResult` — consumed by Task 5.

- [ ] **Step 1: Write the test file**

Create `test/import/dedup.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deduplicateResults } from '../../../src/import/dedup.js'
import type { EntryResult } from '../../../src/import/dedup.js'
import type { Node, Edge } from '../../../src/schema/index.js'

function makeNode(id: string, adapterId: string, extra: Record<string, unknown> = {}): Node {
  const parts = id.split('.')
  return {
    id,
    template: parts[1] ?? 'Unknown',
    component: parts[0],
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-01-01',
    extractedFrom: '/fake/spec.yaml',
    derivation: 'determined',
    derivedBy: `adapter:${adapterId}`,
    properties: { ...extra },
  }
}

function makeEdge(from: string, to: string, type: Edge['type'] = 'triggers'): Edge {
  return {
    id: `${from}__${type}__${to}`,
    from,
    to,
    type,
    state: 'implemented',
    stability: 'unstable',
    derivation: 'determined',
    derivedBy: 'adapter:test',
  }
}

function makeResult(adapterId: string, nodes: Node[], edges: Edge[] = []): EntryResult {
  return { adapterId, specPath: `/fake/${adapterId}.yaml`, nodes, edges }
}

describe('deduplicateResults — x-aka matching', () => {
  it('redirects edges from secondary root to primary and drops secondary node', () => {
    const secondary = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge('billing.APIEndpoint.GetInvoiceController', 'billing.Command.GetInvoiceQuery')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])

    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'secondary node dropped')

    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges.length, 1)
    assert.equal(allEdges[0].from, 'billing.APIEndpoint.GetInvoice')
    assert.equal(allEdges[0].to, 'billing.Command.GetInvoiceQuery')
    assert.equal(allEdges[0].id, 'billing.APIEndpoint.GetInvoice__triggers__billing.Command.GetInvoiceQuery')

    assert.equal(diagnostics.length, 0, 'no warning for x-aka match')
  })

  it('rewrites edges where secondary is the target', () => {
    const secondary = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge('billing.APIGateway.Router', 'billing.APIEndpoint.GetInvoiceController', 'calls')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges[0].to, 'billing.APIEndpoint.GetInvoice')
  })

  it('no match when x-aka does not correspond to any primary node', () => {
    const secondary = makeNode('billing.APIEndpoint.UnknownController', 'corum', { 'x-aka': ['NoMatch'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 1, 'unmatched secondary node kept')
  })
})

describe('deduplicateResults — same-ID collision', () => {
  it('keeps primary, drops secondary, emits warning when IDs match', () => {
    const secondary = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const primary = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('asyncapi', [primary]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [{ primary: 'asyncapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'secondary dropped')

    assert.equal(diagnostics.length, 1)
    assert.ok(diagnostics[0].message.includes('customers.IntegrationEvent.CustomerCreated'))
    assert.ok(diagnostics[0].message.includes('asyncapi'))
    assert.ok(diagnostics[0].message.includes('corum'))
    assert.equal(diagnostics[0].severity, 'warning')
  })

  it('does not rewrite edges when IDs are identical (same-ID collision)', () => {
    const secondary = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const primary = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')
    const edge = makeEdge('customers.DomainModel.CustomerAggregate', 'customers.IntegrationEvent.CustomerCreated', 'produces')

    const results = [
      makeResult('corum', [secondary], [edge]),
      makeResult('asyncapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'asyncapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges[0].to, 'customers.IntegrationEvent.CustomerCreated', 'edge target unchanged')
    assert.equal(allEdges[0].id, 'customers.DomainModel.CustomerAggregate__produces__customers.IntegrationEvent.CustomerCreated')
  })
})

describe('deduplicateResults — child node dropping', () => {
  it('drops schema and field children of a redirected secondary root', () => {
    const root = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const schema = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.GetInvoiceResponse', 'corum')
    const field = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.GetInvoiceResponse.fields.InvoiceId', 'corum')
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [root, schema, field]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'root and all children dropped')
  })

  it('rewrites edges referencing dropped child nodes via prefix substitution', () => {
    const root = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const field = makeNode('billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id', 'corum')
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const edge = makeEdge(
      'billing.APIEndpoint.GetInvoiceController.schemas.Response.fields.Id',
      'shared.Schema.Invoice.fields.Id',
      'maps-to',
    )

    const results = [
      makeResult('corum', [root, field], [edge]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const allEdges = out.flatMap(r => r.edges)
    assert.equal(allEdges.length, 1)
    assert.equal(allEdges[0].from, 'billing.APIEndpoint.GetInvoice.schemas.Response.fields.Id')
    assert.equal(allEdges[0].to, 'shared.Schema.Invoice.fields.Id', 'non-secondary endpoint unchanged')
  })
})

describe('deduplicateResults — x-aka cleanup', () => {
  it('strips x-aka from secondary nodes that were not matched (kept)', () => {
    const secondary = makeNode('billing.APIEndpoint.UnknownController', 'corum', { 'x-aka': ['NoMatch'] })
    const primary = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')

    const results = [
      makeResult('corum', [secondary]),
      makeResult('openapi', [primary]),
    ]

    const { results: out } = deduplicateResults(results, [{ primary: 'openapi', secondary: 'corum' }])
    const kept = out.find(r => r.adapterId === 'corum')!.nodes[0]
    assert.ok(!('x-aka' in kept.properties), 'x-aka stripped from kept node')
  })

  it('strips x-aka even when no rules are matched', () => {
    const node = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })

    const results = [makeResult('corum', [node])]
    const { results: out } = deduplicateResults(results, [])
    assert.ok(!('x-aka' in out[0].nodes[0].properties))
  })
})

describe('deduplicateResults — no-op cases', () => {
  it('returns results unchanged when no rules provided', () => {
    const node = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const results = [makeResult('openapi', [node])]
    const { results: out, diagnostics } = deduplicateResults(results, [])
    assert.equal(out[0].nodes.length, 1)
    assert.equal(diagnostics.length, 0)
  })

  it('applies multiple rules independently', () => {
    const corumApi = makeNode('billing.APIEndpoint.GetInvoiceController', 'corum', { 'x-aka': ['GetInvoice'] })
    const corumEvent = makeNode('customers.IntegrationEvent.CustomerCreated', 'corum')
    const openApi = makeNode('billing.APIEndpoint.GetInvoice', 'openapi')
    const asyncApi = makeNode('customers.IntegrationEvent.CustomerCreated', 'asyncapi')

    const results = [
      makeResult('corum', [corumApi, corumEvent]),
      makeResult('openapi', [openApi]),
      makeResult('asyncapi', [asyncApi]),
    ]

    const { results: out, diagnostics } = deduplicateResults(results, [
      { primary: 'openapi', secondary: 'corum' },
      { primary: 'asyncapi', secondary: 'corum' },
    ])

    const corumResult = out.find(r => r.adapterId === 'corum')!
    assert.equal(corumResult.nodes.length, 0, 'both corum nodes dropped')
    assert.equal(diagnostics.length, 1, 'one warning for same-ID collision')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail (module not found)**

```
npm run build 2>&1 | head -5
```

Expected: TypeScript error — `Cannot find module '../../../src/import/dedup.js'`.

- [ ] **Step 3: Create dedup.ts**

Create `src/import/dedup.ts`:

```typescript
import type { Diagnostic, Edge, Node } from '../schema/index.js'
import type { DeduplicationRule } from './config.js'

export interface EntryResult {
  adapterId: string
  specPath: string
  nodes: Node[]
  edges: Edge[]
}

export interface DedupResult {
  results: EntryResult[]
  diagnostics: Diagnostic[]
}

export function deduplicateResults(
  results: EntryResult[],
  rules: DeduplicationRule[],
): DedupResult {
  const diagnostics: Diagnostic[] = []

  for (const rule of rules) {
    const primaryNodes = new Map<string, Node>()
    for (const r of results) {
      if (r.adapterId === rule.primary) {
        for (const node of r.nodes) primaryNodes.set(node.id, node)
      }
    }

    const redirects = new Map<string, string>()

    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      for (const node of r.nodes) {
        if (redirects.has(node.id)) continue

        const aka = node.properties['x-aka']
        if (Array.isArray(aka)) {
          const parts = node.id.split('.')
          const component = parts[0]
          const template = parts[1]
          for (const alias of aka as string[]) {
            const candidate = `${component}.${template}.${alias}`
            if (primaryNodes.has(candidate)) {
              redirects.set(node.id, candidate)
              break
            }
          }
        }

        if (!redirects.has(node.id) && primaryNodes.has(node.id)) {
          redirects.set(node.id, node.id)
          diagnostics.push({
            severity: 'warning',
            file: '',
            message: `Duplicate node ID from adapters ${rule.primary} and ${rule.secondary}: ${node.id} — ${rule.secondary} node dropped`,
          })
        }
      }
    }

    if (redirects.size === 0) continue

    for (const r of results) {
      r.edges = r.edges.map(edge => rewriteEdge(edge, redirects))
    }

    for (const r of results) {
      if (r.adapterId !== rule.secondary) continue
      r.nodes = r.nodes.filter(node => {
        if (redirects.has(node.id)) return false
        for (const secondaryId of redirects.keys()) {
          if (node.id.startsWith(secondaryId + '.')) return false
        }
        return true
      })
    }
  }

  for (const r of results) {
    for (const node of r.nodes) {
      delete node.properties['x-aka']
    }
  }

  return { results, diagnostics }
}

function rewriteEdge(edge: Edge, redirects: Map<string, string>): Edge {
  const from = rewriteEndpoint(edge.from, redirects)
  const to = rewriteEndpoint(edge.to, redirects)
  if (from === edge.from && to === edge.to) return edge
  return { ...edge, from, to, id: `${from}__${edge.type}__${to}` }
}

function rewriteEndpoint(endpoint: string, redirects: Map<string, string>): string {
  const exact = redirects.get(endpoint)
  if (exact !== undefined && exact !== endpoint) return exact

  for (const [secondaryId, primaryId] of redirects) {
    if (secondaryId === primaryId) continue
    const prefix = secondaryId + '.'
    if (endpoint.startsWith(prefix)) {
      return primaryId + '.' + endpoint.slice(prefix.length)
    }
  }

  return endpoint
}
```

- [ ] **Step 4: Build and run dedup tests**

```
npm run build && node --test dist/test/import/dedup.test.js
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/import/dedup.ts test/import/dedup.test.ts
git commit -m "feat: add cross-adapter deduplication module with x-aka and same-ID collision handling"
```

---

## Task 5: Runner integration

**Files:**
- Modify: `src/import/runner.ts`

**Consumes:** `deduplicateResults`, `EntryResult` from Task 4; `ImportConfig.deduplication` from Task 3.

- [ ] **Step 1: Restructure runner to collect-then-dedup-then-apply**

Replace the entire contents of `src/import/runner.ts`:

```typescript
import { parse as parseYaml } from 'yaml'
import path from 'node:path'
import { loadGraph } from '../loader/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { getAdapter } from '../adapters/index.js'
import { diffNodes } from '../reconcile/index.js'
import { deduplicateResults } from './dedup.js'
import type { EntryResult } from './dedup.js'
import type { ImportConfig } from './config.js'
import type { AdapterPackConfig } from '../adapters/index.js'
import type { Diagnostic } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import type { GraphRuntimeConfig } from '../source/config.js'

export interface RunResult {
  diagnostics: Diagnostic[]
}

export async function runImport(config: ImportConfig, runtimeConfig: GraphRuntimeConfig): Promise<RunResult> {
  const allDiagnostics: Diagnostic[] = []
  const graph = await loadGraph({ source: runtimeConfig.source })

  const entryResults: EntryResult[] = []

  for (const entry of config.imports) {
    const packConfig = await loadPackAdapterConfig(runtimeConfig, entry.adapter)
    if (!packConfig) {
      allDiagnostics.push({
        severity: 'error',
        file: runtimeConfig.graphPath,
        message: `No ${entry.adapter} adapter config found in active packs — is the ${entry.adapter === 'openapi' ? 'rest' : entry.adapter} pack active?`,
      })
      continue
    }

    const specPath = path.resolve(entry.spec)
    const resolvedEntry = { ...entry, spec: specPath }
    const adapter = getAdapter(resolvedEntry.adapter)
    const result = await adapter.import(resolvedEntry, {
      packConfig,
      templates: graph.templates,
      componentNameReplacements: config.componentNameReplacements ?? [],
    })
    allDiagnostics.push(...result.diagnostics)

    if (result.diagnostics.some(d => d.severity === 'error')) continue

    entryResults.push({ adapterId: entry.adapter, specPath, nodes: result.nodes, edges: result.edges })
  }

  if (config.deduplication?.length) {
    const { results: deduped, diagnostics } = deduplicateResults(entryResults, config.deduplication)
    allDiagnostics.push(...diagnostics)
    entryResults.splice(0, entryResults.length, ...deduped)
  }

  const STRUCTURAL_EDGE_TYPES = new Set(['has-field', 'has-value'])

  for (const er of entryResults) {
    const { toAdd, toUpdate, toRemove } = diffNodes(er.nodes, graph.nodesById, er.specPath)

    for (const node of [...toAdd, ...toUpdate, ...toRemove]) {
      graph.nodesById.set(node.id, node)
    }

    for (const edge of er.edges) {
      if (STRUCTURAL_EDGE_TYPES.has(edge.type)) continue
      const existing = graph.edgesByFrom.get(edge.from) ?? []
      if (!existing.some(e => e.id === edge.id)) {
        graph.edgesByFrom.set(edge.from, [...existing, edge])
        const byTo = graph.edgesByTo.get(edge.to) ?? []
        graph.edgesByTo.set(edge.to, [...byTo, edge])
      }
    }
  }

  const graphPath = runtimeConfig.kind === 'filesystem' ? runtimeConfig.graphPath : undefined
  const contentMap = serializeGraph(graph, { sourceGraphPath: graphPath, outputGraphPath: graphPath })
  await runtimeConfig.source.commit(
    await runtimeConfig.source.defaultBranch(),
    contentMap,
    'corum import',
    { replaceGraphContent: true },
  )

  return { diagnostics: allDiagnostics }
}

async function loadPackAdapterConfig(runtimeConfig: GraphRuntimeConfig, adapterId: string): Promise<AdapterPackConfig | null> {
  let packContent: ContentMap
  try {
    packContent = await runtimeConfig.source.loadPackContent(await runtimeConfig.source.defaultBranch())
  } catch {
    return null
  }
  for (const [key, content] of packContent) {
    if (key.endsWith(`/adapters/${adapterId}.yaml`)) {
      try {
        return parseYaml(content) as AdapterPackConfig
      } catch {
        return null
      }
    }
  }
  return null
}
```

- [ ] **Step 2: Build**

```
npm run build
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Run full test suite**

```
npm test
```

Expected: all tests pass (45 nodes, 38 edges from loader fixtures unchanged; corum runner integration test unchanged since no `deduplication` key in its fixture config).

- [ ] **Step 4: Commit**

```bash
git add src/import/runner.ts
git commit -m "feat: restructure runner to collect-then-dedup-then-apply; wire up deduplication config"
```

---

## Self-Review

**Spec coverage:**
- ✅ `x-aka` in interchange schema — Task 1
- ✅ `'x-aka'?: string[]` on `CorumInterchangeNodeEntry` — Task 1
- ✅ `x-aka` flows through mapper to `node.properties['x-aka']` — Task 2
- ✅ `DeduplicationRule` + `deduplication?` in `ImportConfig` — Task 3
- ✅ `loadImportConfig` validates dedup rules — Task 3
- ✅ `dedup.ts` is standalone, pure, no I/O — Task 4
- ✅ x-aka match: secondary root + children dropped, edges rewritten — Task 4
- ✅ Same-ID collision: secondary dropped, warning emitted — Task 4
- ✅ Prefix substitution for child-node edges — Task 4
- ✅ x-aka stripped from all remaining nodes — Task 4
- ✅ Runner collects-then-dedupes-then-applies — Task 5
- ✅ No dedup rules → existing behaviour unchanged — Task 5

**Placeholder scan:** None found.

**Type consistency:**
- `EntryResult` defined in `dedup.ts` (Task 4), imported by `runner.ts` (Task 5) — consistent.
- `DeduplicationRule` defined in `config.ts` (Task 3), imported by `dedup.ts` (Task 4) — consistent.
- `deduplicateResults(results: EntryResult[], rules: DeduplicationRule[]): DedupResult` — matches usage in runner.
- `node.properties['x-aka']` written in mapper (Task 2), read in dedup (Task 4), deleted in dedup (Task 4) — consistent.
