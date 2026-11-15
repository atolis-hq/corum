# Sample Graph Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `fixtures/sample-graph` to demonstrate read models, domain/integration events, shared schemas, three new orders endpoints, and a payments component with cross-component event-driven wiring.

**Architecture:** Three components (shared, orders, payments) using only existing pack templates. No new TypeScript source code — changes are YAML cluster/edge files plus test updates. The messaging pack already exists at `.corum/packs/messaging` but is not yet loaded in the fixture graph; it must be added.

**Tech Stack:** YAML (cluster and edge files), TypeScript (test file only), Node.js built-in test runner (`node --test`)

---

## File Map

| Action | Path |
|--------|------|
| Modify | `fixtures/sample-graph/graph.yaml` |
| Modify | `fixtures/sample-graph/components/orders/DomainModels/order.yaml` |
| Modify | `fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml` |
| Create | `fixtures/sample-graph/components/shared/Schemas/problem-detail.yaml` |
| Create | `fixtures/sample-graph/components/orders/ReadModels/order-detail.yaml` |
| Create | `fixtures/sample-graph/components/orders/ReadModels/order-summary.yaml` |
| Create | `fixtures/sample-graph/components/orders/APIEndpoints/get-order.yaml` |
| Create | `fixtures/sample-graph/components/orders/APIEndpoints/list-orders.yaml` |
| Create | `fixtures/sample-graph/components/orders/APIEndpoints/complete-order.yaml` |
| Create | `fixtures/sample-graph/components/orders/DomainEvents/order-placed.yaml` |
| Create | `fixtures/sample-graph/components/orders/DomainEvents/order-completed.yaml` |
| Create | `fixtures/sample-graph/components/orders/IntegrationEvents/order-placed.yaml` |
| Create | `fixtures/sample-graph/components/orders/IntegrationEvents/order-completed.yaml` |
| Create | `fixtures/sample-graph/components/payments/DomainModels/payment.yaml` |
| Create | `fixtures/sample-graph/components/payments/APIEndpoints/complete-payment.yaml` |
| Create | `fixtures/sample-graph/components/payments/DomainEvents/payment-captured.yaml` |
| Create | `fixtures/sample-graph/components/payments/IntegrationEvents/payment-captured.yaml` |
| Modify | `fixtures/sample-graph/edges/orders.edges.yaml` |
| Create | `fixtures/sample-graph/edges/payments.edges.yaml` |
| Modify | `test/loader.test.ts` |

---

## Task 1: Add messaging pack to test harness and graph config

**Files:**
- Modify: `fixtures/sample-graph/graph.yaml`
- Modify: `test/loader.test.ts:18-22`

- [ ] **Step 1: Add messaging pack to `graph.yaml`**

Replace the `templatePacks` block in `fixtures/sample-graph/graph.yaml`:

```yaml
schemaVersion: "1"
description: "Sample graph for core loading proof — orders bounded context"

templatePacks:
  - name: core
    path: ../../.corum/packs/core
  - name: rest
    path: ../../.corum/packs/rest
  - name: domain
    path: ../../.corum/packs/domain
  - name: messaging
    path: ../../.corum/packs/messaging
```

- [ ] **Step 2: Add messaging to `samplePackDirs` in the test**

In `test/loader.test.ts`, replace lines 18–22:

```typescript
const samplePackDirs = [
  path.join(repoRoot, '.corum/packs/core'),
  path.join(repoRoot, '.corum/packs/rest'),
  path.join(repoRoot, '.corum/packs/domain'),
  path.join(repoRoot, '.corum/packs/messaging'),
]
```

Also update the pack loader test at line 30 to verify messaging templates load:

```typescript
it('loads core, rest, domain, and messaging packs from fixture graph.yaml', async () => {
  const diagnostics: Diagnostic[] = []
  const templates = await loadPacks(samplePackDirs, diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0)
  assert.ok(templates.has('DomainModel'), 'DomainModel template loaded')
  assert.ok(templates.has('APIEndpoint'), 'APIEndpoint template loaded')
  assert.ok(templates.has('Field'), 'Field template loaded')
  assert.ok(templates.has('Schema'), 'Schema template loaded')
  assert.ok(templates.has('EnumDefinition'), 'EnumDefinition template loaded')
  assert.ok(templates.has('EnumValue'), 'EnumValue template loaded')
  assert.ok(templates.has('DomainEvent'), 'DomainEvent template loaded')
  assert.ok(templates.has('IntegrationEvent'), 'IntegrationEvent template loaded')
})
```

- [ ] **Step 3: Run tests — must still pass**

```bash
npm test
```

Expected: all tests pass (no new YAML files yet, counts unchanged).

- [ ] **Step 4: Commit**

```bash
git add fixtures/sample-graph/graph.yaml test/loader.test.ts
git commit -m "feat(fixtures): add messaging pack to sample graph and test harness"
```

---

## Task 2: Create shared component — problem-detail schema

**Files:**
- Create: `fixtures/sample-graph/components/shared/Schemas/problem-detail.yaml`
- Modify: `test/loader.test.ts` (add failing assertion first)

- [ ] **Step 1: Add failing test for shared.Schema.problem-detail**

Add this `it()` block inside `describe('cluster loader', ...)` in `test/loader.test.ts`:

