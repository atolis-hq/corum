# OpenAPI Importer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first end-to-end import pipeline — parse an OpenAPI spec, produce Corum nodes and edges, reconcile against the existing graph, and write updated cluster YAML files, invocable via a `corum import openapi` CLI command.

**Architecture:** An in-process `SpecAdapter` reads pack adapter config from the active pack to map OpenAPI constructs to template-typed nodes, then a per-component reconcile step diffs the result against the existing graph and writes updated cluster YAML. CLI flags and a config file both normalise to the same `ImportConfig` type before reaching the runner.

**Tech Stack:** Node.js test runner (`node:test`), TypeScript ESM, `@apidevtools/swagger-parser` (bundle + validate), `openapi-types` (OpenAPI 3.x TypeScript types), `commander` (CLI), `yaml` (already in deps).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/schema/index.ts` | Modify | Add `derivation`, `derivedBy` to `Node` and `Edge` |
| `src/writer/graph-writer.ts` | Modify | Derive cluster path from node ID; write metadata fields |
| `src/loader/cluster-loader.ts` | Modify | Read `extractedFrom`/`derivation`/`derivedBy` from `metadata` block |
| `test/writer.test.ts` | Modify | Update tests for new path-derivation behaviour |
| `.corum/packs/rest/adapters/openapi.yaml` | Create | Pack adapter config (template/section/scalar mappings) |
| `src/adapters/index.ts` | Create | `SpecAdapter` interface, `AdapterContext`, `AdapterResult`, `AdapterPackConfig`, registry |
| `src/import/config.ts` | Create | `ImportConfig`/`ImportEntry` types, YAML loader, CLI normalisation helper |
| `src/adapters/openapi/parser.ts` | Create | `swagger-parser` `bundle()` wrapper |
| `src/adapters/openapi/mapper.ts` | Create | Component mapping, type mapping, `$ref` detection, node/edge generation |
| `src/adapters/openapi/index.ts` | Create | `OpenAPIAdapter` class wiring parser → mapper → `AdapterResult` |
| `src/reconcile/index.ts` | Create | Per-component diff: new/changed/unchanged/orphan → write cluster YAML |
| `src/import/runner.ts` | Create | Orchestrator: config → pack config → adapter → reconcile |
| `src/bin/corum.ts` | Create | `commander` CLI entry point |
| `test/adapters/openapi/mapper.test.ts` | Create | Unit tests: component mapping, type mapping, ID derivation, $ref detection |
| `test/import/config.test.ts` | Create | Unit tests: YAML loader, CLI normalisation |
| `test/reconcile/index.test.ts` | Create | Unit tests: diff logic (new, changed, unchanged, orphan) |
| `test/import/runner.test.ts` | Create | Golden file tests: full pipeline against fixture specs |
| `test/fixtures/openapi/specs/` | Create | Fixture OpenAPI specs (YAML + JSON) |
| `test/fixtures/openapi/expected/` | Create | Expected cluster YAML output (golden files) |

---

## Task 1: Add `derivation` and `derivedBy` to schema types

**Files:**
- Modify: `src/schema/index.ts`

- [ ] **Add fields to Node and Edge**

In `src/schema/index.ts`, add to the `Node` interface after `extractedFrom`:

```typescript
export interface Node {
  id: string
  template: string
  component: string
  state: State
  stability: Stability
  schemaVersion: string
  lastModifiedAt: string
  extractedFrom?: string
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
  properties: Record<string, unknown>
}
```

Add to the `Edge` interface after `notes`:

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

- [ ] **Build and verify no type errors**

```
npm run build
```
Expected: clean build, no errors.

- [ ] **Commit**

```bash
git add src/schema/index.ts
git commit -m "feat: add derivation and derivedBy to Node and Edge types"
```

---

## Task 2: Install new dependencies

**Files:**
- Modify: `package.json`

- [ ] **Install runtime dependencies**

```bash
npm install @apidevtools/swagger-parser openapi-types commander
npm install --save-dev @types/swagger-parser
```

- [ ] **Verify build still passes**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add swagger-parser, openapi-types, commander"
```

---

## Task 3: Fix writer — derive cluster path from node ID

The writer currently uses `Node.extractedFrom` as the cluster output file path. `extractedFrom` must be freed to carry the source spec path. The cluster path is now derived from the node ID.

**Files:**
- Modify: `src/writer/graph-writer.ts`

- [ ] **Add `clusterPath` helper and update `serializeGraph`**

Replace the `serializeGraph` function and add `clusterPath`:

```typescript
export function serializeGraph(graph: Graph, options: SerializeGraphOptions = {}): ContentMap {
  const map: ContentMap = new Map()
  map.set('graph.yaml', buildGraphYaml(graph, options))

  for (const root of getRootNodes(graph)) {
    map.set(clusterPath(root), stringifyGraphYaml(toClusterDocument(graph, root)))
  }

  const explicitEdges = getAllEdges(graph)
    .filter(edge => !STRUCTURAL_EDGE_TYPES.has(edge.type))
    .sort((a, b) => a.id.localeCompare(b.id))

  if (explicitEdges.length > 0) {
    map.set('edges/corum.edges.yaml', stringifyGraphYaml({ edges: explicitEdges.map(toEdgeDocument) }))
  }

  return map
}

function clusterPath(node: Node): string {
  const [component, template, name] = node.id.split('.')
  return `components/${component}/${template}s/${name}.yaml`
}
```

- [ ] **Update `toClusterDocument` to write metadata fields**

Replace the `toClusterDocument` function:

```typescript
function toClusterDocument(graph: Graph, root: Node): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    component: root.component,
    state: root.state,
    stability: root.stability,
    lastModifiedAt: root.lastModifiedAt,
  }
  if (root.extractedFrom !== undefined) metadata.extractedFrom = root.extractedFrom
  if (root.derivation !== undefined) metadata.derivation = root.derivation
  if (root.derivedBy !== undefined) metadata.derivedBy = root.derivedBy

  const doc: Record<string, unknown> = {
    id: root.id,
    template: root.template,
    schemaVersion: root.schemaVersion,
    metadata,
  }

  if (Object.keys(root.properties).length > 0) {
    doc.properties = root.properties
  }

  appendOwnedSections(graph, root, doc)
  return doc
}
```

- [ ] **Remove `normalizeExtractedFrom` — no longer needed for cluster paths**

Delete the `normalizeExtractedFrom` function and its call sites. The function was only used by `serializeGraph` to convert the old `extractedFrom`-as-path pattern.

- [ ] **Build**

```bash
npm run build
```
Expected: clean build (some writer tests will fail — fixed in Task 5).

---

## Task 4: Fix loader — read `extractedFrom` from metadata

**Files:**
- Modify: `src/loader/cluster-loader.ts`

- [ ] **Read metadata fields instead of auto-setting extractedFrom**

In the root node construction block (around line 52), replace:

```typescript
const root: Node = {
  id: record.id,
  template: record.template,
  component: meta.component,
  state: asState(meta.state, 'proposed'),
  stability: asStability(meta.stability, 'unstable'),
  schemaVersion: record.schemaVersion,
  lastModifiedAt: meta.lastModifiedAt,
  extractedFrom: key,
  properties: isRecord(record.properties) ? record.properties : {},
}
```

with:

```typescript
const root: Node = {
  id: record.id,
  template: record.template,
  component: meta.component,
  state: asState(meta.state, 'proposed'),
  stability: asStability(meta.stability, 'unstable'),
  schemaVersion: record.schemaVersion,
  lastModifiedAt: meta.lastModifiedAt,
  ...(typeof meta.extractedFrom === 'string' && { extractedFrom: meta.extractedFrom }),
  ...(typeof meta.derivation === 'string' && { derivation: meta.derivation as Node['derivation'] }),
  ...(typeof meta.derivedBy === 'string' && { derivedBy: meta.derivedBy }),
  properties: isRecord(record.properties) ? record.properties : {},
}
```

- [ ] **Remove `extractedFrom` from child node construction** (around line 101)

```typescript
const child: Node = {
  id: childId,
  template: childTemplateName,
  component: parent.component,
  state: asState(value.state, parent.state),
  stability: asStability(value.stability, parent.stability),
  schemaVersion: parent.schemaVersion,
  lastModifiedAt: parent.lastModifiedAt,
  properties: stripOwnedSections(value, childTemplateName, templates),
}
```

Child nodes inherit provenance from their parent via the cluster file structure — they do not need their own `extractedFrom`.

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

---

## Task 5: Update writer tests for new behaviour

**Files:**
- Modify: `test/writer.test.ts`

- [ ] **Update round-trip test node count**

The round-trip test currently asserts `reloaded.nodesById.size === 151`. After the loader change (child nodes no longer get `extractedFrom` set), the node count may differ if any test logic depended on that field. Run tests to find the current count:

```bash
npm test
```

Update `test/writer.test.ts` line 35 to match the actual count reported.

- [ ] **Replace the `extractedFrom` normalization test**

The test "relativizes legacy absolute extractedFrom paths" tests the old `normalizeExtractedFrom` path-as-extractedFrom pattern. Replace it with a test for the new metadata round-trip:

```typescript
it('writes extractedFrom into metadata block and reloads it', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-metadata-'))
  try {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    const root = graph.nodesById.get('orders.DomainModel.order')
    assert.ok(root)
    root.extractedFrom = './specs/orders-api.yaml'
    root.derivation = 'determined'
    root.derivedBy = 'adapter:openapi'

    await saveGraph(graph, { sourceGraphPath: fixtureGraphDir, outputGraphPath: tmpDir })
    const reloaded = await loadGraph({ graphPath: tmpDir })
    const reloadedRoot = reloaded.nodesById.get('orders.DomainModel.order')
    assert.ok(reloadedRoot)
    assert.equal(reloadedRoot.extractedFrom, './specs/orders-api.yaml')
    assert.equal(reloadedRoot.derivation, 'determined')
    assert.equal(reloadedRoot.derivedBy, 'adapter:openapi')
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})
```

- [ ] **Run tests and verify all pass**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Commit**

```bash
git add src/writer/graph-writer.ts src/loader/cluster-loader.ts test/writer.test.ts
git commit -m "fix: derive cluster path from node ID; move extractedFrom into metadata"
```

---

## Task 6: Create pack adapter config for `rest` pack

**Files:**
- Create: `.corum/packs/rest/adapters/openapi.yaml`

- [ ] **Write the adapter config**

```yaml
adapter: openapi
version: "1.0"

constructs:
  operation:
    template: APIEndpoint
    properties:
      summary: description

  requestSchema:
    template: Schema
    section: schemas

  responseSchema:
    template: Schema
    section: schemas

  schemaProperty:
    template: Field
    section: fields

  enumDefinition:
    template: EnumDefinition
    section: enums

  enumValue:
    template: EnumValue
    section: values

scalarTypes:
  string:            string
  string/uuid:       uuid
  string/date:       date
  string/date-time:  datetime
  integer:           integer
  number:            decimal
  boolean:           boolean
```

- [ ] **Commit**

```bash
git add .corum/packs/rest/adapters/openapi.yaml
git commit -m "feat: add OpenAPI adapter config to rest pack"
```

---

## Task 7: SpecAdapter interface and ImportConfig types

**Files:**
- Create: `src/adapters/index.ts`
- Create: `src/import/config.ts`

- [ ] **Write `src/adapters/index.ts`**

```typescript
import type { Diagnostic, Edge, Node, Template } from '../schema/index.js'
import type { ImportEntry } from '../import/config.js'

export interface AdapterPackConfig {
  adapter: string
  version: string
  constructs: Record<string, ConstructMapping>
  scalarTypes: Record<string, string>
}

export interface ConstructMapping {
  template: string
  section?: string
  properties?: Record<string, string>
}

export interface AdapterContext {
  packConfig: AdapterPackConfig
  templates: Map<string, Template>
}

export interface AdapterResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export interface SpecAdapter<TEntry extends ImportEntry = ImportEntry> {
  readonly adapterId: TEntry['adapter']
  import(entry: TEntry, context: AdapterContext): Promise<AdapterResult>
}

const registry = new Map<string, SpecAdapter>()

export function registerAdapter(adapter: SpecAdapter): void {
  registry.set(adapter.adapterId, adapter)
}

export function getAdapter(adapterId: string): SpecAdapter {
  const adapter = registry.get(adapterId)
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`)
  return adapter
}
```

- [ ] **Write `src/import/config.ts`**

```typescript
import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

export type ComponentMapping =
  | { strategy: 'uri-segment'; segment: number }
  | { strategy: 'uri-segment'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; component: string }

export interface OpenAPIImportEntry {
  adapter: 'openapi'
  spec: string
  componentMapping: ComponentMapping
}

export interface AsyncAPIImportEntry {
  adapter: 'asyncapi'
  spec: string
  componentMapping:
    | { strategy: 'channel' }
    | { strategy: 'hardcoded'; component: string }
}

export type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry

export interface ImportConfig {
  imports: ImportEntry[]
}

export function loadImportConfig(filePath: string): ImportConfig {
  let raw: unknown
  try {
    raw = parseYaml(readFileSync(filePath, 'utf-8'))
  } catch (err) {
    throw new Error(`Failed to parse import config: ${err}`)
  }
  if (!isImportConfig(raw)) {
    throw new Error(`Invalid import config: must have an "imports" array`)
  }
  return raw
}

function isImportConfig(value: unknown): value is ImportConfig {
  return (
    typeof value === 'object' &&
    value !== null &&
    'imports' in value &&
    Array.isArray((value as Record<string, unknown>).imports)
  )
}

