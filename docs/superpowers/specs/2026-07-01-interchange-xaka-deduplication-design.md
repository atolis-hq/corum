# Design: Interchange x-aka + Cross-Adapter Deduplication

**Date:** 2026-07-01
**Status:** Approved

## Problem

The corum extractor produces nodes whose IDs come from C# class names (e.g. `employments.APIEndpoint.GetEmploymentController`), while the OpenAPI adapter produces nodes from `operationId` values (e.g. `employments.APIEndpoint.GetEmployment`). These represent the same entity but have different IDs, so they both survive import and create duplicates in the graph.

The same issue applies to IntegrationEvents: corum names them from the C# class, AsyncAPI names them from the channel message. Additionally, two adapters can independently produce a node with exactly the same ID (e.g. an `IntegrationEvent` whose class name matches its AsyncAPI message name), which is a silent last-writer-wins collision today.

The `x-aka` field has been added to the corum extractor output to carry alternative names that bridge corum node IDs to their counterparts in other specs.

## Goals

1. Add `x-aka` to the interchange schema so extractors can annotate nodes with alternative names.
2. Flow `x-aka` from the interchange format through the corum adapter to the runner.
3. Deduplicate nodes across adapters in the runner using `x-aka` matching and same-ID collision detection, controlled by config-declared rules.
4. Preserve all semantic edges from the dropped (secondary) node by rewriting their endpoints to the kept (primary) node.
5. Log a warning on same-ID collisions so they are visible.

## Out of Scope

- Merging properties from secondary nodes into primary nodes (primary wins entirely).
- Deduplication between two runs of the same adapter.
- Automatic deduplication without a declared config rule.

---

## Design

### 1. Interchange Schema (`interchange.schema.yaml`)

Add `x-aka` as an optional field on node entries:

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

### 2. TypeScript Types

**`CorumInterchangeNodeEntry`** in `src/adapters/corum/parser.ts`:

```typescript
export interface CorumInterchangeNodeEntry {
  type: string
  title?: string
  schema?: { $ref: string }
  'x-aka'?: string[]
  provenance?: CorumInterchangeProvenance
}
```

**`ImportConfig`** and new **`DeduplicationRule`** in `src/import/config.ts`:

```typescript
export interface DeduplicationRule {
  primary: string   // adapter id whose nodes win (e.g. 'openapi', 'asyncapi')
  secondary: string // adapter id whose nodes are replaced (e.g. 'corum')
}

export interface ImportConfig {
  componentNameReplacements?: ComponentNameReplacement[]
  deduplication?: DeduplicationRule[]
  imports: ImportEntry[]
}
```

No changes to the `Node` type in `src/schema/index.ts`. The `x-aka` values travel as `properties['x-aka']` on the node — a transient property stripped by the dedup step before the graph is written.

### 3. Corum Mapper (`src/adapters/corum/mapper.ts`)

When a node entry has `x-aka`, write the values into the emitted node's properties:

```typescript
if (entry['x-aka']?.length) {
  properties['x-aka'] = entry['x-aka']
}
```

This piggybacks on the existing `properties` map so no interface changes are needed downstream.

### 4. Runner Restructure (`src/import/runner.ts`)

Currently the runner applies each adapter's results to the graph immediately inside the loop. To deduplicate across adapters the runner must collect all results first, then deduplicate, then apply.

**New flow:**

```
1. Load graph
2. For each entry → adapter.import() → collect { entry, nodes, edges, diagnostics }
3. If config.deduplication is non-empty → run dedup pass across all collected results
4. For each collected result → apply nodes/edges to graph (existing diffNodes logic)
5. Serialize and commit
```

### 5. Deduplication (`src/import/dedup.ts`)

A new standalone module, kept deliberately separate from the runner. It has no I/O, no graph loading, and no adapter knowledge — it operates only on plain `EntryResult` values. This makes it independently testable and replaceable without touching the runner.

**Exported interface:**

```typescript
export interface EntryResult {
  adapterId: string
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
): DedupResult
```

**Algorithm for each rule `{ primary, secondary }`:**

