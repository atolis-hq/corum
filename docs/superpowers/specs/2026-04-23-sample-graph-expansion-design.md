# Sample Graph Expansion Design

**Date:** 2026-04-23
**Branch:** BuildGraphExamples

## Goal

Expand `fixtures/sample-graph` from a single-component proof-of-concept into a richer example that demonstrates read models, domain events, integration events, shared schemas, and cross-component event-driven relationships.

## Components

Three components after expansion (was one):

| Component | Purpose |
|-----------|---------|
| `shared` | Cross-cutting schemas (RFC standards, common contracts) |
| `orders` | Orders bounded context — expanded |
| `payments` | Payments bounded context — new |

---

## Section 1: Shared Component

### `shared.Schema.problem-detail`

Standalone Schema cluster file. Extracted from the inline `problem-detail` block in `create-order.yaml`. All endpoints in all components reference it by global node ID.

**Fields:** `type` (string), `title` (string), `status` (integer), `detail` (string, nullable)
**State:** agreed / stable

**File:** `components/shared/Schemas/problem-detail.yaml`

Referencing endpoints update their response entries from `'#/schemas/problem-detail'` to `shared.Schema.problem-detail`.

---

## Section 2: Orders Component

### Existing changes

- `create-order.yaml` — remove inline `problem-detail` schema; update 400/409 response refs to `shared.Schema.problem-detail`

### New API Endpoints

#### `orders.APIEndpoint.get-order` — GET `/orders/{orderId}`
- Responses: 200 (inline `order-detail-response` schema), 404/400 → `shared.Schema.problem-detail`
- `reads` edge to `orders.ReadModel.order-detail`
- Response schema fields `maps-to` read model fields

#### `orders.APIEndpoint.list-orders` — GET `/orders`
- Responses: 200 (inline `order-summary-response` schema, cardinality many), 400 → `shared.Schema.problem-detail`
- `reads` edge to `orders.ReadModel.order-summary`
- Response schema fields `maps-to` read model fields

#### `orders.APIEndpoint.complete-order` — POST `/orders/{orderId}/complete`
- No request body
- Responses: 200 (inline `order-detail-response` schema), 404/400/409 → `shared.Schema.problem-detail`
- `calls` edge to `orders.DomainModel.order.operations.complete`
- Response schema fields `maps-to` read model fields

### New Read Models

Both derive-from `orders.DomainModel.order`.

#### `orders.ReadModel.order-detail`
- Schema fields: `id`, `customerId`, `status`, `items`, `totalAmount`, `notes`, `createdAt`
- All fields except `createdAt` have `maps-to` edges to the corresponding domain model schema fields

#### `orders.ReadModel.order-summary`
- Schema fields: `id`, `customerId`, `status`, `totalAmount`
- All fields have `maps-to` edges to the corresponding domain model schema fields

### New Domain Events

#### `orders.DomainEvent.order-placed`
- Produced by `orders.DomainModel.order.operations.place`
- Payload schema fields: `orderId`, `customerId`, `totalAmount`

#### `orders.DomainEvent.order-completed`
- Produced by `orders.DomainModel.order.operations.complete`
- Payload schema fields: `orderId`, `customerId`, `totalAmount`

### New Integration Events

#### `orders.IntegrationEvent.order-placed`
- Triggered by `orders.DomainEvent.order-placed`
- Payload schema fields: `orderId`, `customerId`, `totalAmount` — all `maps-to` domain model fields

#### `orders.IntegrationEvent.order-completed`
- Triggered by `orders.DomainEvent.order-completed`
- Payload schema fields: `orderId`, `customerId`, `totalAmount` — all `maps-to` domain model fields

---

## Section 3: Payments Component

### `payments.DomainModel.payment`

Aggregate root for the payments bounded context.

**Schema fields:** `id` (uuid), `orderId` (uuid), `amount` (decimal), `status` (enum), `capturedAt` (datetime, nullable)
**Enum:** `payment-status` — `pending`, `captured`, `failed`
**Operations:** `initiate`, `capture`
**Invariant:** `must-be-pending-to-capture` — a payment can only be captured when status is `pending`

