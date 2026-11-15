# AsyncAPI Importer — Design Spec

**Status:** Proposed
**Date:** 2026-06-22
**Implements:** ADR-009 (Importer Architecture) — in-process `SpecAdapter` front door
**Depends on:** ADR-003b (data model + `derivation`), ADR-009 (importer architecture), 2026-06-18-openapi-importer-design.md (patterns reused)
**Extends:** `messaging` pack (`Event`, `DomainEvent`, `IntegrationEvent` templates)

---

## 1. Scope

This document specifies the AsyncAPI importer — the second in-process `SpecAdapter` in Corum, following the OpenAPI importer. It covers:

- Project structure and where new code lives
- Library choice and version support
- Import config format, shared `FieldStrategy` type, and CLI
- Pack adapter config for the `messaging` pack
- AsyncAPI → Corum node mapping
- ID derivation and message naming
- Schema counting and shared schema promotion
- Event template additions (`topic`, `description`, `headers`); removal of `correlationId` (now represented as a header)
- Testing strategy and done criteria
- Known gaps

It does not re-specify the reconcile pipeline (unchanged from OpenAPI), the `SpecAdapter` interface (unchanged), or the graph writer (unchanged).

---

## 2. Library

**`@asyncapi/parser` v3** — the official AsyncAPI parser. Handles both AsyncAPI v2.x and v3.0 documents through a single unified `AsyncAPIDocumentInterface`. The v2 `publish`/`subscribe` model is normalised to `isSend()`/`isReceive()` — no separate mapping paths needed.

Key interfaces used:

```typescript
document.allOperations()           // OperationInterface[] — works for v2 and v3
operation.channels()               // ChannelsInterface — channel(s) for this operation
operation.messages()               // MessagesInterface — messages carried
operation.isSend() / isReceive()   // normalised direction
message.name()                     // string | undefined — the message name: field
message.id()                       // string — component map key or parser-generated
message.payload()                  // SchemaInterface | undefined
message.headers()                  // SchemaInterface | undefined
```

**Supported versions:** AsyncAPI 2.x (2.0–2.6) and 3.0, detected and normalised by the parser.

---

## 3. Architecture overview

Three new files mirroring the OpenAPI adapter layout:

```
src/
  adapters/
    asyncapi/
      index.ts    AsyncAPIAdapter (implements SpecAdapter<AsyncAPIImportEntry>)
      parser.ts   @asyncapi/parser wrapper
      mapper.ts   AsyncAPI document → Node[]/Edge[]
```

New pack adapter config:

```
.corum/packs/messaging/adapters/asyncapi.yaml
```

Template additions (see §7): `topic`, `description`, and `headers` properties added to `.corum/packs/messaging/templates/Event.yaml`, inherited by `DomainEvent` and `IntegrationEvent`. `correlationId` removed — it is message-level transport metadata, not a payload field; teams should model it in `headers` instead.

**Pipeline** (identical to OpenAPI):

```
corum import asyncapi <spec> [flags]  |  corum import --config <file>
  → normalise to AsyncAPIImportEntry
  → load active packs + messaging/adapters/asyncapi.yaml
  → AsyncAPIAdapter → { nodes, edges, diagnostics }
  → reconcile (unchanged)
  → write cluster YAML (unchanged)
  → stage-1 lint + report diagnostics
```

---

## 4. Shared extraction type — `FieldStrategy`

All three classifiers on `AsyncAPIImportEntry` (`componentMapping`, `messageNaming`, `eventClassification`) extract a string value from the same set of AsyncAPI spec fields. They share one TypeScript type and one implementation function.

Strategy names are named after the AsyncAPI spec field they operate on:

```typescript
type FieldStrategy =
  | { strategy: 'channel-segment'; separator: string; segment: number }
  | { strategy: 'channel-pattern'; pattern: string }
  | { strategy: 'name-segment'; separator: string; segment: number }
  | { strategy: 'name-pattern'; pattern: string }
  | { strategy: 'tag' }
  | { strategy: 'hardcoded'; value: string }
```

One shared function: `extractValue(strategy: FieldStrategy, operation: OperationInterface, message: MessageInterface): string | undefined`

