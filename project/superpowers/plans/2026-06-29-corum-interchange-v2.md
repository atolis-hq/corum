# Corum Interchange Format v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the corum interchange adapter to parse the new `corum: "1.0"` format where schemas are expressed as JSON Schema objects in a `components.schemas` section rather than flat Schema/Field nodes in the `nodes` array.

**Architecture:** The parser is updated to recognise the new envelope structure (`corum` key, nodes-as-map, `components.schemas`). The mapper is extended to expand JSON Schema objects from `components.schemas` into Schema and Field Node objects — the same objects the cluster writer needs to produce inline `schemas:` sections in cluster YAML files. All other subsystems (cluster loader, graph query, MCP) remain unchanged; they only see Node/Edge objects.

**Tech Stack:** TypeScript, Node.js test runner (`node --test`), `yaml` YAML parser.

## Global Constraints

- Build: `npm run build` (tsc → dist/) must pass with zero errors before every commit.
- Tests: `npm test` (build + Node test runner) must pass before every commit.
- No external dependencies added — use only what is already in `package.json`.
- Follow existing code style: no comments, no semicolons where the codebase omits them.

---

## File Map

| File | Action | What changes |
|---|---|---|
| `src/adapters/corum/parser.ts` | Modify | New TypeScript interfaces + updated type guard for new format |
| `src/adapters/corum/mapper.ts` | Modify | Nodes-as-map iteration; schema expansion from `components.schemas` |
| `test/adapters/corum/parser.test.ts` | Modify | Tests updated for new format structure |
| `test/adapters/corum/mapper.test.ts` | Modify | Tests updated + new schema expansion tests |
| `test/fixtures/corum/specs/basic.corum.yaml` | Modify | Fixture rewritten to new format |
| `test/fixtures/corum/expected/basic/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml` | Modify | `derivedBy` value updated |
| `test/fixtures/corum/expected/basic/components/orders/DomainModels/OrderAggregate.yaml` | Modify | `derivedBy` value updated |
| `.corum/packs/extract/interchange.schema.yaml` | Modify | JSON Schema for envelope updated to new structure |
| `tmp/samples/prl/prl-core.corum.yaml` | Replace | Updated to new format |

---

## Format Reference

### Old format (`corumInterchange: "1.0"`)

```yaml
corumInterchange: "1.0"
targets:
  - pack: core
    version: ^1.0.0
source:
  analyser: corum-extract
  language: csharp
nodes:
  - id: orders.DomainEvent.OrderPlacedDomainEvent
    template: DomainEvent
    properties:
      schema: OrderPlacedDomainEvent
    provenance:
      derivation: resolved
      by: treesitter
  - id: orders.DomainEvent.OrderPlacedDomainEvent.schemas.OrderPlacedDomainEvent
    template: Schema
    properties: {}
  - id: orders.DomainEvent.OrderPlacedDomainEvent.schemas.OrderPlacedDomainEvent.fields.OrderId
    template: Field
    properties:
      nullable: false
      collection: one
      type: uuid
edges:
  - from: orders.DomainModel.OrderAggregate.operations.Place
    to: orders.DomainEvent.OrderPlacedDomainEvent
    type: produces
    provenance:
      derivation: inferred
      by: treesitter
gaps:
  - kind: unresolved-field-type
    nodeId: orders.SomeNode.fields.SomeField
    reason: MissingType
```

### New format (`corum: "1.0"`)

```yaml
corum: "1.0"
info:
  title: MyService
  version: 1.0.0.0
  source:
    analyser: corum-extract
    language: csharp
  packs:
    - name: core
      version: ^1.0.0
nodes:
  orders.DomainEvent.OrderPlacedDomainEvent:
    type: DomainEvent
    title: OrderPlacedDomainEvent
    schema:
      $ref: '#/components/schemas/OrderPlacedDomainEvent'
    provenance:
      derivation: determined
      derivedBy: extractor:roslyn
      extractedFrom: /path/to/OrderPlacedDomainEvent.cs
  orders.DomainModel.OrderAggregate:
    type: DomainModel
    title: OrderAggregate
    provenance:
      derivation: determined
      derivedBy: extractor:roslyn
      extractedFrom: /path/to/OrderAggregate.cs
  orders.DomainModel.OrderAggregate.operations.Place:
    type: DomainOperation
    title: Place
    provenance:
      derivation: inferred
      derivedBy: extractor:roslyn
      extractedFrom: /path/to/OrderAggregate.cs
components:
  schemas:
    OrderPlacedDomainEvent:
      type: object
      required:
        - OrderId
      properties:
        OrderId:
          type: string
          format: uuid
edges:
  - type: produces
    from: orders.DomainModel.OrderAggregate.operations.Place
    to: orders.DomainEvent.OrderPlacedDomainEvent
gaps:
  - kind: unresolved-field-type
    nodeId: orders.SomeNode.fields.SomeField
    reason: MissingType
```

### Key differences

| Aspect | Old | New |
|---|---|---|
| Top-level key | `corumInterchange` | `corum` |
| Pack requirements | `targets: [{pack, version}]` | `info.packs: [{name, version}]` |
| Source metadata | top-level `source` | `info.source` |
| `nodes` shape | array of `{id, template, properties, provenance}` | object keyed by node ID, values `{type, title?, schema?, provenance?}` |
| Schema nodes | flat nodes in `nodes` array | absent — schemas live in `components.schemas` |
| Field nodes | flat nodes in `nodes` array | absent — fields are properties inside JSON Schema objects |
| `schema` reference | `properties.schema = "SchemaName"` | `schema: { $ref: "#/components/schemas/SchemaName" }` |
| Provenance `by` | `provenance.by: treesitter` | `provenance.derivedBy: extractor:roslyn` |
| Provenance `derivation` | `resolved` \| `inferred` | `determined` \| `inferred` |
| Edge provenance | present (optional) | absent |

### Mapper output (unchanged)