```typescript
it('materialises shared.Schema.problem-detail node', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)
  assert.ok(result.nodes.has('shared.Schema.problem-detail'), 'shared problem-detail schema node exists')
  assert.ok(result.nodes.has('shared.Schema.problem-detail.fields.type'), 'type field exists')
  assert.ok(result.nodes.has('shared.Schema.problem-detail.fields.detail'), 'detail field exists')
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test dist/test/loader.test.js 2>&1 | grep -A3 "problem-detail"
```

Expected: FAIL — `shared.Schema.problem-detail` not found.

- [ ] **Step 3: Create the shared Schema cluster file**

Create `fixtures/sample-graph/components/shared/Schemas/problem-detail.yaml`:

```yaml
id: shared.Schema.problem-detail
template: Schema
component: shared
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  description: RFC 7807 problem details error response

fields:
  type:
    type: string
    nullable: false
    cardinality: one
  title:
    type: string
    nullable: false
    cardinality: one
  status:
    type: integer
    nullable: false
    cardinality: one
  detail:
    type: string
    nullable: true
    cardinality: one
```

- [ ] **Step 4: Build and run test to verify it passes**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|problem-detail)"
```

Expected: the new `it()` passes.

- [ ] **Step 5: Commit**

```bash
git add fixtures/sample-graph/components/shared/Schemas/problem-detail.yaml test/loader.test.ts
git commit -m "feat(fixtures): add shared problem-detail schema"
```

---

## Task 3: Update create-order to reference shared problem-detail

**Files:**
- Modify: `fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml`

The existing file has `problem-detail` as an inline schema. Remove it and redirect the 400/409 responses to the global node ID.

- [ ] **Step 1: Update create-order.yaml**

Replace the entire file content (preserving all other schemas and enums):

```yaml
id: orders.APIEndpoint.create-order
template: APIEndpoint
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-17"

properties:
  method: POST
  path: /orders
  request: '#/schemas/create-order-request'
  responses:
    "201": '#/schemas/create-order-response'
    "400": shared.Schema.problem-detail
    "409": shared.Schema.problem-detail

schemas:
  create-order-request:
    description: Request body for creating an order
    fields:
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      notes:
        type: string
        nullable: true
        cardinality: one

  order-line-item:
    description: A single line item within the order
    fields:
      productId:
        type: uuid
        nullable: false
        cardinality: one
      quantity:
        type: integer
        nullable: false
        cardinality: one
      unitPrice:
        state: draft
        type: decimal
        nullable: false
        cardinality: one

  create-order-response:
    description: Confirmed order details returned on successful creation
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: '#/enums/order-status'
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one