- `channel-*` — operates on the channel address string
- `name-*` — operates on the message name (`message.name()` first, `message.id()` as fallback)
- `tag` — uses the first tag on the operation or message. Not meaningful for `messageNaming`.
- `hardcoded` — returns the fixed `value`. For `componentMapping` this is the component name; not meaningful for `messageNaming`.

For segment strategies: split the source string on `separator`, return `segments[segment]`. Negative indices count from the end (`-1` = last segment).

---

## 5. Import config

```typescript
interface AsyncAPIImportEntry {
  adapter: 'asyncapi'
  spec: string
  componentMapping: FieldStrategy        // required — derives bounded context name
  messageNaming?: FieldStrategy          // optional — transforms message name; sensible values: name-segment, name-pattern
  eventClassification?:                  // optional — absent means always-integration
    | { strategy: 'always-integration' }
    | { strategy: 'always-domain' }
    | { from: FieldStrategy; domainValue: string }
}
```

**`componentMapping`** — all `FieldStrategy` variants are valid. Extracted value becomes the component name.

**`messageNaming`** — applied to derive the final message name used for node IDs. Applied to `message.name()` first; if absent, applied to `message.id()`. Sensible strategies: `name-segment` (strip version suffixes like `.v2`), `name-pattern`. If absent, `message.name()` is used as-is (normalised to kebab-case).

**`eventClassification`** — `from` extracts a value; if it equals `domainValue` → `DomainEvent`, otherwise → `IntegrationEvent`. When absent, all events are `IntegrationEvent`.

**Config file examples:**

```yaml
imports:
  # All integration events, component from channel first segment
  - adapter: asyncapi
    spec: ./specs/orders-events.yaml
    componentMapping:
      strategy: channel-segment
      separator: /
      segment: 0

  # Dot-notation topics; second segment = component; internal. prefix = domain
  - adapter: asyncapi
    spec: ./specs/platform-events.yaml
    componentMapping:
      strategy: channel-segment
      separator: .
      segment: 1
    eventClassification:
      from:
        strategy: channel-segment
        separator: .
        segment: 0
      domainValue: internal

  # Message names versioned as Name.v2 — strip version suffix
  - adapter: asyncapi
    spec: ./specs/payments-events.yaml
    componentMapping:
      strategy: hardcoded
      value: payments
    messageNaming:
      strategy: name-segment
      separator: .
      segment: 0
    eventClassification:
      from:
        strategy: name-segment
        separator: .
        segment: -1
      domainValue: DomainEvent

  # Regex on channel address + message name — no fixed separator assumed
  # e.g. channel "catalogue.v1.product-updated", message "ProductUpdatedDomainEvent"
  # pattern targets only domain events; any match → DomainEvent, no match → IntegrationEvent
  - adapter: asyncapi
    spec: ./specs/catalogue-events.yaml
    componentMapping:
      strategy: channel-pattern
      pattern: '^([a-z]+)\.'
    eventClassification:
      from:
        strategy: name-pattern
        pattern: 'DomainEvent'
      domainValue: DomainEvent
```

---

## 6. CLI

Adds `asyncapi` subcommand alongside `openapi`:

```
corum import asyncapi <spec> --component-strategy channel-segment --separator '.' --segment 1
corum import asyncapi <spec> --component-strategy channel-pattern --pattern '^([^.]+)\.'
corum import asyncapi <spec> --component-strategy hardcoded --component orders
corum import asyncapi <spec> --component-strategy tag

# With classification
corum import asyncapi <spec> \
  --component-strategy channel-segment --separator '.' --segment 1 \
  --event-classification-from channel-segment --ec-separator '.' --ec-segment 0 --domain-value internal

# With message naming
corum import asyncapi <spec> \
  --component-strategy hardcoded --component payments \
  --message-naming name-segment --mn-separator '.' --mn-segment 0
```

Flags prefixed `--ec-` for eventClassification and `--mn-` for messageNaming avoid collision when multiple strategies use `separator`/`segment`.

Exit codes: 0 = success (warnings allowed), 1 = import errors, 2 = config/invocation error.