```
primaryNodes  = nodes from results where adapterId === rule.primary
secondaryResults = results where adapterId === rule.secondary

redirects = Map<string, string>   // secondaryId → primaryId

// Case 1: x-aka matching (IDs differ)
for each secondary node where properties['x-aka'] exists:
  [component, template, ...] = nodeId.split('.')
  for each aka in properties['x-aka']:
    candidate = `${component}.${template}.${aka}`
    if primaryNodes has node with id === candidate:
      redirects.set(nodeId, candidate)
      break

// Case 2: same-ID collision
for each secondary node not already in redirects:
  if primaryNodes has node with id === node.id:
    redirects.set(node.id, node.id)   // sentinel: same ID, still needs drop + warning
    emit warning diagnostic: "Duplicate node ID from adapters {primary} and {secondary}: {nodeId} — {secondary} node dropped"

// Apply redirects
rewriteEdges(allEdges, redirects)
dropSecondaryNodes(secondaryResults, redirects)

// Strip x-aka from all remaining nodes across all results
for each node in all results:
  delete node.properties['x-aka']
```

**Edge rewriting:**

For each edge across all results:
- If `edge.from` is an exact key in `redirects` and the mapped value differs → replace with mapped value, recompute `edge.id`
- If `edge.from` starts with `{secondaryId}.` where `secondaryId` is in redirects → replace that prefix with `redirects.get(secondaryId)`, recompute `edge.id`
- Same logic for `edge.to`

The prefix substitution handles `maps-to` and other edges that reference schema/field child nodes of the secondary root. For same-ID collisions the prefix substitution is a no-op (prefix is unchanged), so those edges are correct without rewriting.

**Node dropping:**

Remove from the secondary result's nodes:
- Any node where `redirects.has(node.id)`
- Any node where `node.id.startsWith(secondaryId + '.')` for any redirect key `secondaryId`

### 6. Config File Example

```yaml
deduplication:
  - primary: openapi
    secondary: corum
  - primary: asyncapi
    secondary: corum

imports:
  - adapter: corum
    spec: ./prl-core-service.corum.yaml
  - adapter: openapi
    spec: ./openapi.yaml
    componentMapping:
      strategy: tag
  - adapter: asyncapi
    spec: ./asyncapi.yaml
    componentMapping:
      strategy: channel-segment
      separator: .
      segment: 0
```

Import order does not affect deduplication outcome — dedup runs after all adapters complete.

---

## Concrete Examples

### APIEndpoint (x-aka match, IDs differ)

Corum node:
```
id: billing.APIEndpoint.GetInvoiceController
properties: { x-aka: [GetInvoice] }
edges: [GetInvoiceController --triggers--> billing.Command.GetInvoiceQuery]
```

OpenAPI node:
```
id: billing.APIEndpoint.GetInvoice
properties: { method: GET, path: /invoices/{invoiceId}, parameters: {...}, responses: {...} }
```

After dedup:
- `GetInvoice` kept (all OpenAPI properties intact)
- `GetInvoiceController` dropped
- Edge rewritten: `GetInvoice --triggers--> billing.Command.GetInvoiceQuery`
- No warning (expected behaviour)

### IntegrationEvent (same-ID collision)

Corum node:
```
id: customers.IntegrationEvent.CustomerCreatedIntegrationEvent
children: [schemas.CustomerCreatedIntegrationEvent, schemas.*.fields.*]
edges: [customers.DomainModel.CustomerAggregate.operations.Create --produces--> CustomerCreatedIntegrationEvent]
```

AsyncAPI node (same ID):
```
id: customers.IntegrationEvent.CustomerCreatedIntegrationEvent
children: [schemas.CustomerCreatedIntegrationEvent, schemas.*.fields.*]
```

After dedup (asyncapi primary):
- AsyncAPI root node + children kept
- Corum root node + children dropped
- `produces` edge endpoint unchanged (same ID)
- Warning emitted: "Duplicate node ID from adapters asyncapi and corum: customers.IntegrationEvent.CustomerCreatedIntegrationEvent — corum node dropped"

---

## Files Changed

| File | Change |
|---|---|
| `.corum/packs/extract/interchange.schema.yaml` | Add `x-aka` field to node entry definition |
| `src/adapters/corum/parser.ts` | Add `'x-aka'?: string[]` to `CorumInterchangeNodeEntry` |
| `src/adapters/corum/mapper.ts` | Write `x-aka` values to `properties['x-aka']` |
| `src/import/config.ts` | Add `DeduplicationRule` interface; add `deduplication?` to `ImportConfig` |
| `src/import/runner.ts` | Collect all results before applying; call dedup step; pass `adapterId` per result |
| `src/import/dedup.ts` | New — pure deduplication logic |
| `test/adapters/corum/mapper.test.ts` | Add test for x-aka passthrough into properties |
| `test/import/dedup.test.ts` | New — unit tests for dedup (x-aka match, same-ID collision, edge rewriting, child node dropping, prefix substitution) |

---

## Open Questions

None — all design decisions resolved during brainstorming.