The mapper still produces the same Node/Edge objects the rest of the system expects. The only change is HOW the mapper derives them:

- Root node → 1 Node (id = map key, template = `type`)
- Node with `schema.$ref` → root Node + 1 Schema Node + N Field Nodes
- DomainOperation child (5+ segment id) → 1 Node as before
- Edges → same Edge objects

### Scalar type mapping (JSON Schema → corum)

| JSON Schema type | format | corum type |
|---|---|---|
| `string` | `uuid` | `uuid` |
| `string` | `date-time` | `datetime` |
| `string` | `date` | `date` |
| `string` | (none) | `string` |
| `integer` | any | `integer` |
| `number` | any | `decimal` |
| `boolean` | any | `boolean` |
| anything else | any | `string` |

### $ref field handling within schemas

When a JSON Schema property has `$ref: '#/components/schemas/SomeType'`:
1. Recursively expand `SomeType` as a sibling schema node under the SAME root node
2. Set the field's `properties.$ref` to the Schema node ID
3. Avoid duplicate expansion using a `Map<schemaName, schemaNodeId>` per root node (`expanded`)

### Dictionary/map field handling (`additionalProperties`)

When a JSON Schema property (or a top-level schema) has `type: object` and `additionalProperties`:
1. Create a `Mapping` node: id = `${schemaId}.mappings.${fieldName}`
2. Set the field's `properties.$ref = '#/mappings/${fieldName}'` (local cluster reference)
3. Track created mappings with a `localMappings: Map<string, string>` per schema expansion (prevents duplicates)

Mapping node `properties` depend on `additionalProperties` contents:

| `additionalProperties` | Mapping properties |
|---|---|
| `{ type: string }` | `{ type: 'string' }` |
| `{ $ref: '#/.../T' }` | `{ $ref: '<T schema node id>' }` |
| `{ type: array, items: { $ref: '...' } }` | `{ value-collection: 'array', $ref: '<T schema node id>' }` |
| `{ type: array, items: { type: string } }` | `{ value-collection: 'array', type: 'string' }` |
| `{ type: object, additionalProperties: ... }` | `{ $ref: '<inner Mapping node id>' }` (map-of-map) |

---

## Task 1: Update parser types and type guard

**Files:**
- Modify: `src/adapters/corum/parser.ts`
- Test: `test/adapters/corum/parser.test.ts`

**Interfaces:**

After this task, `parser.ts` exports:

```typescript
export interface CorumInterchangeProvenance {
  derivation?: 'determined' | 'inferred'
  derivedBy?: string
  extractedFrom?: string
}

export interface CorumInterchangeNodeEntry {
  type: string
  title?: string
  schema?: { $ref: string }
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeEdge {
  type: string
  from: string
  to: string
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeDocument {
  corum: string
  info?: {
    title?: string
    version?: string
    source?: { analyser?: string; language?: string }
    packs?: Array<{ name: string; version: string }>
  }
  nodes: Record<string, CorumInterchangeNodeEntry>
  components?: {
    schemas?: Record<string, unknown>
  }
  edges?: CorumInterchangeEdge[]
  gaps?: Array<{ kind: string; nodeId?: string; reason?: string; file?: string }>
}
```

`parseSpec(specPath: string): ParseResult` — unchanged signature, now validates `corum` key instead of `corumInterchange`, nodes must be an object (not an array).

- [ ] **Step 1: Replace `parser.ts` with new version**

Replace the entire file at `src/adapters/corum/parser.ts`:

```typescript
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic } from '../../schema/index.js'

const SUPPORTED_VERSION = '1.0'

export interface CorumInterchangeProvenance {
  derivation?: 'determined' | 'inferred'
  derivedBy?: string
  extractedFrom?: string
}

export interface CorumInterchangeNodeEntry {
  type: string
  title?: string
  schema?: { $ref: string }
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeEdge {
  type: string
  from: string
  to: string
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeDocument {
  corum: string
  info?: {
    title?: string
    version?: string
    source?: { analyser?: string; language?: string }
    packs?: Array<{ name: string; version: string }>
  }
  nodes: Record<string, CorumInterchangeNodeEntry>
  components?: {
    schemas?: Record<string, unknown>
  }
  edges?: CorumInterchangeEdge[]
  gaps?: Array<{ kind: string; nodeId?: string; reason?: string; file?: string }>
}

export interface ParseResult {
  document: CorumInterchangeDocument | null
  diagnostics: Diagnostic[]
}

export function parseSpec(specPath: string): ParseResult {
  const diagnostics: Diagnostic[] = []
  let raw: unknown

  try {
    raw = parseYaml(readFileSync(specPath, 'utf-8'))
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to read or parse file: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }

  if (!isCorumInterchangeDocument(raw)) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: 'Invalid corum interchange file: missing required "corum" key or "nodes" object',
    })
    return { document: null, diagnostics }
  }

  const doc = raw as CorumInterchangeDocument

  if (doc.corum !== SUPPORTED_VERSION) {
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      message: `Unknown corum version "${doc.corum}" — expected "${SUPPORTED_VERSION}", continuing`,
    })
  }

  return { document: doc, diagnostics }
}

function isCorumInterchangeDocument(value: unknown): value is CorumInterchangeDocument {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.corum === 'string' &&
    typeof v.nodes === 'object' &&
    v.nodes !== null &&
    !Array.isArray(v.nodes)
  )
}
```

- [ ] **Step 2: Replace `parser.test.ts` with new version**

Replace `test/adapters/corum/parser.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseSpec } from '../../../src/adapters/corum/parser.js'

function writeTmp(content: string): { filePath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-parser-'))
  const filePath = path.join(dir, 'test.corum.yaml')
  fs.writeFileSync(filePath, content)
  return { filePath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}

describe('parseSpec', () => {
  it('returns document for a valid interchange file', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  orders.DomainEvent.OrderPlaced:
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.equal(document.corum, '1.0')
    assert.ok('orders.DomainEvent.OrderPlaced' in document.nodes)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })

  it('returns null and error diagnostic when corum key is missing', () => {
    const { filePath, cleanup } = writeTmp(`