export function buildOpenAPIConfig(
  spec: string,
  strategy: string,
  segment?: number,
  pattern?: string,
  component?: string,
): OpenAPIImportEntry {
  let componentMapping: ComponentMapping
  if (strategy === 'hardcoded') {
    if (!component) throw new Error('--component required for hardcoded strategy')
    componentMapping = { strategy: 'hardcoded', component }
  } else if (strategy === 'tag') {
    componentMapping = { strategy: 'tag' }
  } else if (pattern) {
    componentMapping = { strategy: 'uri-segment', pattern }
  } else {
    componentMapping = { strategy: 'uri-segment', segment: segment ?? 0 }
  }
  return { adapter: 'openapi', spec, componentMapping }
}
```

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/adapters/index.ts src/import/config.ts
git commit -m "feat: add SpecAdapter interface and ImportConfig types"
```

---

## Task 8: Unit tests for ImportConfig

**Files:**
- Create: `test/import/config.test.ts`

- [ ] **Write tests**

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig } from '../../src/import/config.js'

describe('loadImportConfig', () => {
  it('parses a valid config file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'imports.yaml')
    fs.writeFileSync(filePath, `
imports:
  - adapter: openapi
    spec: ./orders.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0
`)
    const config = loadImportConfig(filePath)
    assert.equal(config.imports.length, 1)
    assert.equal(config.imports[0].adapter, 'openapi')
    assert.equal(config.imports[0].spec, './orders.yaml')
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws on invalid YAML', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'bad.yaml')
    fs.writeFileSync(filePath, `{ bad yaml: [`)
    assert.throws(() => loadImportConfig(filePath), /Failed to parse/)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('throws when imports array is missing', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-config-'))
    const filePath = path.join(tmpDir, 'bad.yaml')
    fs.writeFileSync(filePath, `name: foo`)
    assert.throws(() => loadImportConfig(filePath), /Invalid import config/)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe('buildOpenAPIConfig', () => {
  it('builds uri-segment config with segment index', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'uri-segment', 0)
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'uri-segment', segment: 0 },
    })
  })

  it('builds uri-segment config with regex pattern', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'uri-segment', undefined, '^/([^/]+)/')
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'uri-segment', pattern: '^/([^/]+)/' },
    })
  })

  it('builds hardcoded config', () => {
    const entry = buildOpenAPIConfig('./spec.yaml', 'hardcoded', undefined, undefined, 'legacy')
    assert.deepEqual(entry, {
      adapter: 'openapi',
      spec: './spec.yaml',
      componentMapping: { strategy: 'hardcoded', component: 'legacy' },
    })
  })

  it('throws when hardcoded strategy missing component', () => {
    assert.throws(() => buildOpenAPIConfig('./spec.yaml', 'hardcoded'), /--component required/)
  })
})
```

- [ ] **Run tests**

```bash
npm test
```
Expected: new tests pass, all existing tests pass.

- [ ] **Commit**

```bash
git add test/import/config.test.ts
git commit -m "test: ImportConfig loader and CLI normalisation helpers"
```

---

## Task 9: OpenAPI parser wrapper

**Files:**
- Create: `src/adapters/openapi/parser.ts`

- [ ] **Write parser**

```typescript
import SwaggerParser from '@apidevtools/swagger-parser'
import type { OpenAPIV3 } from 'openapi-types'
import type { Diagnostic } from '../../schema/index.js'

export interface ParseResult {
  document: OpenAPIV3.Document | null
  diagnostics: Diagnostic[]
}

export async function parseSpec(specPath: string): Promise<ParseResult> {
  const diagnostics: Diagnostic[] = []
  try {
    const document = await SwaggerParser.bundle(specPath) as OpenAPIV3.Document
    return { document, diagnostics }
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to parse OpenAPI spec: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }
}
```

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/adapters/openapi/parser.ts
git commit -m "feat: OpenAPI parser wrapper using swagger-parser bundle()"
```

---

## Task 10: Unit tests for component mapping strategies

**Files:**
- Create: `test/adapters/openapi/mapper.test.ts`
- Create: `src/adapters/openapi/mapper.ts` (component mapping section only)

- [ ] **Write the failing tests first**

Create `test/adapters/openapi/mapper.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { deriveComponent, deriveScalarType, isRefSchema, deriveNodeId } from '../../../src/adapters/openapi/mapper.js'

describe('deriveComponent', () => {
  it('extracts component from URI by segment index', () => {
    assert.equal(deriveComponent('/orders/v1/create', { strategy: 'uri-segment', segment: 0 }), 'orders')
    assert.equal(deriveComponent('/payments/v1/capture', { strategy: 'uri-segment', segment: 0 }), 'payments')
    assert.equal(deriveComponent('/api/orders/create', { strategy: 'uri-segment', segment: 1 }), 'orders')
  })

  it('extracts component from URI using regex pattern', () => {
    assert.equal(
      deriveComponent('/orders/v1/create', { strategy: 'uri-segment', pattern: '^/([^/]+)/' }),
      'orders'
    )
  })

  it('returns hardcoded component', () => {
    assert.equal(
      deriveComponent('/anything', { strategy: 'hardcoded', component: 'legacy' }),
      'legacy'
    )
  })

  it('returns undefined when segment out of range', () => {
    assert.equal(deriveComponent('/orders', { strategy: 'uri-segment', segment: 5 }), undefined)
  })

  it('returns undefined when regex has no capture group match', () => {
    assert.equal(
      deriveComponent('/orders', { strategy: 'uri-segment', pattern: '^/nomatch/([^/]+)' }),
      undefined
    )
  })
})

describe('deriveScalarType', () => {
  it('maps basic types', () => {
    const scalarTypes = { string: 'string', integer: 'integer', boolean: 'boolean', 'string/uuid': 'uuid', 'string/date-time': 'datetime' }
    assert.equal(deriveScalarType('string', undefined, scalarTypes), 'string')
    assert.equal(deriveScalarType('integer', undefined, scalarTypes), 'integer')
    assert.equal(deriveScalarType('string', 'uuid', scalarTypes), 'uuid')
    assert.equal(deriveScalarType('string', 'date-time', scalarTypes), 'datetime')
  })

  it('returns undefined for unknown types', () => {
    assert.equal(deriveScalarType('object', undefined, {}), undefined)
  })
})

describe('isRefSchema', () => {
  it('detects $ref schemas', () => {
    assert.equal(isRefSchema({ $ref: '#/components/schemas/Order' }), true)
    assert.equal(isRefSchema({ type: 'string' }), false)
    assert.equal(isRefSchema({}), false)
  })
})

describe('deriveNodeId', () => {
  it('builds APIEndpoint ID from component and operationId', () => {
    assert.equal(deriveNodeId('operation', 'orders', 'createOrder'), 'orders.APIEndpoint.createOrder')
  })

  it('builds Schema ID from parent ID and schema name', () => {
    assert.equal(
      deriveNodeId('schema', undefined, 'create-order-request', 'orders.APIEndpoint.createOrder', 'schemas'),
      'orders.APIEndpoint.createOrder.schemas.create-order-request'
    )
  })

  it('builds Field ID from parent ID and field name', () => {
    assert.equal(
      deriveNodeId('field', undefined, 'customerId', 'orders.APIEndpoint.createOrder.schemas.create-order-request', 'fields'),
      'orders.APIEndpoint.createOrder.schemas.create-order-request.fields.customerId'
    )
  })
})
```

