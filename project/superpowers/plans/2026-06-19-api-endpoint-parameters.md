# APIEndpoint Parameters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `parameters` property to `APIEndpoint` nodes capturing path, query, and header parameters from OpenAPI specs.

**Architecture:** Parameters are stored as an inline map in `properties.parameters`, keyed by name with a `location` field (`path`/`query`/`header`) per entry — mirroring the `responses` map pattern. The mapper extracts from `operation.parameters` and `pathItem.parameters` (operation-level overrides path-item-level same-name entries). The reconcile module is fixed to use derivation-based ownership: for `derivation: 'determined'` nodes, all incoming properties win except `state`, `stability`, and `notes`.

**Tech Stack:** TypeScript, `node:test` runner, `yaml` package, `openapi-types`

---

## Files

| Action | Path | Purpose |
|---|---|---|
| Modify | `src/reconcile/index.ts` | Replace `ADAPTER_OWNED` with derivation-based merge |
| Modify | `test/reconcile/index.test.ts` | Update + add reconcile tests |
| Modify | `.corum/packs/rest/templates/APIEndpoint.yaml` | Add `parameters` property with `$defs` |
| Modify | `src/adapters/openapi/mapper.ts` | Add `extractParameters`, wire into `mapDocument` |
| Modify | `test/adapters/openapi/mapper.test.ts` | Add unit tests for parameter extraction |
| Create | `test/fixtures/openapi/specs/params-example.yaml` | Fixture OpenAPI spec |
| Create | `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/searchItems.yaml` | Golden file |
| Create | `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/getItemById.yaml` | Golden file |
| Create | `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/deleteItem.yaml` | Golden file |
| Modify | `test/import/runner.test.ts` | Add golden integration test |

---

## Task 1: Fix reconcile — derivation-based property ownership

The current `mergeProperties` in `src/reconcile/index.ts` checks a hardcoded `ADAPTER_OWNED` set of property names. This couples the generic reconcile module to specific template schemas and will silently fail to update `parameters` on re-import. Fix: for nodes with `derivation: 'determined'`, all incoming properties win; only `state`, `stability`, `notes` are preserved from the existing node.

**Files:**
- Modify: `src/reconcile/index.ts`
- Modify: `test/reconcile/index.test.ts`

- [ ] **Step 1: Write a failing test for parameters being updated on re-import**

Add this test to the `describe('diffNodes')` block in `test/reconcile/index.test.ts`:

```typescript
it('for determined nodes, parameters property is updated on re-import', () => {
  const oldParams = { status: { location: 'query', type: 'string', required: false, cardinality: 'one' } }
  const newParams = {
    status: { location: 'query', type: 'string', required: false, cardinality: 'one' },
    limit: { location: 'query', type: 'integer', required: true, cardinality: 'one' },
  }
  const original = makeNode('items.APIEndpoint.searchItems', { properties: { method: 'GET', parameters: oldParams } })
  const incoming = makeNode('items.APIEndpoint.searchItems', { properties: { method: 'GET', parameters: newParams } })
  const existing = new Map([[original.id, original]])
  const { toUpdate } = diffNodes([incoming], existing, './specs/items.yaml')
  assert.equal(toUpdate.length, 1)
  assert.deepEqual(toUpdate[0].properties.parameters, newParams)
})
```

- [ ] **Step 2: Run the new test to confirm it fails**

```
node --test dist/test/reconcile/index.test.js
```

Expected: FAIL — `parameters` is not in `ADAPTER_OWNED` so the update is not applied; `toUpdate` will be empty or `parameters` will remain the old value.

- [ ] **Step 3: Implement the fix in `src/reconcile/index.ts`**

Replace the entire file contents with:

```typescript
import type { Node } from '../schema/index.js'

export interface DiffResult {
  toAdd: Node[]
  toUpdate: Node[]
  toRemove: Node[]
}

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

    const merged: Node = {
      ...current,
      properties: mergeProperties(current.properties, node.properties, node.derivation),
      extractedFrom: node.extractedFrom,
      derivation: node.derivation,
      derivedBy: node.derivedBy,
      lastModifiedAt: node.lastModifiedAt,
      state: current.state,
      stability: current.stability,
    }

    if (!nodesEqual(current, merged)) {
      toUpdate.push(merged)
    }
  }

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
  derivation: string | undefined,
): Record<string, unknown> {
  if (derivation === 'determined') {
    const humanValues = Object.fromEntries(
      Object.entries(current).filter(([k]) => HUMAN_OWNED.has(k)),
    )
    return { ...incoming, ...humanValues }
  }
  return { ...current, ...incoming }
}

function nodesEqual(a: Node, b: Node): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
```

- [ ] **Step 4: Update the existing "preserves unknown/custom properties" test**

The old test expected custom human-added properties to survive re-import. Under the new model, for `determined` nodes, only `HUMAN_OWNED` keys from the current node survive. Replace the existing test with this updated version (same test description updated):

```typescript
it('for determined nodes, incoming properties replace current — non-human current-only props are dropped', () => {
  const original = makeNode('orders.APIEndpoint.create', { properties: { method: 'GET', displayName: 'Create Order' } })
  const incoming = makeNode('orders.APIEndpoint.create', { properties: { method: 'POST' } })
  const existing = new Map([[original.id, original]])
  const { toUpdate } = diffNodes([incoming], existing, './specs/orders.yaml')
  assert.equal(toUpdate[0].properties.method, 'POST')
  assert.equal(toUpdate[0].properties.displayName, undefined)
})
```

- [ ] **Step 5: Build and run all reconcile tests**

```
npm run build && node --test dist/test/reconcile/index.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```
git add src/reconcile/index.ts test/reconcile/index.test.ts
git commit -m "fix: reconcile uses derivation-based property ownership instead of hardcoded ADAPTER_OWNED set"
```

---

## Task 2: Update APIEndpoint.yaml template

Add `parameters` as an optional property alongside `method`, `path`, `request`, and `responses`. Use `$defs` to define the parameter shape once.

**Files:**
- Modify: `.corum/packs/rest/templates/APIEndpoint.yaml`

- [ ] **Step 1: Add `$defs` and `parameters` to the properties schema**

In `.corum/packs/rest/templates/APIEndpoint.yaml`, replace the `properties:` block (from line 29 to the end of the properties schema, before `edge-types:`) with:

```yaml
properties:
  type: object
  additionalProperties: false
  required:
    - method
    - path
    - responses
  $defs:
    Parameter:
      type: object
      additionalProperties: false
      required:
        - location
        - required
        - cardinality
      properties:
        location:
          type: string
          enum:
            - path
            - query
            - header
        type:
          type: string
          enum:
            - uuid
            - string
            - integer
            - decimal
            - boolean
            - datetime
            - date
            - time
        required:
          type: boolean
        cardinality:
          type: string
          enum:
            - one
            - many
  properties:

    method:
      type: string
      enum:
        - GET
        - PUT
        - POST
        - DELETE
        - OPTIONS
        - HEAD
        - PATCH
        - TRACE
      description: "HTTP method for this operation"

    path:
      type: string
      pattern: "^/"
      description: "URL path pattern, for example /orders/{orderId}"
      examples:
        - /orders
        - /orders/{orderId}

    description:
      type: string
      description: "Human-readable summary of what this operation does"

    parameters:
      type: object
      description: |
        Map of parameter name to parameter definition. Covers path, query,
        and header parameters. Location (path/query/header) is declared on
        each entry. Cookie parameters are not modelled. Parameter names must
        be unique across locations within an operation (OpenAPI requirement).
      additionalProperties:
        $ref: '#/$defs/Parameter'

    request:
      type: string
      format: node-ref
      description: |
        Local schema ref ('#/schemas/<name>') or global node ID describing
        the request body. Omit for operations with no body (e.g. GET, DELETE).
      examples:
        - "'#/schemas/create-order-request'"

    responses:
      type: object
      minProperties: 1
      description: |
        Map of HTTP status code (or 'default') to a local schema ref
        ('#/schemas/<name>') or global node ID describing the response body.
      propertyNames:
        pattern: "^(default|[1-5][0-9]{2})$"
      additionalProperties:
        type: string
        format: node-ref
      examples:
        - "200": "'#/schemas/order-response'"