enums:
  order-status:
    description: Lifecycle state of an order as visible to API consumers
    values:
      pending:
        name: PENDING
        description: Order received, awaiting processing
      confirmed:
        name: CONFIRMED
        description: Order accepted and confirmed by the system
      cancelled:
        name: CANCELLED
        description: Order cancelled before fulfilment
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && npm test
```

Expected: all tests pass. The node count drops by 5 (problem-detail schema + 4 fields removed from create-order) but the shared Schema adds 5 back — net zero change. The has-field count stays at 24 (4 fields removed from create-order inline, 4 added from shared.Schema.problem-detail).

- [ ] **Step 3: Commit**

```bash
git add fixtures/sample-graph/components/orders/APIEndpoints/create-order.yaml
git commit -m "feat(fixtures): extract problem-detail to shared component"
```

---

## Task 4: Extend orders domain model — add complete operation and completed status

The complete-order endpoint and payment event both target a `complete` operation on the order aggregate. The `order-status` enum also needs a `completed` value.

**Files:**
- Modify: `fixtures/sample-graph/components/orders/DomainModels/order.yaml`
- Modify: `test/loader.test.ts` (add failing assertion)

- [ ] **Step 1: Add failing test**

Add inside `describe('cluster loader', ...)` in `test/loader.test.ts`:

```typescript
it('materialises orders.DomainModel.order.operations.complete node', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)
  assert.ok(
    result.nodes.has('orders.DomainModel.order.operations.complete'),
    'complete operation node exists',
  )
  assert.ok(
    result.nodes.has('orders.DomainModel.order.enums.order-status.values.completed'),
    'completed enum value exists',
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A3 "operations.complete"
```

Expected: FAIL.

- [ ] **Step 3: Add `complete` operation and `completed` enum value to order.yaml**

In `fixtures/sample-graph/components/orders/DomainModels/order.yaml`, add `completed` to the `order-status` enum and add the `complete` operation:

```yaml
id: orders.DomainModel.order
template: DomainModel
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  description: A placed customer order; aggregate root for the orders bounded context
  schema: '#/schemas/order'

schemas:
  order:
    description: Structure of the order aggregate
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: '#/enums/order-status'
        nullable: false
        cardinality: one
      items:
        $ref: '#/schemas/order-line-item'
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
      notes:
        type: string
        nullable: true
        cardinality: one

  order-line-item:
    description: A single line item within the order
    fields:
      productId:
        type: uuid
        nullable: false
        cardinality: one
      quantity:
        type: integer
        nullable: false
        cardinality: one
      unitPrice:
        state: proposed
        type: decimal
        nullable: false
        cardinality: one

enums:
  order-status:
    description: Lifecycle state of an order within the domain
    values:
      pending:
        name: PENDING
        description: Order received, awaiting processing
      confirmed:
        name: CONFIRMED
        description: Order accepted and confirmed
      completed:
        name: COMPLETED
        description: Order fulfilled following successful payment capture
      cancelled:
        name: CANCELLED
        description: Order cancelled before fulfilment

invariants:
  must-have-items:
    description: An order must contain at least one line item at all times
  total-matches-items:
    description: totalAmount must equal the sum of (quantity × unitPrice) across all items

operations:
  place:
    description: Create a new order from validated customer intent
  confirm:
    description: Mark the order as confirmed by the fulfilment system
  complete:
    description: Mark the order as fully completed following successful payment capture
  cancel:
    state: proposed
    description: Cancel an in-progress order, returning reserved stock
```

- [ ] **Step 4: Build and run the new test**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|complete)"
```

Expected: new test passes.

- [ ] **Step 5: Update the node count assertion (line 79)**

The count increases by 2: `operations.complete` and `enums.order-status.values.completed`. Change the assertion:

```typescript
assert.equal(result.nodes.size, 47, `expected 47 nodes, got ${result.nodes.size}`)
```

Also update `has-value` assertion (line 91) — now 7 has-value edges (was 6, added `completed` value):

```typescript
assert.equal(hasValueEdges.length, 7, `expected 7 has-value edges, got ${hasValueEdges.length}`)
```

Also update `loadGraph` node count (line 183):

```typescript
assert.equal(graph.nodesById.size, 47, `expected 47 nodes, got ${graph.nodesById.size}`)
```

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add fixtures/sample-graph/components/orders/DomainModels/order.yaml test/loader.test.ts
git commit -m "feat(fixtures): add complete operation and completed status to order domain model"
```

---

## Task 5: Add orders read models

**Files:**
- Create: `fixtures/sample-graph/components/orders/ReadModels/order-detail.yaml`
- Create: `fixtures/sample-graph/components/orders/ReadModels/order-summary.yaml`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add failing tests**

Add inside `describe('cluster loader', ...)`:

```typescript
it('materialises orders read model nodes', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, `errors: ${JSON.stringify(diagnostics)}`)
  assert.ok(result.nodes.has('orders.ReadModel.order-detail'), 'order-detail read model exists')
  assert.ok(result.nodes.has('orders.ReadModel.order-detail.schemas.order-detail.fields.id'), 'order-detail id field')
  assert.ok(result.nodes.has('orders.ReadModel.order-detail.schemas.order-detail.fields.createdAt'), 'order-detail createdAt field')
  assert.ok(result.nodes.has('orders.ReadModel.order-summary'), 'order-summary read model exists')
  assert.ok(result.nodes.has('orders.ReadModel.order-summary.schemas.order-summary.fields.totalAmount'), 'order-summary totalAmount field')
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A3 "read model"
```

Expected: FAIL.

- [ ] **Step 3: Create order-detail.yaml**

Create `fixtures/sample-graph/components/orders/ReadModels/order-detail.yaml`:

```yaml
id: orders.ReadModel.order-detail
template: ReadModel
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-detail:
    description: Full order view for single-order queries
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: orders.DomainModel.order.enums.order-status
        nullable: false
        cardinality: one
      items:
        $ref: orders.DomainModel.order.schemas.order-line-item
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
      notes:
        type: string
        nullable: true
        cardinality: one
      createdAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 4: Create order-summary.yaml**

Create `fixtures/sample-graph/components/orders/ReadModels/order-summary.yaml`:

```yaml
id: orders.ReadModel.order-summary
template: ReadModel
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-summary:
    description: Lightweight order view for list queries
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: orders.DomainModel.order.enums.order-status
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 5: Build and run the new test**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|read model)"
```

Expected: new test passes.

- [ ] **Step 6: Update count assertions**

New nodes: order-detail (1 root + 1 schema + 7 fields = 9) + order-summary (1 root + 1 schema + 4 fields = 6) = +15 nodes. New has-field edges: +7 +4 = +11.

Update `test/loader.test.ts`:
- Node count (line 79): `47 + 15 = 62` → `assert.equal(result.nodes.size, 62, ...)`
- has-field count (line 90): `24 + 11 = 35` → `assert.equal(hasFieldEdges.length, 35, ...)`
- loadGraph node count (line 183): `assert.equal(graph.nodesById.size, 62, ...)`

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add fixtures/sample-graph/components/orders/ReadModels/ test/loader.test.ts
git commit -m "feat(fixtures): add order-detail and order-summary read models"
```

---

## Task 6: Add orders endpoints — get-order, list-orders, complete-order

**Files:**
- Create: `fixtures/sample-graph/components/orders/APIEndpoints/get-order.yaml`
- Create: `fixtures/sample-graph/components/orders/APIEndpoints/list-orders.yaml`
- Create: `fixtures/sample-graph/components/orders/APIEndpoints/complete-order.yaml`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add failing test**

Add inside `describe('cluster loader', ...)`:

```typescript
it('materialises new orders endpoint nodes', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, `errors: ${JSON.stringify(diagnostics)}`)
  assert.ok(result.nodes.has('orders.APIEndpoint.get-order'), 'get-order endpoint exists')
  assert.ok(result.nodes.has('orders.APIEndpoint.get-order.schemas.order-response.fields.createdAt'), 'createdAt field on get-order response')
  assert.ok(result.nodes.has('orders.APIEndpoint.list-orders'), 'list-orders endpoint exists')
  assert.ok(result.nodes.has('orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.totalAmount'), 'totalAmount on list-orders response')
  assert.ok(result.nodes.has('orders.APIEndpoint.complete-order'), 'complete-order endpoint exists')
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A3 "orders endpoint"
```

Expected: FAIL.

- [ ] **Step 3: Create get-order.yaml**

Create `fixtures/sample-graph/components/orders/APIEndpoints/get-order.yaml`:

```yaml
id: orders.APIEndpoint.get-order
template: APIEndpoint
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  method: GET
  path: /orders/{orderId}
  responses:
    "200": '#/schemas/order-response'
    "400": shared.Schema.problem-detail
    "404": shared.Schema.problem-detail

schemas:
  order-response:
    description: Full order details for a single-order query
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: orders.DomainModel.order.enums.order-status
        nullable: false
        cardinality: one
      items:
        $ref: orders.DomainModel.order.schemas.order-line-item
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
      notes:
        type: string
        nullable: true
        cardinality: one
      createdAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 4: Create list-orders.yaml**

Create `fixtures/sample-graph/components/orders/APIEndpoints/list-orders.yaml`:

```yaml
id: orders.APIEndpoint.list-orders
template: APIEndpoint
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  method: GET
  path: /orders
  responses:
    "200": '#/schemas/order-summary-response'
    "400": shared.Schema.problem-detail

schemas:
  order-summary-response:
    description: Lightweight order summary for list queries
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: orders.DomainModel.order.enums.order-status
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 5: Create complete-order.yaml**

Create `fixtures/sample-graph/components/orders/APIEndpoints/complete-order.yaml`:

```yaml
id: orders.APIEndpoint.complete-order
template: APIEndpoint
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  method: POST
  path: /orders/{orderId}/complete
  responses:
    "200": '#/schemas/order-response'
    "400": shared.Schema.problem-detail
    "404": shared.Schema.problem-detail
    "409": shared.Schema.problem-detail

schemas:
  order-response:
    description: Updated order details after completion
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      status:
        $ref: orders.DomainModel.order.enums.order-status
        nullable: false
        cardinality: one
      items:
        $ref: orders.DomainModel.order.schemas.order-line-item
        nullable: false
        cardinality: many
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
      notes:
        type: string
        nullable: true
        cardinality: one
      createdAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 6: Build and run the new test**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|endpoint)"