nodes:
  orders.DomainEvent.OrderPlaced:
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is missing', () => {
    const { filePath, cleanup } = writeTmp(`corum: "1.0"`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when nodes is an array (old format)', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  - id: orders.DomainEvent.OrderPlaced
    type: DomainEvent
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns document with warning for unknown version', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "2.0"
nodes: {}
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('2.0')))
    cleanup()
  })

  it('returns null and error diagnostic for invalid YAML', () => {
    const { filePath, cleanup } = writeTmp(`{ bad yaml: [`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
    cleanup()
  })

  it('returns null and error diagnostic when file does not exist', () => {
    const { document, diagnostics } = parseSpec('/nonexistent/path.corum.yaml')
    assert.equal(document, null)
    assert.ok(diagnostics.some(d => d.severity === 'error'))
  })

  it('parses components.schemas when present', () => {
    const { filePath, cleanup } = writeTmp(`
corum: "1.0"
nodes:
  orders.Command.PlaceOrderCommand:
    type: Command
    schema:
      $ref: '#/components/schemas/PlaceOrderCommand'
components:
  schemas:
    PlaceOrderCommand:
      type: object
      properties:
        OrderId:
          type: string
          format: uuid
`)
    const { document, diagnostics } = parseSpec(filePath)
    assert.ok(document !== null)
    assert.ok(document.components?.schemas?.['PlaceOrderCommand'] !== undefined)
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
    cleanup()
  })
})
```

- [ ] **Step 3: Build and run parser tests**

```
npm run build && node --test dist/test/adapters/corum/parser.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/corum/parser.ts test/adapters/corum/parser.test.ts
git commit -m "feat: update corum interchange parser to v2 format (corum key, nodes-as-map)"
```

---

## Task 2: Update the mapper

**Files:**
- Modify: `src/adapters/corum/mapper.ts`
- Test: `test/adapters/corum/mapper.test.ts`

**Interfaces consumed from Task 1:**
```typescript
import type { CorumInterchangeDocument, CorumInterchangeNodeEntry, CorumInterchangeEdge, CorumInterchangeProvenance } from './parser.js'
```

The `mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult` signature is unchanged.

**Key mapper behaviours:**

1. Iterate `Object.entries(document.nodes)` — key is node ID, value is `CorumInterchangeNodeEntry`.
2. `entry.type` → `Node.template`.
3. `entry.title` → `Node.properties.description` when no schema ref present; omitted when schema ref present (schema name serves as identity).
4. `entry.schema?.$ref` → strip `#/components/schemas/` prefix → set `Node.properties.schema = schemaName`, then expand schema.
5. Schema expansion: for each property in the JSON Schema, create a Schema Node and Field Nodes as siblings; handle `$ref` fields recursively.
6. `entry.provenance.derivedBy` → passed through directly as `Node.derivedBy` (already a qualified identifier).
7. `entry.provenance.derivation`: `determined` → `'determined'`, `inferred` → `'inferred'`, absent → `'determined'`.
8. Edges: `{type, from, to}` — no provenance; defaults to `derivation: 'determined'`, `derivedBy: 'adapter:corum'`.

- [ ] **Step 1: Replace `mapper.ts` with new version**

Replace the entire file at `src/adapters/corum/mapper.ts`:

```typescript
import type { Diagnostic, Edge, EdgeType, Node } from '../../schema/index.js'
import type { CorumInterchangeDocument, CorumInterchangeEdge, CorumInterchangeProvenance } from './parser.js'

const VALID_EDGE_TYPES = new Set<string>([
  'triggers', 'produces', 'reads', 'calls', 'implements',
  'maps-to', 'derived-from', 'renamed-from', 'has-field', 'has-value',
])

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function mapDocument(document: CorumInterchangeDocument, specPath: string): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const allSchemas = (document.components?.schemas ?? {}) as Record<string, unknown>

  for (const gap of document.gaps ?? []) {
    const msg = gap.nodeId
      ? `[${gap.kind}] ${gap.nodeId}: ${gap.reason ?? ''}`
      : `[${gap.kind}] ${gap.reason ?? ''}`
    diagnostics.push({ severity: 'warning', file: specPath, message: msg })
  }

  for (const [nodeId, entry] of Object.entries(document.nodes)) {
    if (!nodeId || !entry.type) {
      diagnostics.push({ severity: 'warning', file: specPath, message: 'Node missing id or type — skipping' })
      continue
    }

    const component = nodeId.split('.')[0]
    const properties: Record<string, unknown> = {}

    let schemaName: string | undefined
    if (entry.schema?.$ref) {
      schemaName = schemaRefName(entry.schema.$ref)
      if (schemaName) properties.schema = schemaName
    }

    if (entry.title && !schemaName) {
      properties.description = entry.title
    }

    const node = makeNode(entry.type, component, specPath, nodeId, entry.provenance, properties)
    nodes.push(node)

    if (schemaName) {
      const expanded = new Map<string, string>()
      expandSchema(schemaName, nodeId, allSchemas, nodes, edges, specPath, component, expanded)
    }
  }

  for (const raw of document.edges ?? []) {
    if (!VALID_EDGE_TYPES.has(raw.type)) {
      diagnostics.push({
        severity: 'warning',
        file: specPath,
        message: `Unknown edge type '${raw.type}' from '${raw.from}' to '${raw.to}' — skipping`,
      })
      continue
    }
    edges.push(mapEdge(raw))
  }

  return { nodes, edges, diagnostics }
}

function schemaRefName(ref: string): string | undefined {
  const prefix = '#/components/schemas/'
  if (!ref.startsWith(prefix)) return undefined
  return ref.slice(prefix.length)
}

function expandSchema(
  schemaName: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
): string {
  const existing = expanded.get(schemaName)
  if (existing) return existing

  const schemaId = `${rootNodeId}.schemas.${schemaName}`
  expanded.set(schemaName, schemaId)

  const schemaDef = allSchemas[schemaName] as { type?: string; properties?: Record<string, unknown>; required?: string[] } | undefined

  const schemaNode = makeNode('Schema', component, specPath, schemaId, undefined, {})
  nodes.push(schemaNode)
  edges.push(makeHasFieldEdge(rootNodeId, schemaId))

  const localMappings = new Map<string, string>()

  for (const [fieldName, rawProp] of Object.entries(schemaDef?.properties ?? {})) {
    const fieldId = `${schemaId}.fields.${fieldName}`
    const fieldNode = makeNode('Field', component, specPath, fieldId, undefined, {})
    const required = Array.isArray(schemaDef?.required) && schemaDef.required.includes(fieldName)

    fieldNode.properties = resolveFieldProperties(
      fieldName, rawProp as Record<string, unknown>, required,
      schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings,
    )

    nodes.push(fieldNode)
    edges.push(makeHasFieldEdge(schemaId, fieldId))
  }

  return schemaId
}

function resolveFieldProperties(
  fieldName: string,
  prop: Record<string, unknown>,
  required: boolean,
  schemaId: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
  localMappings: Map<string, string>,
): Record<string, unknown> {
  const nullable = !required

  if (typeof prop.$ref === 'string') {
    const refName = schemaRefName(prop.$ref)
    if (refName) {
      const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded)
      return { $ref: refId, nullable, collection: 'one' }
    }
    return { type: 'string', nullable, collection: 'one' }
  }

  const type = prop.type as string | undefined

  if (type === 'array') {
    const items = prop.items as Record<string, unknown> | undefined
    if (items && typeof items.$ref === 'string') {
      const refName = schemaRefName(items.$ref as string)
      if (refName) {
        const refId = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded)
        return { $ref: refId, nullable, collection: 'array' }
      }
    }
    const itemType = mapScalar(
      (items?.type as string | undefined) ?? 'string',
      items?.format as string | undefined,
    )
    return { type: itemType, nullable, collection: 'array' }
  }

  if (type === 'object' && prop.additionalProperties !== undefined) {
    createMapping(fieldName, prop.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings)
    return { $ref: `#/mappings/${fieldName}`, nullable, collection: 'one' }
  }

  const scalarType = mapScalar(type ?? 'string', prop.format as string | undefined)
  return { type: scalarType, nullable, collection: 'one' }
}

function createMapping(
  mappingName: string,
  addlDef: unknown,
  schemaId: string,
  rootNodeId: string,
  allSchemas: Record<string, unknown>,
  nodes: Node[],
  edges: Edge[],
  specPath: string,
  component: string,
  expanded: Map<string, string>,
  localMappings: Map<string, string>,
): string {
  const existing = localMappings.get(mappingName)
  if (existing) return existing

  const mappingId = `${schemaId}.mappings.${mappingName}`
  localMappings.set(mappingName, mappingId)

  const mappingNode = makeNode('Mapping', component, specPath, mappingId, undefined, {})
  const props: Record<string, unknown> = {}

  if (!addlDef || typeof addlDef === 'boolean') {
    props.type = 'string'
  } else {
    const addl = addlDef as Record<string, unknown>
    if (typeof addl.$ref === 'string') {
      const refName = schemaRefName(addl.$ref)
      if (refName) {
        props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded)
      } else {
        props.type = 'string'
      }
    } else if (addl.type === 'array') {
      props['value-collection'] = 'array'
      const items = addl.items as Record<string, unknown> | undefined
      if (items && typeof items.$ref === 'string') {
        const refName = schemaRefName(items.$ref as string)
        if (refName) {
          props.$ref = expandSchema(refName, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded)
        } else {
          props.type = 'string'
        }
      } else {
        props.type = mapScalar((items?.type as string) ?? 'string', items?.format as string | undefined)
      }
    } else if (addl.type === 'object' && addl.additionalProperties !== undefined) {
      const innerName = `${mappingName}-values`
      props.$ref = createMapping(innerName, addl.additionalProperties, schemaId, rootNodeId, allSchemas, nodes, edges, specPath, component, expanded, localMappings)
    } else {
      props.type = mapScalar((addl.type as string) ?? 'string', addl.format as string | undefined)
    }
  }

  mappingNode.properties = props
  nodes.push(mappingNode)
  return mappingId
}

function mapScalar(type: string, format: string | undefined): string {
  if (type === 'string') {
    if (format === 'uuid') return 'uuid'
    if (format === 'date-time') return 'datetime'
    if (format === 'date') return 'date'
    return 'string'
  }
  if (type === 'integer') return 'integer'
  if (type === 'number') return 'decimal'
  if (type === 'boolean') return 'boolean'
  return 'string'
}

function makeNode(
  template: string,
  component: string,
  specPath: string,
  id: string,
  provenance: CorumInterchangeProvenance | undefined,
  properties: Record<string, unknown>,
): Node {
  return {
    id,
    template,
    component,
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: new Date().toISOString().split('T')[0],
    extractedFrom: specPath,
    derivation: provenance?.derivation === 'inferred' ? 'inferred' : 'determined',
    derivedBy: provenance?.derivedBy ?? 'adapter:corum',
    properties,
  }
}

function makeHasFieldEdge(from: string, to: string): Edge {
  return {
    id: `${from}__has-field__${to}`,
    from,
    to,
    type: 'has-field',
    state: 'implemented',
    stability: 'unstable',
    derivation: 'determined',
    derivedBy: 'adapter:corum',
  }
}