- [ ] **Run tests to verify they fail**

```bash
npm test
```
Expected: FAIL — `mapper.js` not found.

- [ ] **Write `src/adapters/openapi/mapper.ts` with the exported helpers**

```typescript
import type { OpenAPIV3 } from 'openapi-types'
import type { ComponentMapping } from '../../import/config.js'

export function deriveComponent(path: string, mapping: ComponentMapping): string | undefined {
  if (mapping.strategy === 'hardcoded') return mapping.component
  if (mapping.strategy === 'tag') return undefined // resolved per-operation
  const segments = path.split('/').filter(Boolean)
  if ('pattern' in mapping) {
    const match = path.match(mapping.pattern)
    return match?.[1]
  }
  return segments[mapping.segment]
}

export function deriveScalarType(
  type: string,
  format: string | undefined,
  scalarTypes: Record<string, string>,
): string | undefined {
  if (format && scalarTypes[`${type}/${format}`]) return scalarTypes[`${type}/${format}`]
  return scalarTypes[type]
}

export function isRefSchema(schema: unknown): schema is OpenAPIV3.ReferenceObject {
  return typeof schema === 'object' && schema !== null && '$ref' in schema
}

export function deriveNodeId(
  kind: 'operation' | 'schema' | 'field' | 'enum' | 'enumValue',
  component: string | undefined,
  name: string,
  parentId?: string,
  section?: string,
): string {
  if (kind === 'operation') return `${component}.APIEndpoint.${name}`
  return `${parentId}.${section}.${name}`
}

export function refName(ref: string): string {
  return ref.split('/').pop() ?? ref
}
```

- [ ] **Run tests**

```bash
npm test
```
Expected: all mapper unit tests pass.

- [ ] **Commit**

```bash
git add src/adapters/openapi/mapper.ts test/adapters/openapi/mapper.test.ts
git commit -m "feat: component mapping, type mapping, $ref detection, ID derivation helpers"
```

---

## Task 11: OpenAPI mapper — operations, schemas, and fields

**Files:**
- Modify: `src/adapters/openapi/mapper.ts`

- [ ] **Add the full mapping function**

Append to `src/adapters/openapi/mapper.ts`:

```typescript
import type { Node, Edge, Diagnostic } from '../../schema/index.js'
import type { AdapterPackConfig } from '../index.js'
import type { OpenAPIImportEntry } from '../../import/config.js'

const TODAY = new Date().toISOString().split('T')[0]

export interface MapResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export function mapDocument(
  document: OpenAPIV3.Document,
  entry: OpenAPIImportEntry,
  packConfig: AdapterPackConfig,
): MapResult {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const diagnostics: Diagnostic[] = []
  const sharedSchemas = new Map<string, string>() // ref name → node ID

  // Emit shared component schemas first so endpoints can reference them
  if (document.components?.schemas) {
    for (const [name, schema] of Object.entries(document.components.schemas)) {
      if (isRefSchema(schema)) continue
      const component = deriveComponentForSchema(name, document, entry)
      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for schema ${name}, skipping` })
        continue
      }
      const schemaId = `${component}.Schema.${name}`
      sharedSchemas.set(name, schemaId)
      const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, entry.spec, schemaId)
      nodes.push(node)
      emitFields(schema as OpenAPIV3.SchemaObject, schemaId, 'fields', packConfig, entry.spec, nodes, edges, diagnostics)
    }
  }

  // Emit operations
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue

      const operationId = operation.operationId ?? `${method}-${path.replace(/\//g, '-').replace(/^-/, '')}`
      const component = entry.componentMapping.strategy === 'tag'
        ? operation.tags?.[0]
        : deriveComponent(path, entry.componentMapping)

      if (!component) {
        diagnostics.push({ severity: 'warning', file: entry.spec, message: `Cannot derive component for ${method.toUpperCase()} ${path}, skipping` })
        continue
      }

      const endpointId = deriveNodeId('operation', component, operationId)
      const endpointNode = makeNode(packConfig.constructs.operation.template, component, entry.spec, endpointId)
      endpointNode.properties = {
        method: method.toUpperCase(),
        path,
        ...(operation.operationId && { operationId: operation.operationId }),
        ...(operation.summary && { description: operation.summary }),
      }
      nodes.push(endpointNode)

      // Request body
      const requestBody = operation.requestBody as OpenAPIV3.RequestBodyObject | undefined
      if (requestBody?.content) {
        const jsonContent = requestBody.content['application/json']
        if (jsonContent?.schema) {
          emitSchemaNode(jsonContent.schema, `${operationId}-request`, endpointId, 'schemas', packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas)
        }
      }

      // Responses
      for (const [status, response] of Object.entries(operation.responses ?? {})) {
        const responseObj = response as OpenAPIV3.ResponseObject
        const jsonContent = responseObj.content?.['application/json']
        if (jsonContent?.schema) {
          emitSchemaNode(jsonContent.schema, `${operationId}-response-${status}`, endpointId, 'schemas', packConfig, entry.spec, nodes, edges, diagnostics, sharedSchemas)
        }
      }
    }
  }

  return { nodes, edges, diagnostics }
}

function makeNode(template: string, component: string, specPath: string, id: string): Node {
  return {
    id,
    template,
    component,
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: TODAY,
    extractedFrom: specPath,
    derivation: 'determined',
    derivedBy: 'adapter:openapi',
    properties: {},
  }
}