```

- [ ] **Step 2: Build and verify templates load cleanly**

```
npm run build && node --test dist/test/loader.test.js
```

Expected: all loader tests pass (templates load without errors).

- [ ] **Step 3: Commit**

```
git add .corum/packs/rest/templates/APIEndpoint.yaml
git commit -m "feat: add parameters property to APIEndpoint template with \$defs"
```

---

## Task 3: Add parameter extraction to mapper

**Files:**
- Modify: `src/adapters/openapi/mapper.ts`
- Modify: `test/adapters/openapi/mapper.test.ts`

- [ ] **Step 1: Write failing unit tests for parameter extraction**

Add a new `describe` block at the end of `test/adapters/openapi/mapper.test.ts`:

```typescript
import { mapDocument } from '../../../src/adapters/openapi/mapper.js'
import type { OpenAPIV3 } from 'openapi-types'
import type { AdapterPackConfig } from '../../../src/adapters/index.js'
import type { OpenAPIImportEntry } from '../../../src/import/config.js'
```

Add these imports to the top of the file (after the existing imports), then append the describe block:

```typescript
const PACK_CONFIG: AdapterPackConfig = {
  adapter: 'openapi',
  version: '1.0',
  constructs: {
    operation: { template: 'APIEndpoint' },
    requestSchema: { template: 'Schema', section: 'schemas' },
    responseSchema: { template: 'Schema', section: 'schemas' },
    schemaProperty: { template: 'Field', section: 'fields' },
    enumDefinition: { template: 'EnumDefinition', section: 'enums' },
    enumValue: { template: 'EnumValue', section: 'values' },
  },
  scalarTypes: {
    string: 'string',
    'string/uuid': 'uuid',
    'string/date': 'date',
    'string/date-time': 'datetime',
    integer: 'integer',
    number: 'decimal',
    boolean: 'boolean',
  },
}

const ENTRY: OpenAPIImportEntry = {
  adapter: 'openapi',
  spec: 'test.yaml',
  componentMapping: { strategy: 'uri-segment', segment: 0 },
}

function makeDoc(paths: Record<string, OpenAPIV3.PathItemObject>): OpenAPIV3.Document {
  return { openapi: '3.0.0', info: { title: 'Test', version: '1.0' }, paths }
}