```

Expected: new test passes.

- [ ] **Step 7: Update count assertions**

New nodes: get-order (1+1+7=9) + list-orders (1+1+4=6) + complete-order (1+1+7=9) = +24. New has-field: +7+4+7 = +18.

Update `test/loader.test.ts`:
- Node count: `62 + 24 = 86` → `assert.equal(result.nodes.size, 86, ...)`
- has-field count: `35 + 18 = 53` → `assert.equal(hasFieldEdges.length, 53, ...)`
- loadGraph node count: `assert.equal(graph.nodesById.size, 86, ...)`

- [ ] **Step 8: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add fixtures/sample-graph/components/orders/APIEndpoints/ test/loader.test.ts
git commit -m "feat(fixtures): add get-order, list-orders, and complete-order endpoints"
```

---

## Task 7: Add orders domain and integration events

**Files:**
- Create: `fixtures/sample-graph/components/orders/DomainEvents/order-placed.yaml`
- Create: `fixtures/sample-graph/components/orders/DomainEvents/order-completed.yaml`
- Create: `fixtures/sample-graph/components/orders/IntegrationEvents/order-placed.yaml`
- Create: `fixtures/sample-graph/components/orders/IntegrationEvents/order-completed.yaml`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add failing test**

Add inside `describe('cluster loader', ...)`:

```typescript
it('materialises orders domain and integration event nodes', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, `errors: ${JSON.stringify(diagnostics)}`)
  assert.ok(result.nodes.has('orders.DomainEvent.order-placed'), 'order-placed domain event')
  assert.ok(result.nodes.has('orders.DomainEvent.order-placed.schemas.order-placed-payload.fields.orderId'), 'orderId field on order-placed payload')
  assert.ok(result.nodes.has('orders.DomainEvent.order-completed'), 'order-completed domain event')
  assert.ok(result.nodes.has('orders.IntegrationEvent.order-placed'), 'order-placed integration event')
  assert.ok(result.nodes.has('orders.IntegrationEvent.order-completed'), 'order-completed integration event')
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A3 "event nodes"
```

Expected: FAIL.

- [ ] **Step 3: Create orders/DomainEvents/order-placed.yaml**

```yaml
id: orders.DomainEvent.order-placed
template: DomainEvent
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-placed-payload:
    description: Payload carried by the order-placed domain event
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 4: Create orders/DomainEvents/order-completed.yaml**

```yaml
id: orders.DomainEvent.order-completed
template: DomainEvent
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-completed-payload:
    description: Payload carried by the order-completed domain event
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 5: Create orders/IntegrationEvents/order-placed.yaml**