---

## 7. Event template additions

`correlationId` is removed from the existing Event template — it is transport-level metadata (a message header), not a payload field. Teams model it in `headers` instead.

Three new properties added to `.corum/packs/messaging/templates/Event.yaml`, inherited by `DomainEvent` and `IntegrationEvent`:

```yaml
topic:
  type: string
  description: "The channel address (topic/queue/stream) this event is published on. If the same message type appears on multiple channels, the first is recorded and a diagnostic lists the others."

description:
  type: string
  description: "Human-readable description of what this event represents."

headers:
  type: object
  description: |
    Map of header name to header definition. Carries message-level metadata
    separate from the payload (correlationId, traceId, Kafka key, etc.).
    Same shape as parameters on APIEndpoint.
  additionalProperties:
    type: object
    additionalProperties: false
    required:
      - type
    properties:
      type:
        type: string
        enum: [uuid, string, integer, decimal, boolean, datetime, date]
      required:
        type: boolean
      description:
        type: string
```

---

## 8. Pack adapter config

`.corum/packs/messaging/adapters/asyncapi.yaml` — same pattern as `rest/adapters/openapi.yaml`:

```yaml
adapter: asyncapi
version: "1.0"

constructs:
  message:
    integrationTemplate: IntegrationEvent
    domainTemplate: DomainEvent

  payloadSchema:
    template: Schema
    section: schemas

  payloadField:
    template: Field
    section: fields

  enumDefinition:
    template: EnumDefinition
    section: enums

  enumValue:
    template: EnumValue
    section: values

scalarTypes:
  string: string
  string/uuid: uuid
  string/date: date
  string/date-time: datetime
  integer: integer
  number: decimal
  boolean: boolean
```

---

## 9. Mapping: AsyncAPI → Corum nodes

| AsyncAPI construct | Corum node / property |
|---|---|
| Operation + message | `IntegrationEvent` or `DomainEvent` node |
| Channel address | `Event.properties.topic` |
| Message `description` | `Event.properties.description` |
| Message `headers` schema (flat) | `Event.properties.headers` (property map) |
| Message payload (inline or single-use `$ref`) | owned `Schema` in Event's `schemas` section |
| Message payload `$ref` used by 2+ messages | shared `Schema` node; Event gets `reads` edge |
| `components/schemas` object | shared or owned `Schema` (see §10) |
| `components/schemas` enum | always standalone `EnumDefinition` + `EnumValue` nodes |
| Scalar field in payload | `Field` node with `type`, `nullable` |
| `$ref` field in payload | `Field.$ref` pointing to shared Schema/EnumDefinition |

**Message direction:** `isSend()` and `isReceive()` are normalised across v2 and v3 but are not used to classify event type — direction is routing metadata, not event identity. Both DomainEvents and IntegrationEvents can be sent or received.

**Multiple channels, same message:** if the same message name appears on multiple channels (same event type published to multiple topics), one Event node is created. `topic` holds the first channel address; a `severity: info` diagnostic lists the others.

---

## 10. Message naming

Event node names are derived from the message name, normalised to kebab-case.

Resolution order:

| Source | Condition | Behaviour |
|---|---|---|
| `message.name()` | set, no `messageNaming` config | use directly, kebab-normalise |
| `message.name()` | set, `messageNaming` configured | apply `messageNaming` extraction, kebab-normalise |
| `message.id()` | `message.name()` absent, `messageNaming` configured | apply `messageNaming` extraction to id, kebab-normalise |
| `message.id()` | `message.name()` absent, no `messageNaming` config | skip + `severity: warning` |
| Anonymous | both absent | skip + `severity: error` |

**Examples:**
- `name: OrderPlaced` → `order-placed`
- `name: OrderPlaced.v2` + `messageNaming: name-segment, sep='.', seg=0` → `order-placed`
- `id: events.OrderPlaced` + `messageNaming: name-segment, sep='.', seg=-1` → `order-placed`

---

## 11. ID derivation