describe('mapDocument — parameters', () => {
  it('maps a query parameter with scalar type', () => {
    const doc = makeDoc({
      '/items/search': {
        get: {
          operationId: 'searchItems',
          parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.searchItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      limit: { location: 'query', type: 'integer', required: true, cardinality: 'one' },
    })
  })

  it('maps an array query parameter as cardinality many', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'tags', in: 'query', required: false, schema: { type: 'array', items: { type: 'string' } } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      tags: { location: 'query', type: 'string', required: false, cardinality: 'many' },
    })
  })

  it('maps an enum-constrained query parameter as type string', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['active', 'inactive'] } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      status: { location: 'query', type: 'string', required: false, cardinality: 'one' },
    })
  })

  it('maps a path parameter with location path', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        get: {
          operationId: 'getItemById',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.getItemById')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true, cardinality: 'one' },
    })
  })

  it('maps a header parameter with location header', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        delete: {
          operationId: 'deleteItem',
          parameters: [
            { name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.deleteItem')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true, cardinality: 'one' },
      'X-Api-Key': { location: 'header', type: 'string', required: true, cardinality: 'one' },
    })
  })

  it('skips cookie parameters', () => {
    const doc = makeDoc({
      '/items': {
        get: {
          operationId: 'listItems',
          parameters: [{ name: 'session', in: 'cookie', required: false, schema: { type: 'string' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.listItems')
    assert.ok(endpoint)
    assert.equal(endpoint.properties.parameters, undefined)
  })

  it('inherits path-item-level parameters, operation-level overrides same name', () => {
    const doc = makeDoc({
      '/items/{itemId}': {
        parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string' } }],
        get: {
          operationId: 'getItemById',
          parameters: [{ name: 'itemId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
          responses: { '200': { description: 'OK' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.getItemById')
    assert.ok(endpoint)
    assert.deepEqual(endpoint.properties.parameters, {
      itemId: { location: 'path', type: 'uuid', required: true, cardinality: 'one' },
    })
  })

  it('does not set parameters property when operation has no parameters', () => {
    const doc = makeDoc({
      '/items': {
        post: {
          operationId: 'createItem',
          responses: { '201': { description: 'Created' } },
        },
      },
    })
    const { nodes } = mapDocument(doc, ENTRY, PACK_CONFIG)
    const endpoint = nodes.find(n => n.id === 'items.APIEndpoint.createItem')
    assert.ok(endpoint)
    assert.equal(endpoint.properties.parameters, undefined)
  })
})
```

- [ ] **Step 2: Build and run mapper tests to confirm they fail**

```
npm run build && node --test dist/test/adapters/openapi/mapper.test.js
```

Expected: the existing tests pass; the new `mapDocument — parameters` tests fail because `parameters` is not yet set on endpoint nodes.

- [ ] **Step 3: Implement `extractParameters` in `src/adapters/openapi/mapper.ts`**

Add this function before the `deriveComponentForSchema` function (after `emitFields`):

```typescript
function extractParameters(
  pathItem: OpenAPIV3.PathItemObject,
  operation: OpenAPIV3.OperationObject,
  packConfig: AdapterPackConfig,
  specPath: string,
  diagnostics: Diagnostic[],
): Record<string, unknown> | undefined {
  const pathItemParams = (pathItem.parameters ?? []) as (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[]
  const operationParams = (operation.parameters ?? []) as (OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject)[]

  const merged = new Map<string, OpenAPIV3.ParameterObject>()
  for (const param of [...pathItemParams, ...operationParams]) {
    if (isRefSchema(param)) continue
    const p = param as OpenAPIV3.ParameterObject
    if (p.in === 'cookie') continue
    merged.set(p.name, p)
  }

  if (merged.size === 0) return undefined

  const parameters: Record<string, unknown> = {}
  for (const [name, param] of merged) {
    const schema = param.schema as OpenAPIV3.SchemaObject | undefined
    if (!schema) continue

    let type: string
    let cardinality: 'one' | 'many'

    if (schema.type === 'array') {
      cardinality = 'many'
      const items = schema.items as OpenAPIV3.SchemaObject | undefined
      type = deriveScalarType(items?.type ?? 'string', items?.format, packConfig.scalarTypes) ?? 'string'
    } else if (schema.enum) {
      cardinality = 'one'
      type = 'string'
    } else {
      cardinality = 'one'
      const derived = deriveScalarType(schema.type ?? 'string', schema.format, packConfig.scalarTypes)
      if (!derived) {
        diagnostics.push({ severity: 'warning', file: specPath, message: `Unknown type for parameter ${name}: ${schema.type}/${schema.format}, defaulting to string` })
        type = 'string'
      } else {
        type = derived
      }
    }

    parameters[name] = {
      location: param.in as 'path' | 'query' | 'header',
      type,
      required: param.required ?? false,
      cardinality,
    }
  }

  return Object.keys(parameters).length > 0 ? parameters : undefined
}
```

- [ ] **Step 4: Wire `extractParameters` into `mapDocument`**

In `mapDocument`, after `endpointNode.properties` is initialised and `nodes.push(endpointNode)`, add the parameters extraction. Find this block (around line 116):

```typescript
      endpointNode.properties = {
        method: method.toUpperCase(),
        path: urlPath,
        ...(operation.summary && { description: operation.summary }),
      }
      nodes.push(endpointNode)
```

Add the parameters extraction immediately after `nodes.push(endpointNode)`:

```typescript
      const parameters = extractParameters(pathItem, operation, packConfig, entry.spec, diagnostics)
      if (parameters) endpointNode.properties.parameters = parameters
```

- [ ] **Step 5: Build and run mapper tests to confirm they pass**

```
npm run build && node --test dist/test/adapters/openapi/mapper.test.js
```

Expected: all tests pass including the new `mapDocument — parameters` suite.

- [ ] **Step 6: Commit**

```
git add src/adapters/openapi/mapper.ts test/adapters/openapi/mapper.test.ts
git commit -m "feat: extract path/query/header parameters from OpenAPI operations into endpoint properties"
```

---

## Task 4: Fixture spec, golden files, and integration test

**Files:**
- Create: `test/fixtures/openapi/specs/params-example.yaml`
- Create: `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/searchItems.yaml`
- Create: `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/getItemById.yaml`
- Create: `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/deleteItem.yaml`
- Modify: `test/import/runner.test.ts`

- [ ] **Step 1: Write the fixture OpenAPI spec**

Create `test/fixtures/openapi/specs/params-example.yaml`:

```yaml
openapi: '3.0.3'
info:
  title: Items API
  version: '1.0'
paths:
  /items/search:
    get:
      operationId: searchItems
      summary: Search items
      parameters:
        - name: limit
          in: query
          required: true
          schema:
            type: integer
        - name: tags
          in: query
          required: false
          schema:
            type: array
            items:
              type: string
        - name: status
          in: query
          required: false
          schema:
            type: string
            enum:
              - active
              - inactive
              - pending
      responses:
        '200':
          description: OK
  /items/{itemId}:
    parameters:
      - name: itemId
        in: path
        required: true
        schema:
          type: string
          format: uuid
    get:
      operationId: getItemById
      summary: Get item by ID
      responses:
        '200':
          description: OK
    delete:
      operationId: deleteItem
      summary: Delete item
      parameters:
        - name: X-Api-Key
          in: header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: OK
```

- [ ] **Step 2: Generate the actual import output to base golden files on**

Run the import against the new fixture to see what the mapper produces:

```
node -e "
const { runImport } = await import('./dist/src/import/runner.js')
const { loadGraph } = await import('./dist/src/loader/index.js')
const { saveGraph } = await import('./dist/src/writer/graph-writer.js')
const fs = await import('node:fs')
const os = await import('node:os')
const path = await import('node:path')

const graphDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corum-params-'))
const baseGraph = await loadGraph({ graphPath: 'fixtures/sample-graph' })
await saveGraph(baseGraph, { sourceGraphPath: 'fixtures/sample-graph', outputGraphPath: graphDir })

await runImport({ imports: [{ adapter: 'openapi', spec: 'test/fixtures/openapi/specs/params-example.yaml', componentMapping: { strategy: 'uri-segment', segment: 0 } }] }, { graphPath: graphDir })

// Print each generated endpoint file
const dir = path.join(graphDir, 'components/items/APIEndpoints')
for (const f of fs.readdirSync(dir)) {
  console.log('=== ' + f + ' ===')
  console.log(fs.readFileSync(path.join(dir, f), 'utf8'))
}
console.log('tmpdir:', graphDir)
" --input-type=module
```

Review the printed output to confirm parameters appear as expected.

- [ ] **Step 3: Write the golden file for `searchItems`**

Create `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/searchItems.yaml` with the expected content (replace the actual `lastModifiedAt` date and spec path with the placeholders `<date>` and `<spec>`):

```yaml
id: items.APIEndpoint.searchItems
template: APIEndpoint
schemaVersion: '1'
metadata:
  component: items
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:openapi
properties:
  method: GET
  path: /items/search
  description: Search items
  parameters:
    limit:
      location: query
      type: integer
      required: true
      cardinality: one
    tags:
      location: query
      type: string
      required: false
      cardinality: many
    status:
      location: query
      type: string
      required: false
      cardinality: one
```

**Note:** The `yaml` library serialises with `singleQuote: true`. If the runner test fails due to quote differences, copy the normalised actual output verbatim.

- [ ] **Step 4: Write the golden file for `getItemById`**

Create `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/getItemById.yaml`:

```yaml
id: items.APIEndpoint.getItemById
template: APIEndpoint
schemaVersion: '1'
metadata:
  component: items
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:openapi
properties:
  method: GET
  path: /items/{itemId}
  description: Get item by ID
  parameters:
    itemId:
      location: path
      type: uuid
      required: true
      cardinality: one
```

- [ ] **Step 5: Write the golden file for `deleteItem`**

Create `test/fixtures/openapi/expected/params-example/components/items/APIEndpoints/deleteItem.yaml`:

```yaml
id: items.APIEndpoint.deleteItem
template: APIEndpoint
schemaVersion: '1'
metadata:
  component: items
  state: implemented
  stability: unstable
  lastModifiedAt: <date>
  extractedFrom: <spec>
  derivation: determined
  derivedBy: adapter:openapi
properties:
  method: DELETE
  path: /items/{itemId}
  description: Delete item
  parameters:
    itemId:
      location: path
      type: uuid
      required: true
      cardinality: one
    X-Api-Key:
      location: header
      type: string
      required: true
      cardinality: one
```

- [ ] **Step 6: Add the integration test to `test/import/runner.test.ts`**

Append this describe block at the end of the file (before the closing of the module):

```typescript
describe('import runner — params-example.yaml', () => {
  it('maps path, query, and header parameters into endpoint properties', async () => {
    const { graphDir, cleanup } = await runAgainstFixture('params-example.yaml')
    try {
      assertMatchesExpected(graphDir, 'params-example')
    } finally {
      cleanup()
    }
  })
})
```

- [ ] **Step 7: Build and run the new integration test**

```
npm run build && node --test dist/test/import/runner.test.js
```

If the test fails with a YAML content mismatch, open the failing file from `graphDir` (printed in error), normalise `lastModifiedAt` and `extractedFrom`, and update the golden file to match exactly. Re-run until it passes.

- [ ] **Step 8: Run the full test suite**

```
npm test
```

Expected: all tests pass. The suite expects 45 nodes and 38 edges from fixtures — confirm that count is unchanged (the params-example fixture uses a temp dir and does not affect the fixture graph node count).

- [ ] **Step 9: Commit**

```
git add test/fixtures/openapi/specs/params-example.yaml test/fixtures/openapi/expected/params-example/ test/import/runner.test.ts
git commit -m "test: add params-example fixture and golden tests for parameter extraction"
```

---

## Self-review

**Spec coverage:**
- ✅ `parameters` inside `properties` alongside `method`/`path`/`responses` — Task 2
- ✅ Single map keyed by parameter name with `location` field — Task 3
- ✅ Path, query, header locations; cookie skipped — Task 3 (`extractParameters`)
- ✅ `cardinality: many` for array schemas — Task 3
- ✅ Enum-constrained params → `type: string` — Task 3
- ✅ Path-item-level params inherited; operation-level overrides — Task 3 (merge logic)
- ✅ `required` from `parameter.required ?? false` — Task 3
- ✅ Warning diagnostic for unknown types — Task 3
- ✅ Reconcile fix — Task 1
- ✅ `$defs` in template (no cross-file ref, no runtime support needed) — Task 2
- ✅ Golden test fixture covering all three locations — Task 4
- ✅ Unit tests for mapper — Task 3

**No placeholders detected.**

**Type consistency:** `extractParameters` returns `Record<string, unknown> | undefined`; call site checks for `undefined` before assigning to `endpointNode.properties.parameters`. Parameter entry shape `{ location, type, required, cardinality }` is consistent across the function implementation, unit tests, and golden files.