### `payments.APIEndpoint.complete-payment` — POST `/payments/{paymentId}/complete`

- No request body
- Responses: 200 (inline `payment-detail` schema), 404/400/409 → `shared.Schema.problem-detail`
- `calls` edge to `payments.DomainModel.payment.operations.capture`
- Response schema fields `maps-to` payment domain model fields

**Inline `payment-detail` schema fields:** `id`, `orderId`, `amount`, `status`, `capturedAt`

### `payments.DomainEvent.payment-captured`
- Produced by `payments.DomainModel.payment.operations.capture`
- Payload schema fields: `paymentId`, `orderId`, `amount`, `capturedAt`

### `payments.IntegrationEvent.payment-captured`
- Triggered by `payments.DomainEvent.payment-captured`
- Payload schema fields: `paymentId`, `orderId`, `amount`, `capturedAt` — all `maps-to` payment domain model fields
- **Cross-component edge:** `triggers` → `orders.DomainModel.order.operations.complete`

---

## Section 4: Edge Summary

### `edges/orders.edges.yaml` (additions)

| From | Type | To |
|------|------|----|
| `orders.APIEndpoint.create-order` | `calls` | `orders.DomainModel.order.operations.place` |
| `orders.APIEndpoint.get-order` | `reads` | `orders.ReadModel.order-detail` |
| `orders.APIEndpoint.list-orders` | `reads` | `orders.ReadModel.order-summary` |
| `orders.APIEndpoint.complete-order` | `calls` | `orders.DomainModel.order.operations.complete` |
| `orders.ReadModel.order-detail` | `derived-from` | `orders.DomainModel.order` |
| `orders.ReadModel.order-summary` | `derived-from` | `orders.DomainModel.order` |
| `orders.DomainModel.order.operations.place` | `produces` | `orders.DomainEvent.order-placed` |
| `orders.DomainModel.order.operations.complete` | `produces` | `orders.DomainEvent.order-completed` |
| `orders.DomainEvent.order-placed` | `triggers` | `orders.IntegrationEvent.order-placed` |
| `orders.DomainEvent.order-completed` | `triggers` | `orders.IntegrationEvent.order-completed` |

**Field-level maps-to (orders):**

- `order-detail` read model schema fields → corresponding `orders.DomainModel.order.schemas.order` fields (id, customerId, status, items, totalAmount, notes)
- `order-summary` read model schema fields → corresponding domain model fields (id, customerId, status, totalAmount)
- `get-order` / `list-orders` / `complete-order` response schema fields → corresponding read model schema fields
- `order-placed` / `order-completed` integration event payload fields → corresponding domain model fields

### `edges/payments.edges.yaml` (new file)

| From | Type | To |
|------|------|----|
| `payments.APIEndpoint.complete-payment` | `calls` | `payments.DomainModel.payment.operations.capture` |
| `payments.DomainModel.payment.operations.capture` | `produces` | `payments.DomainEvent.payment-captured` |
| `payments.DomainEvent.payment-captured` | `triggers` | `payments.IntegrationEvent.payment-captured` |
| `payments.IntegrationEvent.payment-captured` | `triggers` | `orders.DomainModel.order.operations.complete` |

**Field-level maps-to (payments):**

- `payment-captured` integration event payload fields → corresponding `payments.DomainModel.payment.schemas.payment` fields
- `complete-payment` response schema fields → corresponding payment domain model fields

### `graph.yaml`

Add messaging pack:
```yaml
  - name: messaging
    path: ../../.corum/packs/messaging
```

---

## File Count

**New files:** ~18
**Modified files:** 3 (`create-order.yaml`, `edges/orders.edges.yaml`, `graph.yaml`)

---

## Out of Scope

- No changes to loader, MCP tools, or web UI
- Test expectations (`45 nodes, 38 edges`) will need updating after implementation
- No new template definitions — all concepts use existing pack templates