function mapEdge(raw: CorumInterchangeEdge): Edge {
  return {
    id: `${raw.from}__${raw.type}__${raw.to}`,
    from: raw.from,
    to: raw.to,
    type: raw.type as EdgeType,
    state: 'implemented',
    stability: 'unstable',
    derivation: raw.provenance?.derivation === 'inferred' ? 'inferred' : 'determined',
    derivedBy: raw.provenance?.derivedBy ?? 'adapter:corum',
  }
}
```

- [ ] **Step 2: Replace `mapper.test.ts` with new version**

Replace `test/adapters/corum/mapper.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapDocument } from '../../../src/adapters/corum/mapper.js'
import type { CorumInterchangeDocument } from '../../../src/adapters/corum/parser.js'

const SPEC_PATH = '/fake/output.corum.yaml'

function makeDoc(overrides: Partial<CorumInterchangeDocument> = {}): CorumInterchangeDocument {
  return {
    corum: '1.0',
    nodes: {},
    ...overrides,
  }
}

describe('mapDocument — nodes (basic)', () => {
  it('maps a determined node', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          title: 'OrderPlaced',
          provenance: { derivation: 'determined', derivedBy: 'extractor:treesitter' },
        },
      },
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 1)
    const n = nodes[0]
    assert.equal(n.id, 'orders.DomainEvent.OrderPlaced')
    assert.equal(n.template, 'DomainEvent')
    assert.equal(n.component, 'orders')
    assert.equal(n.state, 'implemented')
    assert.equal(n.stability, 'unstable')
    assert.equal(n.schemaVersion, '1')
    assert.equal(n.derivation, 'determined')
    assert.equal(n.derivedBy, 'extractor:treesitter')
    assert.equal(n.extractedFrom, SPEC_PATH)
    assert.deepEqual(n.properties, { description: 'OrderPlaced' })
    assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  })

  it('maps an inferred node', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainModel.OrderAggregate.operations.Place': {
          type: 'DomainOperation',
          title: 'Place',
          provenance: { derivation: 'inferred', derivedBy: 'extractor:treesitter' },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'inferred')
  })

  it('defaults derivation to determined and derivedBy to adapter:corum when provenance absent', () => {
    const doc = makeDoc({
      nodes: { 'orders.DomainEvent.OrderPlaced': { type: 'DomainEvent' } },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes[0].derivation, 'determined')
    assert.equal(nodes[0].derivedBy, 'adapter:corum')
  })

  it('sets description from title when no schema ref', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainModel.OrderAggregate': {
          type: 'DomainModel',
          title: 'OrderAggregate',
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    assert.deepEqual(nodes[0].properties, { description: 'OrderAggregate' })
  })

  it('does not set description when schema ref is present', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          title: 'OrderPlaced',
          schema: { $ref: '#/components/schemas/OrderPlaced' },
        },
      },
      components: {
        schemas: {
          OrderPlaced: { type: 'object', properties: {} },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const root = nodes.find(n => n.id === 'orders.DomainEvent.OrderPlaced')!
    assert.ok(!('description' in root.properties))
    assert.equal(root.properties.schema, 'OrderPlaced')
  })

  it('emits a warning and skips nodes missing type', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': { type: '' },
      },
    })
    const { nodes, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning'))
  })
})