```
Event           {component}.IntegrationEvent.{messageName}
                {component}.DomainEvent.{messageName}

Payload Schema  {eventId}.schemas.{schemaName}
Field           {schemaId}.fields.{fieldName}

Shared Schema   {component}.Schema.{schemaName}
EnumDefinition  {component}.EnumDefinition.{enumName}
EnumValue       {enumId}.values.{value}
```

`schemaName` for an owned payload schema: message name if the payload is inline; the `components/schemas` key if derived from a named schema.

---

## 12. Schema counting and promotion

Pre-pass over all messages: count how many message top-level payloads `$ref` each `components/schemas` entry. Apply BFS closure: schemas referenced by a counted-as-shared schema are also promoted.

**Payload schema rule (same counting as OpenAPI):**

| Payload | Result |
|---|---|
| Inline (no `$ref`) | owned `Schema` under Event |
| `$ref` to named schema, used by 1 message | owned `Schema` under Event (schema is the event's own shape) |
| `$ref` to named schema, used by 2+ messages | shared `Schema` node; Event gets `reads` edge |

**`components/schemas` enums:** always standalone `EnumDefinition` nodes — no counting applied. Named enums are explicitly extracted types regardless of usage count.

**Unreachable schemas:** `components/schemas` entries not reachable from any message payload are not emitted.

**Field schemas within payload:** `$ref` to `components/schemas` entry → shared Schema (subject to counting + BFS). Inline object field → sibling inline Schema owned by Event (same as OpenAPI endpoint context).

---

## 13. Headers extraction

Message `headers` is a JSON Schema object. The adapter walks `headers.properties()` and maps each entry to `{ type, required, description }`. Scalar type mapping uses the same `scalarTypes` map as payload fields.

Constraints (same spirit as OpenAPI `parameters`):
- Nested header objects → `severity: warning`, skip that header field
- Unknown scalar type → `type: string` + `severity: warning`

If `message.hasHeaders()` is false, the `headers` property is omitted from the Event node.

---

## 14. Testing strategy

**Fixture / golden file tests:**

```
test/fixtures/asyncapi/
  specs/
    petstore-v3.yaml          # AsyncAPI v3 (use existing docs/spec-examples/asyncapi/petstore.asyncapi.3.0.yaml)
    petstore-v2.yaml          # AsyncAPI v2 (use existing docs/spec-examples/asyncapi/petstore.asyncapi.2.6.yaml)
    mixed-events.yaml         # message-tag classification: domain + integration mix
    shared-payload.yaml       # two messages sharing a payload $ref (rare case → shared Schema)
    with-headers.yaml         # messages with headers schema
    with-enums.yaml           # components/schemas enum → standalone EnumDefinition
    message-naming.yaml       # versioned message names (Name.v2) requiring messageNaming config
  expected/
    petstore-v3/
      components/petstore/IntegrationEvents/order.yaml     # owned Order schema; Order used by 1 Event
      components/petstore/IntegrationEvents/order-id.yaml  # no schema (primitive payload); warning emitted
      components/petstore/IntegrationEvents/pet.yaml       # owned Pet schema; pet.added + pet.changed share this node (same message name); info diagnostic lists both channels
      components/petstore/IntegrationEvents/pet-id.yaml    # no schema (primitive payload); warning emitted
    petstore-v2/              # identical output to petstore-v3 (proves parser normalisation)
    mixed-events/
      components/orders/IntegrationEvents/order-placed.yaml
      components/orders/DomainEvents/order-created.yaml
    shared-payload/
      components/orders/IntegrationEvents/order-placed.yaml
      components/orders/IntegrationEvents/order-confirmed.yaml
      components/orders/Schemas/order-payload.yaml
    with-enums/
      components/orders/IntegrationEvents/order-placed.yaml
      components/orders/EnumDefinitions/OrderStatus.yaml
```

**Unit tests — pure functions:**

| Function | What to cover |
|---|---|
| `extractValue(strategy, op, msg)` | All six `FieldStrategy` variants; negative segment index; no-match → undefined |
| `classifyEvent(classification, op, msg)` | `always-*`; `from` with match; `from` with no match → integration |
| `deriveMessageName(msg, config)` | name set; name absent + config; name absent + no config → skip; anonymous → skip |
| `deriveNodeId` | Event, Schema, Field, EnumDefinition, EnumValue shapes |
| Scalar type mapping | All mapped types; `integer/int32` → `integer`; unknown → warning |
| Schema counting | 1-use → owned; 2-use → shared; BFS closure; unreachable → not emitted |
| `extractHeaders` | Flat headers; nested field → warning + skip; empty headers → omit property |
| `type: [string, null]` nullable | JSON Schema array type for nullability normalised correctly |
| `allOf: [{$ref}]` pattern | Unwrapped to `$ref` before field processing |
| `additionalProperties` map | `collection: map` with scalar and `$ref` value types |

**Idempotency:** each fixture run twice; assert no second-run file changes.

---

## 15. Done criteria

| # | Criterion |
|---|---|
| 1 | AsyncAPI v3 spec produces Event nodes with correct `topic`, `description`, fields |
| 2 | AsyncAPI v2 spec with identical content produces identical output (parser normalisation proven) |
| 3 | All `eventClassification` strategies correctly classify domain vs integration events |
| 4 | Single-use payload `$ref` → owned Schema under Event; 2+-use → shared Schema node |
| 5 | `components/schemas` enums always produce standalone `EnumDefinition` + `EnumValue` nodes |
| 6 | Same message name on multiple channels → one Event node; info diagnostic lists extra channels |
| 7 | Message headers captured as a flat property map on the Event node |
| 8 | `messageNaming` config correctly transforms versioned message names |
| 9 | `type: [string, null]` JSON Schema nullable pattern correctly sets `nullable: true` |
| 10 | Re-importing an unchanged spec produces no file changes (idempotent) |
| 11 | Removed message → `state: removed` on that node |
| 12 | Invalid spec → `severity: error` diagnostics, no output files written |
| 13 | All produced nodes carry `derivation: determined`, `derivedBy: adapter:asyncapi`, `extractedFrom` |
| 14 | Existing test suite (45 nodes, 38 edges) stays green |

---

## 16. Gaps (v1)

A parallel `docs/tasks/asyncapi-gaps.md` documents these. Items shared with OpenAPI reference `docs/tasks/openapi-gaps.md`.

| Gap | Severity | Note |
|---|---|---|
| Primitive payload (`type: integer`) | warning + Event with no schema | Common for delete/tombstone events (e.g. `OrderId: uuid`). Future: model as `payloadType` property |
| `oneOf` / `anyOf` in payload fields | warning + `type: string` | Same gap as OpenAPI. More prevalent in AsyncAPI for polymorphic event types |
| Inline field enum | warning + `type: string` | Same gap as OpenAPI. Named enums in `components/schemas` work correctly |
| Anonymous inline object in standalone schema context | warning + `type: string` | Same gap as OpenAPI |
| Envelope pattern | not detected | If payload is an envelope, all fields land on the Event. Future: `payloadPath` config option to unwrap |
| Channel parameters | not captured | Dynamic channel addresses (e.g. `user/{userId}/events`) — parameter values not modelled |
| Protocol bindings | not captured | Kafka/AMQP/etc. protocol-specific config (`x-kafka-*`, etc.) |
| Reply pattern (v3) | not captured | Request-reply operations — reply channel/message ignored |
| Message without name + no `messageNaming` config | warning + skip | Teams should set `name:` on all messages, or configure `messageNaming` |
| Anonymous message (no name, no id) | error + skip | Spec authoring issue; no clean node ID derivable |
| `isSend()` / `isReceive()` direction | not captured | Future: emit `produces` (send) and `reads` (receive) edges between the owning service node and Event nodes. Requires import config to declare the owning service's Corum node ID — the AsyncAPI spec alone has no anchor for the other edge endpoint. |

---

## Related

- ADR-009 — Importer architecture (in-process front door)
- ADR-003b — Core logical data model (`derivation` axis)
- 2026-06-18-openapi-importer-design.md — OpenAPI importer (patterns reused)
- `docs/tasks/openapi-gaps.md` — shared gap taxonomy
- `docs/spec-examples/asyncapi/` — petstore v2.6 and v3.0 used as primary fixtures