function emitSchemaNode(
  schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  name: string,
  parentId: string,
  section: string,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
  sharedSchemas: Map<string, string>,
): void {
  if (isRefSchema(schema)) {
    const refId = sharedSchemas.get(refName(schema.$ref))
    if (refId) {
      // Record reference in parent properties rather than emitting a duplicate node
      const parent = nodes.find(n => n.id === parentId)
      if (parent) parent.properties[`${section}.${name}`] = refId
    }
    return
  }
  const schemaId = deriveNodeId('schema', undefined, name, parentId, section)
  const [component] = parentId.split('.')
  const node = makeNode(packConfig.constructs.requestSchema?.template ?? 'Schema', component, specPath, schemaId)
  nodes.push(node)
  edges.push({ id: `${parentId}__has-field__${schemaId}`, from: parentId, to: schemaId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  emitFields(schema as OpenAPIV3.SchemaObject, schemaId, 'fields', packConfig, specPath, nodes, edges, diagnostics)
}

function emitFields(
  schema: OpenAPIV3.SchemaObject,
  parentId: string,
  section: string,
  packConfig: AdapterPackConfig,
  specPath: string,
  nodes: Node[],
  edges: Edge[],
  diagnostics: Diagnostic[],
): void {
  for (const [fieldName, fieldSchema] of Object.entries(schema.properties ?? {})) {
    const fieldId = deriveNodeId('field', undefined, fieldName, parentId, section)
    const [component] = parentId.split('.')
    const fieldNode = makeNode(packConfig.constructs.schemaProperty?.template ?? 'Field', component, specPath, fieldId)
    const required = Array.isArray(schema.required) && schema.required.includes(fieldName)

    if (isRefSchema(fieldSchema)) {
      fieldNode.properties = { objectRef: refName(fieldSchema.$ref), nullable: !required, cardinality: 'one' }
    } else {
      const fs = fieldSchema as OpenAPIV3.SchemaObject
      const scalarType = deriveScalarType(fs.type ?? 'string', fs.format, packConfig.scalarTypes)
      if (fs.type === 'array') {
        const items = fs.items
        if (isRefSchema(items)) {
          fieldNode.properties = { objectRef: refName(items.$ref), nullable: !required, cardinality: 'many' }
        } else {
          const itemType = deriveScalarType((items as OpenAPIV3.SchemaObject)?.type ?? 'string', (items as OpenAPIV3.SchemaObject)?.format, packConfig.scalarTypes)
          fieldNode.properties = { type: itemType ?? 'string', nullable: !required, cardinality: 'many' }
        }
      } else if (scalarType) {
        fieldNode.properties = { type: scalarType, nullable: !required, cardinality: 'one' }
      } else {
        diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for field ${fieldId}: ${fs.type}/${fs.format}` })
        fieldNode.properties = { type: 'string', nullable: !required, cardinality: 'one' }
      }
    }

    nodes.push(fieldNode)
    edges.push({ id: `${parentId}__has-field__${fieldId}`, from: parentId, to: fieldId, type: 'has-field', state: 'implemented', stability: 'unstable' })
  }
}

function deriveComponentForSchema(name: string, document: OpenAPIV3.Document, entry: OpenAPIImportEntry): string | undefined {
  // Find first operation that references this schema and use its component
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) continue
    const methods = ['get', 'post', 'put', 'patch', 'delete'] as const
    for (const method of methods) {
      const operation = (pathItem as Record<string, unknown>)[method] as OpenAPIV3.OperationObject | undefined
      if (!operation) continue
      if (referencesSchema(operation, name)) {
        return entry.componentMapping.strategy === 'tag'
          ? operation.tags?.[0]
          : deriveComponent(path, entry.componentMapping)
      }
    }
  }
  return undefined
}

function referencesSchema(operation: OpenAPIV3.OperationObject, schemaName: string): boolean {
  const str = JSON.stringify(operation)
  return str.includes(`#/components/schemas/${schemaName}`)
}
```

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/adapters/openapi/mapper.ts
git commit -m "feat: OpenAPI mapper — operations, schemas, and fields"
```

---

## Task 12: OpenAPI mapper — enums

**Files:**
- Modify: `src/adapters/openapi/mapper.ts`

- [ ] **Add enum detection and emission to `emitFields` and `mapDocument`**

In `mapDocument`, after the shared component schemas loop, add enum handling:

```typescript
// Emit shared enum definitions from components/schemas
if (document.components?.schemas) {
  for (const [name, schema] of Object.entries(document.components.schemas)) {
    if (isRefSchema(schema)) continue
    const s = schema as OpenAPIV3.SchemaObject
    if (s.type !== 'object' && s.enum) {
      const component = deriveComponentForSchema(name, document, entry)
      if (!component) continue
      const enumId = `${component}.EnumDefinition.${name}`
      const enumNode = makeNode(packConfig.constructs.enumDefinition?.template ?? 'EnumDefinition', component, entry.spec, enumId)
      nodes.push(enumNode)
      sharedSchemas.set(name, enumId)

      s.enum.forEach((value, i) => {
        const valueId = deriveNodeId('enumValue', undefined, String(value), enumId, 'values')
        const valueNode = makeNode(packConfig.constructs.enumValue?.template ?? 'EnumValue', component, entry.spec, valueId)
        valueNode.properties = { name: String(value) }
        nodes.push(valueNode)
        edges.push({ id: `${enumId}__has-value__${valueId}`, from: enumId, to: valueId, type: 'has-value', state: 'implemented', stability: 'unstable' })
      })
    }
  }
}
```

In `emitFields`, update the field property building to recognise enum refs:

```typescript
// After existing ref handling, when a field's schema has inline enum values:
if (!isRefSchema(fieldSchema)) {
  const fs = fieldSchema as OpenAPIV3.SchemaObject
  if (fs.enum && fs.type !== 'object') {
    // Inline enum on a field — skip scalar type lookup, use objectRef pointing to shared enum if it exists
    const enumRef = sharedSchemas?.get(fieldName) // convention: if enum was promoted
    fieldNode.properties = { ...(enumRef ? { objectRef: enumRef } : { type: 'string' }), nullable: !required, cardinality: 'one' }
  }
}
```

Note: thread `sharedSchemas` into `emitFields` as an optional parameter for the inline enum case.

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/adapters/openapi/mapper.ts
git commit -m "feat: OpenAPI mapper — enum definitions and values"
```

---

## Task 13: OpenAPIAdapter class

**Files:**
- Create: `src/adapters/openapi/index.ts`
- Modify: `src/adapters/index.ts` (auto-register adapter)

- [ ] **Write `src/adapters/openapi/index.ts`**

```typescript
import type { OpenAPIImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class OpenAPIAdapter implements SpecAdapter<OpenAPIImportEntry> {
  readonly adapterId = 'openapi' as const

  async import(entry: OpenAPIImportEntry, context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = await parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }

    const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry, context.packConfig)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics] }
  }
}
```

- [ ] **Register the adapter in `src/adapters/index.ts`**

At the bottom of `src/adapters/index.ts`, add:

```typescript
import { OpenAPIAdapter } from './openapi/index.js'
registerAdapter(new OpenAPIAdapter())
```

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/adapters/openapi/index.ts src/adapters/index.ts
git commit -m "feat: OpenAPIAdapter class wiring parser and mapper"
```

---

## Task 14: Per-component reconcile

**Files:**
- Create: `src/reconcile/index.ts`
- Create: `test/reconcile/index.test.ts`

- [ ] **Write the failing tests**

Create `test/reconcile/index.test.ts`:

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { diffNodes } from '../../src/reconcile/index.js'
import type { Node } from '../../src/schema/index.js'

function makeNode(id: string, overrides: Partial<Node> = {}): Node {
  return {
    id,
    template: 'APIEndpoint',
    component: 'orders',
    state: 'implemented',
    stability: 'unstable',
    schemaVersion: '1',
    lastModifiedAt: '2026-06-18',
    properties: {},
    extractedFrom: './specs/orders.yaml',
    derivation: 'determined',
    derivedBy: 'adapter:openapi',
    ...overrides,
  }
}

describe('diffNodes', () => {
  it('identifies new nodes', () => {
    const existing = new Map<string, Node>()
    const incoming = [makeNode('orders.APIEndpoint.create')]
    const { toAdd, toUpdate, toRemove } = diffNodes(incoming, existing, './specs/orders.yaml')
    assert.equal(toAdd.length, 1)
    assert.equal(toUpdate.length, 0)
    assert.equal(toRemove.length, 0)
  })

  it('identifies unchanged nodes as neither add nor update', () => {
    const node = makeNode('orders.APIEndpoint.create')
    const existing = new Map([[node.id, { ...node }]])
    const { toAdd, toUpdate } = diffNodes([node], existing, './specs/orders.yaml')
    assert.equal(toAdd.length, 0)
    assert.equal(toUpdate.length, 0)
  })

  it('identifies changed nodes', () => {
    const original = makeNode('orders.APIEndpoint.create', { properties: { method: 'GET' } })
    const updated = makeNode('orders.APIEndpoint.create', { properties: { method: 'POST' } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([updated], existing, './specs/orders.yaml')
    assert.equal(toUpdate.length, 1)
    assert.equal(toUpdate[0].properties.method, 'POST')
  })

  it('identifies orphaned nodes for removal', () => {
    const orphan = makeNode('orders.APIEndpoint.deleted', { extractedFrom: './specs/orders.yaml' })
    const existing = new Map([[orphan.id, orphan]])
    const { toRemove } = diffNodes([], existing, './specs/orders.yaml')
    assert.equal(toRemove.length, 1)
    assert.equal(toRemove[0].id, 'orders.APIEndpoint.deleted')
  })

  it('does not remove nodes from a different spec', () => {
    const other = makeNode('orders.APIEndpoint.other', { extractedFrom: './specs/other.yaml' })
    const existing = new Map([[other.id, other]])
    const { toRemove } = diffNodes([], existing, './specs/orders.yaml')
    assert.equal(toRemove.length, 0)
  })

  it('preserves state/stability on update', () => {
    const original = makeNode('orders.APIEndpoint.create', { state: 'agreed', stability: 'stable' })
    const incoming = makeNode('orders.APIEndpoint.create', { state: 'implemented', stability: 'unstable', properties: { method: 'POST' } })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate[0].state, 'agreed')
    assert.equal(toUpdate[0].stability, 'stable')
  })

  it('always overwrites derivation with incoming value', () => {
    const original = makeNode('orders.APIEndpoint.create', { derivation: 'manual' })
    const incoming = makeNode('orders.APIEndpoint.create', { derivation: 'determined' })
    const existing = new Map([[original.id, original]])
    const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
    assert.equal(toUpdate[0].derivation, 'determined')
  })
})
```

- [ ] **Run to verify failure**

```bash
npm test
```
Expected: FAIL — `reconcile/index.js` not found.

- [ ] **Write `src/reconcile/index.ts`**

```typescript
import type { Node } from '../schema/index.js'

export interface DiffResult {
  toAdd: Node[]
  toUpdate: Node[]
  toRemove: Node[]
}

const ADAPTER_OWNED = new Set(['method', 'path', 'operationId', 'type', 'nullable', 'cardinality', 'objectRef'])
const HUMAN_OWNED = new Set(['state', 'stability', 'notes'])

export function diffNodes(
  incoming: Node[],
  existing: Map<string, Node>,
  specPath: string,
): DiffResult {
  const toAdd: Node[] = []
  const toUpdate: Node[] = []
  const incomingIds = new Set(incoming.map(n => n.id))

  for (const node of incoming) {
    const current = existing.get(node.id)
    if (!current) {
      toAdd.push(node)
      continue
    }

    // Build merged node: adapter owns spec fields; human owns state/stability/notes
    const merged: Node = {
      ...current,
      // Adapter-owned properties
      properties: mergeProperties(current.properties, node.properties),
      extractedFrom: node.extractedFrom,
      derivation: node.derivation,
      derivedBy: node.derivedBy,
      lastModifiedAt: node.lastModifiedAt,
      // Human-owned — preserve existing
      state: current.state,
      stability: current.stability,
    }

    if (!nodesEqual(current, merged)) {
      toUpdate.push(merged)
    }
  }

  // Orphans: nodes from this spec not in incoming set
  const toRemove: Node[] = []
  for (const [id, node] of existing) {
    if (node.extractedFrom === specPath && !incomingIds.has(id)) {
      toRemove.push({ ...node, state: 'removed' })
    }
  }

  return { toAdd, toUpdate, toRemove }
}

function mergeProperties(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...current }
  for (const [key, value] of Object.entries(incoming)) {
    if (ADAPTER_OWNED.has(key) || !HUMAN_OWNED.has(key)) {
      merged[key] = value
    }
  }
  return merged
}

function nodesEqual(a: Node, b: Node): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

- [ ] **Run tests**

```bash
npm test
```
Expected: all reconcile tests pass.

- [ ] **Commit**

```bash
git add src/reconcile/index.ts test/reconcile/index.test.ts
git commit -m "feat: per-component reconcile diff logic"
```

---

## Task 15: Import runner

**Files:**
- Create: `src/import/runner.ts`

- [ ] **Write the runner**

```typescript
import { parse as parseYaml } from 'yaml'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { loadGraph } from '../loader/index.js'
import { serializeGraph } from '../writer/graph-writer.js'
import { getAdapter } from '../adapters/index.js'
import { diffNodes } from '../reconcile/index.js'
import type { ImportConfig } from './config.js'
import type { AdapterPackConfig } from '../adapters/index.js'
import type { Diagnostic, Node } from '../schema/index.js'
import type { Graph } from '../schema/index.js'
import { FileGraphSource } from '../source/file-source.js'

export interface RunResult {
  diagnostics: Diagnostic[]
}

export async function runImport(config: ImportConfig, graphPath: string): Promise<RunResult> {
  const allDiagnostics: Diagnostic[] = []

  const graph = await loadGraph({ graphPath })

  for (const entry of config.imports) {
    const packConfig = await loadPackAdapterConfig(graphPath, entry.adapter)
    if (!packConfig) {
      allDiagnostics.push({
        severity: 'error',
        file: graphPath,
        message: `No ${entry.adapter} adapter config found in active packs — is the ${entry.adapter === 'openapi' ? 'rest' : entry.adapter} pack active?`,
      })
      continue
    }

    const adapter = getAdapter(entry.adapter)
    const result = await adapter.import(entry, { packConfig, templates: graph.templates })
    allDiagnostics.push(...result.diagnostics)

    if (result.diagnostics.some(d => d.severity === 'error')) continue

    const specPath = path.resolve(entry.spec)
    const existingNodes = graph.nodesById
    const { toAdd, toUpdate, toRemove } = diffNodes(result.nodes, existingNodes, specPath)

    for (const node of [...toAdd, ...toUpdate, ...toRemove]) {
      graph.nodesById.set(node.id, node)
    }
  }

  const source = new FileGraphSource({ graphDir: graphPath, defaultBranch: 'local' })
  const contentMap = serializeGraph(graph, { sourceGraphPath: graphPath, outputGraphPath: graphPath })
  await source.commit('local', contentMap, 'corum import', { replaceGraphContent: true })

  return { diagnostics: allDiagnostics }
}

async function loadPackAdapterConfig(graphPath: string, adapterId: string): Promise<AdapterPackConfig | null> {
  const source = new FileGraphSource({ graphDir: graphPath, defaultBranch: 'local' })
  let packContent: import('../source/index.js').ContentMap
  try {
    packContent = await source.loadPackContent(await source.defaultBranch())
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

- [ ] **Build**

```bash
npm run build
```
Expected: clean build.

- [ ] **Commit**

```bash
git add src/import/runner.ts
git commit -m "feat: import runner orchestrating adapter, reconcile, and write"
```

---

## Task 16: CLI entry point

**Files:**
- Create: `src/bin/corum.ts`
- Modify: `package.json`

- [ ] **Write `src/bin/corum.ts`**

```typescript
import { Command } from 'commander'
import path from 'node:path'
import { loadImportConfig, buildOpenAPIConfig } from '../import/config.js'
import { runImport } from '../import/runner.js'

const program = new Command()

program
  .name('corum')
  .description('Corum graph CLI')
  .version('0.1.0')

const importCmd = program.command('import')

importCmd
  .command('openapi <spec>')
  .description('Import an OpenAPI spec into the graph')
  .option('--component-strategy <strategy>', 'Component mapping strategy: uri-segment, tag, hardcoded', 'uri-segment')
  .option('--segment <n>', 'URI segment index (for uri-segment strategy)', parseInt)
  .option('--pattern <regex>', 'Regex pattern (for uri-segment strategy)')
  .option('--component <name>', 'Component name (for hardcoded strategy)')
  .option('--graph <path>', 'Path to graph directory', '.corum/graph')
  .action(async (spec: string, opts) => {
    const entry = buildOpenAPIConfig(spec, opts.componentStrategy, opts.segment, opts.pattern, opts.component)
    const config = { imports: [entry] }
    const result = await runImport(config, path.resolve(opts.graph))
    reportDiagnostics(result.diagnostics)
    if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
  })

importCmd
  .command('run')
  .description('Run imports from a config file')
  .option('--config <path>', 'Path to import config YAML', 'corum-imports.yaml')
  .option('--graph <path>', 'Path to graph directory', '.corum/graph')
  .action(async (opts) => {
    const config = loadImportConfig(path.resolve(opts.config))
    const result = await runImport(config, path.resolve(opts.graph))
    reportDiagnostics(result.diagnostics)
    if (result.diagnostics.some(d => d.severity === 'error')) process.exit(1)
  })

function reportDiagnostics(diagnostics: { severity: string; file: string; message: string }[]): void {
  for (const d of diagnostics) {
    const prefix = d.severity === 'error' ? 'ERROR' : 'WARN'
    process.stderr.write(`[${prefix}] ${d.file}: ${d.message}\n`)
  }
  const errors = diagnostics.filter(d => d.severity === 'error').length
  const warnings = diagnostics.filter(d => d.severity === 'warning').length
  process.stdout.write(`Import complete. ${errors} error(s), ${warnings} warning(s).\n`)
}

program.parse()
```

- [ ] **Add `bin` field to `package.json`**

```json
{
  "bin": { "corum": "./dist/src/bin/corum.js" }
}
```

- [ ] **Build and smoke test**

```bash
npm run build && node dist/src/bin/corum.js --help
```
Expected: help text showing `import` command with `openapi` and `run` subcommands.

- [ ] **Commit**

```bash
git add src/bin/corum.ts package.json
git commit -m "feat: corum CLI entry point with import openapi and import run commands"
```

---

## Task 17: Fixture specs and golden file tests

**Files:**
- Create: `test/fixtures/openapi/specs/orders-simple.yaml`
- Create: `test/fixtures/openapi/specs/orders-shared.yaml`
- Create: `test/fixtures/openapi/specs/orders-simple.json`
- Create: `test/import/runner.test.ts`

- [ ] **Create `test/fixtures/openapi/specs/orders-simple.yaml`**

```yaml
openapi: "3.0.3"
info:
  title: Orders API
  version: "1.0"
paths:
  /orders/create:
    post:
      operationId: createOrder
      summary: Create a new order
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [customerId]
              properties:
                customerId:
                  type: string
                  format: uuid
                notes:
                  type: string
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                type: object
                required: [orderId]
                properties:
                  orderId:
                    type: string
                    format: uuid
```

- [ ] **Create `test/fixtures/openapi/specs/orders-simple.json`**

Same content as `orders-simple.yaml` expressed as JSON:

```json
{
  "openapi": "3.0.3",
  "info": { "title": "Orders API", "version": "1.0" },
  "paths": {
    "/orders/create": {
      "post": {
        "operationId": "createOrder",
        "summary": "Create a new order",
        "requestBody": {
          "required": true,
          "content": {
            "application/json": {
              "schema": {
                "type": "object",
                "required": ["customerId"],
                "properties": {
                  "customerId": { "type": "string", "format": "uuid" },
                  "notes": { "type": "string" }
                }
              }
            }
          }
        },
        "responses": {
          "201": {
            "description": "Created",
            "content": {
              "application/json": {
                "schema": {
                  "type": "object",
                  "required": ["orderId"],
                  "properties": {
                    "orderId": { "type": "string", "format": "uuid" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Create `test/fixtures/openapi/specs/orders-shared.yaml`**

```yaml
openapi: "3.0.3"
info:
  title: Orders API (shared schemas)
  version: "1.0"
components:
  schemas:
    OrderStatus:
      type: string
      enum: [pending, confirmed, cancelled]
    OrderSummary:
      type: object
      required: [orderId, status]
      properties:
        orderId:
          type: string
          format: uuid
        status:
          $ref: '#/components/schemas/OrderStatus'
paths:
  /orders/create:
    post:
      operationId: createOrder
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                customerId:
                  type: string
                  format: uuid
      responses:
        "201":
          description: Created
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/OrderSummary'
```

- [ ] **Write golden file tests in `test/import/runner.test.ts`**

```typescript
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadGraph } from '../../src/loader/index.js'
import { runImport } from '../../src/import/runner.js'
import type { ImportConfig } from '../../src/import/config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const fixtureGraphDir = path.join(repoRoot, 'fixtures/sample-graph')
const specsDir = path.join(repoRoot, 'test/fixtures/openapi/specs')

async function runAgainstFixture(specFile: string): Promise<{ graphDir: string; cleanup: () => void }> {
  const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-import-'))
  // Copy fixture graph to temp dir
  fs.cpSync(fixtureGraphDir, graphDir, { recursive: true })
  const config: ImportConfig = {
    imports: [{
      adapter: 'openapi',
      spec: path.join(specsDir, specFile),
      componentMapping: { strategy: 'uri-segment', segment: 0 },
    }],
  }
  await runImport(config, graphDir)
  return { graphDir, cleanup: () => fs.rmSync(graphDir, { recursive: true, force: true }) }
}

describe('import runner — orders-simple.yaml', () => {
  it('produces an APIEndpoint node for createOrder', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const node = graph.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(node, 'expected orders.APIEndpoint.createOrder node')
      assert.equal(node.properties.method, 'POST')
      assert.equal(node.properties.path, '/orders/create')
      assert.equal(node.derivation, 'determined')
      assert.equal(node.derivedBy, 'adapter:openapi')
    } finally {
      cleanup()
    }
  })

  it('produces Field nodes with correct types', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const customerIdField = [...graph.nodesById.values()].find(n => n.id.endsWith('.fields.customerId'))
      assert.ok(customerIdField)
      assert.equal(customerIdField.properties.type, 'uuid')
      assert.equal(customerIdField.properties.nullable, false)
    } finally {
      cleanup()
    }
  })

  it('is idempotent — second import produces no new nodes', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      const config: ImportConfig = {
        imports: [{
          adapter: 'openapi',
          spec: path.join(specsDir, 'orders-simple.yaml'),
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      }
      const before = await loadGraph({ graphPath: graphDir })
      const beforeCount = before.nodesById.size
      await runImport(config, graphDir)
      const after = await loadGraph({ graphPath: graphDir })
      assert.equal(after.nodesById.size, beforeCount)
    } finally {
      cleanup()
    }
  })

  it('parses JSON spec identically to YAML spec', async () => {
    const { graphDir: yamlDir, cleanup: cleanYaml } = await runAgainstFixture('orders-simple.yaml')
    const { graphDir: jsonDir, cleanup: cleanJson } = await runAgainstFixture('orders-simple.json')
    try {
      const yamlGraph = await loadGraph({ graphPath: yamlDir })
      const jsonGraph = await loadGraph({ graphPath: jsonDir })
      const yamlEndpoint = yamlGraph.nodesById.get('orders.APIEndpoint.createOrder')
      const jsonEndpoint = jsonGraph.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(yamlEndpoint && jsonEndpoint)
      assert.equal(yamlEndpoint.properties.method, jsonEndpoint.properties.method)
    } finally {
      cleanYaml()
      cleanJson()
    }
  })
})

describe('import runner — orders-shared.yaml', () => {
  it('produces a shared Schema node for OrderSummary', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-shared.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const schemaNode = graph.nodesById.get('orders.Schema.OrderSummary')
      assert.ok(schemaNode, 'expected shared Schema node for OrderSummary')
    } finally {
      cleanup()
    }
  })

  it('produces an EnumDefinition for OrderStatus', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-shared.yaml')
    try {
      const graph = await loadGraph({ graphPath: graphDir })
      const enumNode = graph.nodesById.get('orders.EnumDefinition.OrderStatus')
      assert.ok(enumNode, 'expected EnumDefinition node for OrderStatus')
      const pendingValue = graph.nodesById.get('orders.EnumDefinition.OrderStatus.values.pending')
      assert.ok(pendingValue)
    } finally {
      cleanup()
    }
  })
})

describe('import runner — orphan removal', () => {
  it('marks a previously imported endpoint as removed when absent from updated spec', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('orders-simple.yaml')
    try {
      // Verify the endpoint was imported
      const graphBefore = await loadGraph({ graphPath: graphDir })
      assert.ok(graphBefore.nodesById.get('orders.APIEndpoint.createOrder'))

      // Re-import with an empty spec (no paths) — simulates endpoint removal
      const emptySpec = path.join(graphDir, 'empty-spec.yaml')
      fs.writeFileSync(emptySpec, `openapi: "3.0.3"\ninfo:\n  title: Empty\n  version: "1.0"\npaths: {}`)
      const config: ImportConfig = {
        imports: [{
          adapter: 'openapi',
          spec: emptySpec,
          componentMapping: { strategy: 'uri-segment', segment: 0 },
        }],
      }
      await runImport(config, graphDir)
      const graphAfter = await loadGraph({ graphPath: graphDir })
      const removed = graphAfter.nodesById.get('orders.APIEndpoint.createOrder')
      assert.ok(removed, 'node should still exist')
      assert.equal(removed.state, 'removed', 'node should be marked removed')
    } finally {
      cleanup()
    }
  })
})

describe('import runner — invalid spec', () => {
  it('returns error diagnostic and writes no files for an invalid spec', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-invalid-'))
    fs.cpSync(fixtureGraphDir, tmpDir, { recursive: true })
    try {
      const badSpec = path.join(tmpDir, 'bad.yaml')
      fs.writeFileSync(badSpec, `not: valid openapi`)
      const config: ImportConfig = {
        imports: [{
          adapter: 'openapi',
          spec: badSpec,
          componentMapping: { strategy: 'hardcoded', component: 'orders' },
        }],
      }
      const result = await runImport(config, tmpDir)
      assert.ok(result.diagnostics.some(d => d.severity === 'error'), 'expected at least one error diagnostic')
      // Graph node count should be unchanged
      const graph = await loadGraph({ graphPath: tmpDir })
      const originalGraph = await loadGraph({ graphPath: fixtureGraphDir })
      assert.equal(graph.nodesById.size, originalGraph.nodesById.size)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})

describe('import runner — existing tests unaffected', () => {
  it('existing fixture graph still loads with expected node count', async () => {
    const graph = await loadGraph({ graphPath: fixtureGraphDir })
    assert.ok(graph.nodesById.size > 0)
    assert.ok(graph.diagnostics.filter(d => d.severity === 'error').length === 0)
  })
})
```

- [ ] **Run tests**

```bash
npm test
```
Expected: golden file tests pass, existing tests unaffected.

- [ ] **Commit**

```bash
git add test/fixtures/openapi/specs/ test/import/runner.test.ts
git commit -m "test: golden file integration tests for OpenAPI importer"
```

---

## Task 18: Final verification

- [ ] **Run full test suite**

```bash
npm test
```
Expected: all tests pass. Note the final node/edge counts from the loader test — confirm they are unchanged from before this feature branch.

- [ ] **Smoke test the CLI end to end**

```bash
npm run build
node dist/src/bin/corum.js import openapi test/fixtures/openapi/specs/orders-simple.yaml \
  --component-strategy uri-segment \
  --segment 0 \
  --graph .corum/graph
```
Expected: `Import complete. 0 error(s), 0 warning(s).`

- [ ] **Verify graph was updated**

```bash
node dist/src/bin/corum.js import openapi test/fixtures/openapi/specs/orders-simple.yaml \
  --component-strategy uri-segment \
  --segment 0 \
  --graph .corum/graph
```
Run twice — second run should report the same output with no errors (idempotency).

- [ ] **Final commit if anything was tidied**

```bash
git add -p
git commit -m "chore: final cleanup and verification"
```