describe('mapDocument — schema expansion', () => {
  it('creates Schema and Field nodes from components.schemas', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          schema: { $ref: '#/components/schemas/OrderPlaced' },
        },
      },
      components: {
        schemas: {
          OrderPlaced: {
            type: 'object',
            required: ['OrderId'],
            properties: {
              OrderId: { type: 'string', format: 'uuid' },
            },
          },
        },
      },
    })
    const { nodes, edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(nodes.length, 3)

    const rootNode = nodes[0]
    assert.equal(rootNode.id, 'orders.DomainEvent.OrderPlaced')
    assert.equal(rootNode.template, 'DomainEvent')
    assert.deepEqual(rootNode.properties, { schema: 'OrderPlaced' })

    const schemaNode = nodes[1]
    assert.equal(schemaNode.id, 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced')
    assert.equal(schemaNode.template, 'Schema')

    const fieldNode = nodes[2]
    assert.equal(fieldNode.id, 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced.fields.OrderId')
    assert.equal(fieldNode.template, 'Field')
    assert.deepEqual(fieldNode.properties, { type: 'uuid', nullable: false, collection: 'one' })

    const hasFieldEdge = edges.find(e => e.from === 'orders.DomainEvent.OrderPlaced.schemas.OrderPlaced' && e.to === fieldNode.id)
    assert.ok(hasFieldEdge)
    assert.equal(hasFieldEdge!.type, 'has-field')
  })

  it('marks fields nullable when not in required', () => {
    const doc = makeDoc({
      nodes: {
        'orders.Command.PlaceOrderCommand': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/PlaceOrderCommand' },
        },
      },
      components: {
        schemas: {
          PlaceOrderCommand: {
            type: 'object',
            properties: {
              OptionalNote: { type: 'string' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const field = nodes.find(n => n.id.endsWith('.fields.OptionalNote'))!
    assert.equal(field.properties.nullable, true)
  })

  it('maps scalar types correctly', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              UuidField:    { type: 'string', format: 'uuid' },
              DateTimeField: { type: 'string', format: 'date-time' },
              DateField:    { type: 'string', format: 'date' },
              StrField:     { type: 'string' },
              IntField:     { type: 'integer' },
              NumField:     { type: 'number' },
              BoolField:    { type: 'boolean' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const field = (name: string) => nodes.find(n => n.id.endsWith(`.fields.${name}`))!
    assert.equal(field('UuidField').properties.type, 'uuid')
    assert.equal(field('DateTimeField').properties.type, 'datetime')
    assert.equal(field('DateField').properties.type, 'date')
    assert.equal(field('StrField').properties.type, 'string')
    assert.equal(field('IntField').properties.type, 'integer')
    assert.equal(field('NumField').properties.type, 'decimal')
    assert.equal(field('BoolField').properties.type, 'boolean')
  })

  it('expands $ref field as sibling schema and uses schema node ID as $ref', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.MyCommand': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/MyCommand' },
        },
      },
      components: {
        schemas: {
          MyCommand: {
            type: 'object',
            properties: {
              Period: { $ref: '#/components/schemas/TaxPeriod' },
            },
          },
          TaxPeriod: {
            type: 'object',
            properties: {
              Year: { type: 'integer' },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const periodField = nodes.find(n => n.id.endsWith('.fields.Period'))!
    assert.equal(periodField.properties.$ref, 'x.Command.MyCommand.schemas.TaxPeriod')
    assert.ok(nodes.some(n => n.id === 'x.Command.MyCommand.schemas.TaxPeriod'))
    const taxYearField = nodes.find(n => n.id.endsWith('TaxPeriod.fields.Year'))!
    assert.ok(taxYearField)
    assert.equal(taxYearField.properties.type, 'integer')
  })

  it('expands array field with $ref items', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Items: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
            },
          },
          Item: {
            type: 'object',
            properties: { Id: { type: 'string', format: 'uuid' } },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const itemsField = nodes.find(n => n.id.endsWith('.fields.Items'))!
    assert.equal(itemsField.properties.collection, 'array')
    assert.equal(itemsField.properties.$ref, 'x.Command.C.schemas.Item')
  })

  it('expands array field with scalar items', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Tags: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const tagsField = nodes.find(n => n.id.endsWith('.fields.Tags'))!
    assert.equal(tagsField.properties.type, 'string')
    assert.equal(tagsField.properties.collection, 'array')
  })

  it('creates a Mapping node for additionalProperties with scalar values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Metadata: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const metaField = nodes.find(n => n.id.endsWith('.fields.Metadata'))!
    assert.equal(metaField.properties.$ref, '#/mappings/Metadata')
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.Metadata'))!
    assert.ok(mappingNode, 'Mapping node should be created')
    assert.equal(mappingNode.template, 'Mapping')
    assert.deepEqual(mappingNode.properties, { type: 'string' })
  })

  it('creates a Mapping node for additionalProperties with $ref values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              PerPerson: { type: 'object', additionalProperties: { $ref: '#/components/schemas/PersonMetric' } },
            },
          },
          PersonMetric: { type: 'object', properties: { Value: { type: 'number' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.PerPerson'))!
    assert.ok(mappingNode)
    assert.equal(mappingNode.properties.$ref, 'x.Command.C.schemas.PersonMetric')
    assert.ok(nodes.some(n => n.id === 'x.Command.C.schemas.PersonMetric'))
  })

  it('creates a Mapping node for additionalProperties with array-of-ref values', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              Groups: { type: 'object', additionalProperties: { type: 'array', items: { $ref: '#/components/schemas/Driver' } } },
            },
          },
          Driver: { type: 'object', properties: { Id: { type: 'string', format: 'uuid' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const mappingNode = nodes.find(n => n.id.endsWith('.mappings.Groups'))!
    assert.ok(mappingNode)
    assert.equal(mappingNode.properties['value-collection'], 'array')
    assert.equal(mappingNode.properties.$ref, 'x.Command.C.schemas.Driver')
  })

  it('does not expand the same sibling schema twice', () => {
    const doc = makeDoc({
      nodes: {
        'x.Command.C': {
          type: 'Command',
          schema: { $ref: '#/components/schemas/C' },
        },
      },
      components: {
        schemas: {
          C: {
            type: 'object',
            properties: {
              A: { $ref: '#/components/schemas/Shared' },
              B: { $ref: '#/components/schemas/Shared' },
            },
          },
          Shared: { type: 'object', properties: { X: { type: 'string' } } },
        },
      },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const sharedSchemaNodes = nodes.filter(n => n.id === 'x.Command.C.schemas.Shared')
    assert.equal(sharedSchemaNodes.length, 1)
  })

  it('handles node with no schema in components gracefully', () => {
    const doc = makeDoc({
      nodes: {
        'orders.DomainEvent.OrderPlaced': {
          type: 'DomainEvent',
          schema: { $ref: '#/components/schemas/Missing' },
        },
      },
      components: { schemas: {} },
    })
    const { nodes } = mapDocument(doc, SPEC_PATH)
    const schemaNode = nodes.find(n => n.id.endsWith('.schemas.Missing'))!
    assert.ok(schemaNode, 'Schema node created even when schema definition missing')
    assert.equal(schemaNode.template, 'Schema')
  })
})

describe('mapDocument — edges', () => {
  it('constructs edge ID as from__type__to', () => {
    const doc = makeDoc({
      edges: [{
        from: 'orders.DomainModel.OrderAggregate.operations.Place',
        to: 'orders.DomainEvent.OrderPlaced',
        type: 'produces',
      }],
    })
    const { edges } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].id, 'orders.DomainModel.OrderAggregate.operations.Place__produces__orders.DomainEvent.OrderPlaced')
    assert.equal(edges[0].type, 'produces')
    assert.equal(edges[0].state, 'implemented')
    assert.equal(edges[0].derivation, 'determined')
    assert.equal(edges[0].derivedBy, 'adapter:corum')
  })

  it('emits a warning and skips edges with unknown type', () => {
    const doc = makeDoc({
      edges: [{ from: 'a.B.C', to: 'd.E.F', type: 'unknown-type' }],
    })
    const { edges, diagnostics } = mapDocument(doc, SPEC_PATH)
    assert.equal(edges.length, 0)
    assert.ok(diagnostics.some(d => d.severity === 'warning' && d.message.includes('unknown-type')))
  })
})

describe('mapDocument — gaps', () => {
  it('emits each gap as a warning diagnostic', () => {
    const doc = makeDoc({
      gaps: [
        { kind: 'unresolved-field-type', nodeId: 'orders.X.fields.Y', reason: 'MissingType' },
        { kind: 'duplicate-domain-type', reason: 'name collision' },
      ],
    })
    const { diagnostics } = mapDocument(doc, SPEC_PATH)
    const warnings = diagnostics.filter(d => d.severity === 'warning')
    assert.equal(warnings.length, 2)
    assert.ok(warnings[0].message.includes('unresolved-field-type'))
    assert.ok(warnings[1].message.includes('duplicate-domain-type'))
  })
})
```

- [ ] **Step 3: Build and run mapper tests**

```
npm run build && node --test dist/test/adapters/corum/mapper.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/adapters/corum/mapper.ts test/adapters/corum/mapper.test.ts
git commit -m "feat: update corum interchange mapper to v2 format with JSON Schema expansion"
```

---

## Task 3: Update fixtures and golden files, run integration test

**Files:**
- Modify: `test/fixtures/corum/specs/basic.corum.yaml`
- Modify: `test/fixtures/corum/expected/basic/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml`
- Modify: `test/fixtures/corum/expected/basic/components/orders/DomainModels/OrderAggregate.yaml`
- Test: `test/import/corum-runner.test.ts` (no changes needed — already tests the fixture round-trip)

**What the integration test checks (`test/import/corum-runner.test.ts`):**

The test:
1. Copies the `fixtures/sample-graph` fixture to a temp dir
2. Runs `runImport` with `adapter: corum` pointing at `basic.corum.yaml`
3. Asserts no error diagnostics, one gap warning, specific cluster files exist
4. Compares cluster file content against golden files (normalising `lastModifiedAt` and `extractedFrom`)

The golden files need to match what the updated mapper produces. The `derivedBy` value changes from `adapter:corum/treesitter` to `extractor:treesitter` (the new format passes derivedBy through directly).

- [ ] **Step 1: Rewrite the basic fixture**

Write `test/fixtures/corum/specs/basic.corum.yaml`:

```yaml
corum: '1.0'
info:
  source:
    analyser: corum-extract
    language: csharp
nodes:
  orders.DomainEvent.OrderPlacedDomainEvent:
    type: DomainEvent
    title: OrderPlacedDomainEvent
    schema:
      $ref: '#/components/schemas/OrderPlacedDomainEvent'
    provenance:
      derivation: determined
      derivedBy: extractor:treesitter
      extractedFrom: ../test-repo
  orders.DomainModel.OrderAggregate:
    type: DomainModel
    title: OrderAggregate
    provenance:
      derivation: determined
      derivedBy: extractor:treesitter
      extractedFrom: ../test-repo
  orders.DomainModel.OrderAggregate.operations.Place:
    type: DomainOperation
    title: Place
    provenance:
      derivation: inferred
      derivedBy: extractor:treesitter
      extractedFrom: ../test-repo
components:
  schemas:
    OrderPlacedDomainEvent:
      type: object
      required:
        - OrderId
      properties:
        OrderId:
          type: string
          format: uuid
edges:
  - type: produces
    from: orders.DomainModel.OrderAggregate.operations.Place
    to: orders.DomainEvent.OrderPlacedDomainEvent
gaps:
  - kind: unresolved-field-type
    nodeId: orders.SomeNode.fields.SomeField
    reason: MissingType
```

- [ ] **Step 2: Update the DomainEvent golden file**

Write `test/fixtures/corum/expected/basic/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml`:

```yaml
id: orders.DomainEvent.OrderPlacedDomainEvent
template: DomainEvent
schemaVersion: '1'
metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: 2026-06-29
  extractedFrom: C:\git\atolis-hq\corum\test\fixtures\corum\specs\basic.corum.yaml
  derivation: determined
  derivedBy: extractor:treesitter
properties:
  schema: OrderPlacedDomainEvent
schemas:
  OrderPlacedDomainEvent:
    fields:
      OrderId:
        nullable: false
        collection: one
        type: uuid
```

- [ ] **Step 3: Update the DomainModel golden file**

Write `test/fixtures/corum/expected/basic/components/orders/DomainModels/OrderAggregate.yaml`:

```yaml
id: orders.DomainModel.OrderAggregate
template: DomainModel
schemaVersion: '1'
metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: 2026-06-29
  extractedFrom: C:\git\atolis-hq\corum\test\fixtures\corum\specs\basic.corum.yaml
  derivation: determined
  derivedBy: extractor:treesitter
properties:
  description: OrderAggregate
operations:
  Place:
    description: Place
```

- [ ] **Step 4: Run the integration test**

```
npm run build && node --test dist/test/import/corum-runner.test.js
```

Expected: test passes with no errors.

> **If the test fails because the actual cluster file content differs from the golden file:** run the import against the temp dir, print the actual cluster files, and update the golden files to match. The normalisation strips `lastModifiedAt` and `extractedFrom`, so only structural differences matter.

- [ ] **Step 5: Run the full test suite**

```
npm test
```

Expected: all tests pass (45 nodes, 38 edges from loader fixtures still intact).

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/corum/specs/basic.corum.yaml test/fixtures/corum/expected/basic/components/orders/DomainEvents/OrderPlacedDomainEvent.yaml test/fixtures/corum/expected/basic/components/orders/DomainModels/OrderAggregate.yaml
git commit -m "test: update corum fixture and golden files to v2 interchange format"
```

---

## Task 4: Update interchange schema and copy sample file

**Files:**
- Modify: `.corum/packs/extract/interchange.schema.yaml`
- Replace: `tmp/samples/prl/prl-core.corum.yaml` (already done — file updated before plan execution)

- [ ] **Step 1: Rewrite the interchange schema**

Write `.corum/packs/extract/interchange.schema.yaml`:

```yaml
$schema: 'https://json-schema.org/draft/2020-12/schema'
$id: 'corum/interchange'
title: Corum Interchange Format
description: |
  Output format produced by corum-extract tools (e.g. Roslyn-based extractors).
  Defines the envelope structure only — node properties are template-specific
  and are validated by the graph loader after import, not here.

  Extractors SHOULD validate their output against this schema before shipping.
  The corum adapter validates the envelope at runtime using TypeScript type guards;
  this schema is the shared tooling contract.

type: object
required:
  - corum
  - nodes

properties:

  corum:
    type: string
    description: Interchange format version. Currently "1.0".
    example: '1.0'

  info:
    type: object
    description: Metadata about the source and pack requirements.
    properties:
      title:
        type: string
        description: Human-readable name for this interchange file.
      version:
        type: string
        description: Version of the service or module being described.
      source:
        type: object
        description: Metadata about the extraction tool that produced this file.
        properties:
          analyser:
            type: string
            description: Name of the extraction tool (e.g. corum-extract).
          language:
            type: string
            description: Source language analysed (e.g. csharp, typescript).
      packs:
        type: array
        description: Template packs this file's nodes require to be meaningful.
        items:
          type: object
          required: [name, version]
          properties:
            name:
              type: string
              description: Pack name (e.g. core, domain, messaging).
            version:
              type: string
              description: Semver range (e.g. ^1.0.0).

  nodes:
    type: object
    description: |
      Map of node ID → node entry. Key is the fully-qualified corum node ID.
      Root nodes: {component}.{Template}.{name}
      Child nodes (e.g. DomainOperation): {root-id}.{section}.{child-name}
      Schema and Field nodes are NOT present here — they are derived from
      components.schemas at import time.
    additionalProperties:
      type: object
      required: [type]
      properties:
        type:
          type: string
          description: |
            Corum template name (e.g. Command, DomainModel, APIEndpoint,
            DomainOperation, DomainEvent, IntegrationEvent).
        title:
          type: string
          description: Human-readable name or display title for this node.
        schema:
          type: object
          description: Reference to the node's primary schema in components.schemas.
          required: [$ref]
          properties:
            $ref:
              type: string
              description: JSON Pointer to a schema in components.schemas (e.g. '#/components/schemas/MySchema').
        provenance:
          $ref: '#/$defs/provenance'

  components:
    type: object
    description: Shared schema definitions.
    properties:
      schemas:
        type: object
        description: |
          JSON Schema objects keyed by schema name. Referenced by node entries
          via schema.$ref. The importer expands each schema into Schema and
          Field nodes under the referencing root node.
        additionalProperties:
          type: object

  edges:
    type: array
    description: |
      Explicit non-structural edges between nodes.
    items:
      type: object
      required: [type, from, to]
      properties:
        type:
          type: string
          enum:
            - triggers
            - produces
            - reads
            - calls
            - implements
            - maps-to
            - derived-from
            - renamed-from
          description: Edge type.
        from:
          type: string
          description: Source node ID.
        to:
          type: string
          description: Target node ID.
        provenance:
          $ref: '#/$defs/provenance'

  gaps:
    type: array
    description: |
      Diagnostics from the extraction tool — things it could not resolve.
    items:
      type: object
      required: [kind]
      properties:
        kind:
          type: string
          description: |
            Gap category. Common values:
              unresolved-field-type  — field type reference could not be resolved
              duplicate-domain-type  — same-name type collision; first-wins applied
        nodeId:
          type: string
          description: ID of the affected node (if applicable).
        reason:
          type: string
          description: Human-readable explanation of the gap.
        file:
          type: string
          description: Source file path associated with this gap (if applicable).

$defs:
  provenance:
    type: object
    description: How this node or edge was established by the extraction tool.
    properties:
      derivation:
        type: string
        enum: [determined, inferred]
        description: |
          determined — authoritative extraction (static analysis confirmed it).
          inferred — heuristic or probabilistic (name pattern, call graph, LLM).
      derivedBy:
        type: string
        description: Qualified identifier for the extraction tool/method (e.g. extractor:roslyn).
      extractedFrom:
        type: string
        description: Path to the source file this node was extracted from.
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

```
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add .corum/packs/extract/interchange.schema.yaml tmp/samples/prl/prl-core.corum.yaml
git commit -m "docs: update interchange schema to v2 format; update sample file"
```

---

## Self-Review

**Spec coverage:**
- ✅ Top-level key `corum` instead of `corumInterchange` — Task 1
- ✅ `nodes` as object/map — Task 1 + 2
- ✅ `components.schemas` → Schema + Field nodes expanded — Task 2
- ✅ Scalar type mapping (uuid, datetime, date, integer, decimal, boolean) — Task 2
- ✅ `$ref` field in schema → sibling schema expansion — Task 2
- ✅ Array field with `$ref` items — Task 2
- ✅ Array field with scalar items — Task 2
- ✅ `additionalProperties` → Mapping node (scalar values) — Task 2
- ✅ `additionalProperties` → Mapping node ($ref values) — Task 2
- ✅ `additionalProperties` → Mapping node (array-of-ref values) — Task 2
- ✅ Map-of-map (`additionalProperties: { type: object, additionalProperties: ... }`) → nested Mapping — Task 2
- ✅ `title` → `properties.description` when no schema — Task 2
- ✅ `schema.$ref` → `properties.schema = name` — Task 2
- ✅ Provenance `derivedBy` passed through — Task 2
- ✅ Provenance `derivation: determined` → `determined` — Task 2
- ✅ Edge without provenance defaults correctly — Task 2
- ✅ Fixture updated to new format — Task 3
- ✅ Golden files updated — Task 3
- ✅ Interchange JSON Schema envelope updated — Task 4
- ✅ Sample file copied — Task 4
- ✅ `info.packs` replaces `targets` in schema — Task 4

**Placeholder scan:** None found.

**Type consistency:**
- `CorumInterchangeDocument.nodes` is `Record<string, CorumInterchangeNodeEntry>` throughout.
- `CorumInterchangeNodeEntry.type` used as `Node.template` in mapper.
- `mapDocument` signature unchanged.
- `schemaRefName` used consistently in mapper (not exported — internal helper).