```yaml
id: orders.IntegrationEvent.order-placed
template: IntegrationEvent
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-placed-payload:
    description: Cross-context payload for the order-placed integration event
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 6: Create orders/IntegrationEvents/order-completed.yaml**

```yaml
id: orders.IntegrationEvent.order-completed
template: IntegrationEvent
component: orders
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  order-completed-payload:
    description: Cross-context payload for the order-completed integration event
    fields:
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      customerId:
        type: uuid
        nullable: false
        cardinality: one
      totalAmount:
        type: decimal
        nullable: false
        cardinality: one
```

- [ ] **Step 7: Build and run new test**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|event)"
```

Expected: new test passes.

- [ ] **Step 8: Update count assertions**

New nodes: 4 events × (1 root + 1 schema + 3 fields) = 4 × 5 = +20. New has-field: 4 × 3 = +12.

Update `test/loader.test.ts`:
- Node count: `86 + 20 = 106` → `assert.equal(result.nodes.size, 106, ...)`
- has-field count: `53 + 12 = 65` → `assert.equal(hasFieldEdges.length, 65, ...)`
- loadGraph node count: `assert.equal(graph.nodesById.size, 106, ...)`

- [ ] **Step 9: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add fixtures/sample-graph/components/orders/DomainEvents/ fixtures/sample-graph/components/orders/IntegrationEvents/ test/loader.test.ts
git commit -m "feat(fixtures): add orders domain and integration events"
```

---

## Task 8: Add payments component — domain model, endpoint, and events

**Files:**
- Create: `fixtures/sample-graph/components/payments/DomainModels/payment.yaml`
- Create: `fixtures/sample-graph/components/payments/APIEndpoints/complete-payment.yaml`
- Create: `fixtures/sample-graph/components/payments/DomainEvents/payment-captured.yaml`
- Create: `fixtures/sample-graph/components/payments/IntegrationEvents/payment-captured.yaml`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Add failing test**

Add inside `describe('cluster loader', ...)`:

```typescript
it('materialises payments component nodes', async () => {
  const diagnostics: Diagnostic[] = []
  const result = await loadSampleClusters(diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, `errors: ${JSON.stringify(diagnostics)}`)
  assert.ok(result.nodes.has('payments.DomainModel.payment'), 'payment domain model')
  assert.ok(result.nodes.has('payments.DomainModel.payment.schemas.payment.fields.capturedAt'), 'capturedAt field')
  assert.ok(result.nodes.has('payments.DomainModel.payment.enums.payment-status'), 'payment-status enum')
  assert.ok(result.nodes.has('payments.DomainModel.payment.operations.capture'), 'capture operation')
  assert.ok(result.nodes.has('payments.APIEndpoint.complete-payment'), 'complete-payment endpoint')
  assert.ok(result.nodes.has('payments.DomainEvent.payment-captured'), 'payment-captured domain event')
  assert.ok(result.nodes.has('payments.IntegrationEvent.payment-captured'), 'payment-captured integration event')
  assert.ok(result.nodes.has('payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.paymentId'), 'paymentId in integration event payload')
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -A3 "payments component"
```

Expected: FAIL.

- [ ] **Step 3: Create payments/DomainModels/payment.yaml**

```yaml
id: payments.DomainModel.payment
template: DomainModel
component: payments
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  description: A payment record capturing the financial transaction for an order
  schema: '#/schemas/payment'

schemas:
  payment:
    description: Structure of the payment aggregate
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      amount:
        type: decimal
        nullable: false
        cardinality: one
      status:
        $ref: '#/enums/payment-status'
        nullable: false
        cardinality: one
      capturedAt:
        type: datetime
        nullable: true
        cardinality: one

enums:
  payment-status:
    description: Lifecycle state of a payment
    values:
      pending:
        name: PENDING
        description: Payment initiated but not yet captured
      captured:
        name: CAPTURED
        description: Payment successfully captured
      failed:
        name: FAILED
        description: Payment capture failed

invariants:
  must-be-pending-to-capture:
    description: A payment can only be captured when its status is PENDING

operations:
  initiate:
    description: Create a new payment record for an order
  capture:
    description: Complete the payment capture; transitions status to CAPTURED
```

- [ ] **Step 4: Create payments/APIEndpoints/complete-payment.yaml**

```yaml
id: payments.APIEndpoint.complete-payment
template: APIEndpoint
component: payments
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

properties:
  method: POST
  path: /payments/{paymentId}/complete
  responses:
    "200": '#/schemas/payment-response'
    "400": shared.Schema.problem-detail
    "404": shared.Schema.problem-detail
    "409": shared.Schema.problem-detail

schemas:
  payment-response:
    description: Payment details returned after successful capture
    fields:
      id:
        type: uuid
        nullable: false
        cardinality: one
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      amount:
        type: decimal
        nullable: false
        cardinality: one
      status:
        $ref: payments.DomainModel.payment.enums.payment-status
        nullable: false
        cardinality: one
      capturedAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 5: Create payments/DomainEvents/payment-captured.yaml**

```yaml
id: payments.DomainEvent.payment-captured
template: DomainEvent
component: payments
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  payment-captured-payload:
    description: Payload carried by the payment-captured domain event
    fields:
      paymentId:
        type: uuid
        nullable: false
        cardinality: one
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      amount:
        type: decimal
        nullable: false
        cardinality: one
      capturedAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 6: Create payments/IntegrationEvents/payment-captured.yaml**

```yaml
id: payments.IntegrationEvent.payment-captured
template: IntegrationEvent
component: payments
state: agreed
stability: stable
schemaVersion: "1"
lastModifiedAt: "2026-04-23"

schemas:
  payment-captured-payload:
    description: Cross-context payload for the payment-captured integration event
    fields:
      paymentId:
        type: uuid
        nullable: false
        cardinality: one
      orderId:
        type: uuid
        nullable: false
        cardinality: one
      amount:
        type: decimal
        nullable: false
        cardinality: one
      capturedAt:
        type: datetime
        nullable: false
        cardinality: one
```

- [ ] **Step 7: Build and run the new test**

```bash
npm run build && node --test dist/test/loader.test.js 2>&1 | grep -E "(pass|fail|payments)"
```

Expected: new test passes.

- [ ] **Step 8: Update count assertions**

New nodes:
- payment DomainModel: 1 root + 1 schema + 5 fields + 1 enum + 3 values + 1 invariant + 2 operations = 14
- complete-payment endpoint: 1 root + 1 schema + 5 fields = 7
- payment-captured DomainEvent: 1 root + 1 schema + 4 fields = 6
- payment-captured IntegrationEvent: 1 root + 1 schema + 4 fields = 6
- Total: +33

New has-field edges: 5 (payment schema) + 5 (endpoint response) + 4 (domain event) + 4 (integration event) = +18
New has-value edges: 3 (payment-status: pending, captured, failed) = +3

Update `test/loader.test.ts`:
- Node count: `106 + 33 = 139` → `assert.equal(result.nodes.size, 139, ...)`
- has-field count: `65 + 18 = 83` → `assert.equal(hasFieldEdges.length, 83, ...)`
- has-value count: `7 + 3 = 10` → `assert.equal(hasValueEdges.length, 10, ...)`
- loadGraph node count: `assert.equal(graph.nodesById.size, 139, ...)`

- [ ] **Step 9: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 10: Commit**

```bash
git add fixtures/sample-graph/components/payments/ test/loader.test.ts
git commit -m "feat(fixtures): add payments component with domain model, endpoint, and events"
```

---

## Task 9: Wire orders edges

**Files:**
- Modify: `fixtures/sample-graph/edges/orders.edges.yaml`

Replace the full content of `fixtures/sample-graph/edges/orders.edges.yaml`:

- [ ] **Step 1: Write the updated orders.edges.yaml**

```yaml
edges:
  # -------------------------------------------------------------------------
  # Endpoint → domain model / operations
  # -------------------------------------------------------------------------
  - from: orders.APIEndpoint.create-order
    to: orders.DomainModel.order
    type: reads
    notes: POST /orders creates and returns an Order aggregate

  - from: orders.APIEndpoint.create-order
    to: orders.DomainModel.order.operations.place
    type: calls

  - from: orders.APIEndpoint.get-order
    to: orders.ReadModel.order-detail
    type: reads

  - from: orders.APIEndpoint.list-orders
    to: orders.ReadModel.order-summary
    type: reads

  - from: orders.APIEndpoint.complete-order
    to: orders.DomainModel.order.operations.complete
    type: calls

  # -------------------------------------------------------------------------
  # Read model provenance
  # -------------------------------------------------------------------------
  - from: orders.ReadModel.order-detail
    to: orders.DomainModel.order
    type: derived-from

  - from: orders.ReadModel.order-summary
    to: orders.DomainModel.order
    type: derived-from

  # -------------------------------------------------------------------------
  # Event chain
  # -------------------------------------------------------------------------
  - from: orders.DomainModel.order.operations.place
    to: orders.DomainEvent.order-placed
    type: produces

  - from: orders.DomainModel.order.operations.complete
    to: orders.DomainEvent.order-completed
    type: produces

  - from: orders.DomainEvent.order-placed
    to: orders.IntegrationEvent.order-placed
    type: triggers

  - from: orders.DomainEvent.order-completed
    to: orders.IntegrationEvent.order-completed
    type: triggers

  # -------------------------------------------------------------------------
  # create-order response → domain model (existing field-level mappings)
  # -------------------------------------------------------------------------
  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.orderId
    to: orders.DomainModel.order.schemas.order.fields.id
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.status
    to: orders.DomainModel.order.schemas.order.fields.status
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.totalAmount
    to: orders.DomainModel.order.schemas.order.fields.totalAmount
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-response.fields.items
    to: orders.DomainModel.order.schemas.order.fields.items
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-request.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.APIEndpoint.create-order.schemas.create-order-request.fields.notes
    to: orders.DomainModel.order.schemas.order.fields.notes
    type: maps-to

  # -------------------------------------------------------------------------
  # order-detail read model → domain model fields
  # -------------------------------------------------------------------------
  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.id
    to: orders.DomainModel.order.schemas.order.fields.id
    type: maps-to

  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.status
    to: orders.DomainModel.order.schemas.order.fields.status
    type: maps-to

  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.items
    to: orders.DomainModel.order.schemas.order.fields.items
    type: maps-to

  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.totalAmount
    to: orders.DomainModel.order.schemas.order.fields.totalAmount
    type: maps-to

  - from: orders.ReadModel.order-detail.schemas.order-detail.fields.notes
    to: orders.DomainModel.order.schemas.order.fields.notes
    type: maps-to

  # -------------------------------------------------------------------------
  # order-summary read model → domain model fields
  # -------------------------------------------------------------------------
  - from: orders.ReadModel.order-summary.schemas.order-summary.fields.id
    to: orders.DomainModel.order.schemas.order.fields.id
    type: maps-to

  - from: orders.ReadModel.order-summary.schemas.order-summary.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.ReadModel.order-summary.schemas.order-summary.fields.status
    to: orders.DomainModel.order.schemas.order.fields.status
    type: maps-to

  - from: orders.ReadModel.order-summary.schemas.order-summary.fields.totalAmount
    to: orders.DomainModel.order.schemas.order.fields.totalAmount
    type: maps-to

  # -------------------------------------------------------------------------
  # get-order response → order-detail read model fields
  # -------------------------------------------------------------------------
  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.orderId
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.id
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.customerId
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.customerId
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.status
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.status
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.items
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.items
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.totalAmount
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.totalAmount
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.notes
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.notes
    type: maps-to

  - from: orders.APIEndpoint.get-order.schemas.order-response.fields.createdAt
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.createdAt
    type: maps-to

  # -------------------------------------------------------------------------
  # list-orders response → order-summary read model fields
  # -------------------------------------------------------------------------
  - from: orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.orderId
    to: orders.ReadModel.order-summary.schemas.order-summary.fields.id
    type: maps-to

  - from: orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.customerId
    to: orders.ReadModel.order-summary.schemas.order-summary.fields.customerId
    type: maps-to

  - from: orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.status
    to: orders.ReadModel.order-summary.schemas.order-summary.fields.status
    type: maps-to

  - from: orders.APIEndpoint.list-orders.schemas.order-summary-response.fields.totalAmount
    to: orders.ReadModel.order-summary.schemas.order-summary.fields.totalAmount
    type: maps-to

  # -------------------------------------------------------------------------
  # complete-order response → order-detail read model fields
  # -------------------------------------------------------------------------
  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.orderId
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.id
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.customerId
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.customerId
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.status
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.status
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.items
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.items
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.totalAmount
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.totalAmount
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.notes
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.notes
    type: maps-to

  - from: orders.APIEndpoint.complete-order.schemas.order-response.fields.createdAt
    to: orders.ReadModel.order-detail.schemas.order-detail.fields.createdAt
    type: maps-to

  # -------------------------------------------------------------------------
  # order-placed integration event → domain model fields
  # -------------------------------------------------------------------------
  - from: orders.IntegrationEvent.order-placed.schemas.order-placed-payload.fields.orderId
    to: orders.DomainModel.order.schemas.order.fields.id
    type: maps-to

  - from: orders.IntegrationEvent.order-placed.schemas.order-placed-payload.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.IntegrationEvent.order-placed.schemas.order-placed-payload.fields.totalAmount
    to: orders.DomainModel.order.schemas.order.fields.totalAmount
    type: maps-to

  # -------------------------------------------------------------------------
  # order-completed integration event → domain model fields
  # -------------------------------------------------------------------------
  - from: orders.IntegrationEvent.order-completed.schemas.order-completed-payload.fields.orderId
    to: orders.DomainModel.order.schemas.order.fields.id
    type: maps-to

  - from: orders.IntegrationEvent.order-completed.schemas.order-completed-payload.fields.customerId
    to: orders.DomainModel.order.schemas.order.fields.customerId
    type: maps-to

  - from: orders.IntegrationEvent.order-completed.schemas.order-completed-payload.fields.totalAmount
    to: orders.DomainModel.order.schemas.order.fields.totalAmount
    type: maps-to
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && npm test
```

The edge count will increase. The test currently expects 8 explicit edges (orders.edges.yaml has 52 now) and the total edge count has changed. The tests for explicit edge count (line 143) and total edges (line 184) will fail with actual counts printed. Read the output and proceed to the next step.

- [ ] **Step 3: Update edge count assertions**

The `loadEdges` test at line 143 checks only orders.edges.yaml (no payments file yet):

```typescript
it('loads 52 explicit edges from orders.edges.yaml', async () => {
  ...
  assert.equal(allExplicitEdges.length, 52, `expected 52 explicit edges, got ${allExplicitEdges.length}`)
})
```

Also update the test description from "8 explicit edges from orders.edges.yaml" to "52 explicit edges from orders.edges.yaml".

The `loadGraph` total edge count at line 184 now = structural (83 has-field + 10 has-value = 93) + explicit (52 orders) + any auto-generated reads edges from global node refs. Run the test to get the actual number and update:

```bash
npm run build && npm test 2>&1 | grep "expected.*edges"
```

Use the actual count reported in the error message to update line 184:

```typescript
assert.equal(allEdges.length, <ACTUAL>, `expected <ACTUAL> edges, got ${allEdges.length}`)
```

- [ ] **Step 4: Run full suite**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add fixtures/sample-graph/edges/orders.edges.yaml test/loader.test.ts
git commit -m "feat(fixtures): wire orders edges — read models, events, operations, field-level maps-to"
```

---

## Task 10: Wire payments edges and finalize counts

**Files:**
- Create: `fixtures/sample-graph/edges/payments.edges.yaml`
- Modify: `test/loader.test.ts`

- [ ] **Step 1: Create payments.edges.yaml**

Create `fixtures/sample-graph/edges/payments.edges.yaml`:

```yaml
edges:
  # -------------------------------------------------------------------------
  # Endpoint → domain model operation
  # -------------------------------------------------------------------------
  - from: payments.APIEndpoint.complete-payment
    to: payments.DomainModel.payment.operations.capture
    type: calls

  # -------------------------------------------------------------------------
  # Event chain
  # -------------------------------------------------------------------------
  - from: payments.DomainModel.payment.operations.capture
    to: payments.DomainEvent.payment-captured
    type: produces

  - from: payments.DomainEvent.payment-captured
    to: payments.IntegrationEvent.payment-captured
    type: triggers

  # -------------------------------------------------------------------------
  # Cross-component: payment captured triggers order completion
  # -------------------------------------------------------------------------
  - from: payments.IntegrationEvent.payment-captured
    to: orders.DomainModel.order.operations.complete
    type: triggers

  # -------------------------------------------------------------------------
  # payment-captured integration event → payment domain model fields
  # -------------------------------------------------------------------------
  - from: payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.paymentId
    to: payments.DomainModel.payment.schemas.payment.fields.id
    type: maps-to

  - from: payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.orderId
    to: payments.DomainModel.payment.schemas.payment.fields.orderId
    type: maps-to

  - from: payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.amount
    to: payments.DomainModel.payment.schemas.payment.fields.amount
    type: maps-to

  - from: payments.IntegrationEvent.payment-captured.schemas.payment-captured-payload.fields.capturedAt
    to: payments.DomainModel.payment.schemas.payment.fields.capturedAt
    type: maps-to

  # -------------------------------------------------------------------------
  # complete-payment response → payment domain model fields
  # -------------------------------------------------------------------------
  - from: payments.APIEndpoint.complete-payment.schemas.payment-response.fields.id
    to: payments.DomainModel.payment.schemas.payment.fields.id
    type: maps-to

  - from: payments.APIEndpoint.complete-payment.schemas.payment-response.fields.orderId
    to: payments.DomainModel.payment.schemas.payment.fields.orderId
    type: maps-to

  - from: payments.APIEndpoint.complete-payment.schemas.payment-response.fields.amount
    to: payments.DomainModel.payment.schemas.payment.fields.amount
    type: maps-to

  - from: payments.APIEndpoint.complete-payment.schemas.payment-response.fields.status
    to: payments.DomainModel.payment.schemas.payment.fields.status
    type: maps-to

  - from: payments.APIEndpoint.complete-payment.schemas.payment-response.fields.capturedAt
    to: payments.DomainModel.payment.schemas.payment.fields.capturedAt
    type: maps-to
```

- [ ] **Step 2: Build and run tests**

```bash
npm run build && npm test 2>&1 | grep "expected"
```

The explicit edge count test (line 143) will fail — it only covers orders.edges.yaml. The loadGraph total edge test (line 184) will also show the new total. Read the output.

- [ ] **Step 3: Update the explicit edge count test**

The test at line 143 loads `edges/` which now includes both files. Update description and assertion to match the combined count (52 orders + 13 payments = 65):

```typescript
it('loads 65 explicit edges from edge files', async () => {
  const diagnostics: Diagnostic[] = []
  const clusters = await loadSampleClusters(diagnostics)
  const edgeResult = await loadEdges(fixtureGraphDir, clusters.nodes, diagnostics)

  assert.equal(diagnostics.filter(d => d.severity === 'error').length, 0, `unexpected errors: ${JSON.stringify(diagnostics)}`)
  const allExplicitEdges = [...edgeResult.edgesByFrom.values()].flat()
  assert.equal(allExplicitEdges.length, 65, `expected 65 explicit edges, got ${allExplicitEdges.length}`)
})
```

- [ ] **Step 4: Update the loadGraph total edge count**

Run:

```bash
npm run build && npm test 2>&1 | grep "expected.*edges, got"
```

Take the actual count from the error output and update the assertion at line 184 to match.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all pass with zero errors.

- [ ] **Step 6: Commit**

```bash
git add fixtures/sample-graph/edges/payments.edges.yaml test/loader.test.ts
git commit -m "feat(fixtures): add payments edges with cross-component payment-captured trigger"
```

---

## Self-Review Notes

- All node IDs in edge files must exactly match the IDs materialised by the cluster loader. If any edge fails to resolve, the loader will report a diagnostic error and the `loadGraph` test will fail. The TDD approach (test first) surfaces these mismatches immediately.
- The `createdAt` field on read models has no counterpart in the domain model — this is intentional (read models surface persistence fields). No `maps-to` edge is declared for it.
- The `completed` enum value is only on the domain model's `order-status`, not on the APIEndpoint's local copy in `create-order.yaml` — new endpoints reference the domain model's enum globally via `$ref: orders.DomainModel.order.enums.order-status`.
- Node/edge counts in Tasks 5–10 are computed from the template structures. If the loader materialises nodes differently (e.g. auto-generates reads edges from global `$ref` fields), the empirical counts from the test output take precedence — use those to update assertions.
