# Reference: TypeSpec Integration Opportunities

**Status:** Reference — not yet an ADR  
**Date:** 2026-04-12  
**Relates to:** ADR-002 (Canonical File Format), ADR-003 (Graph Loading), PDR-003 (Template Packs and Plugin Architecture)  
**Action required:** Evaluate TypeSpec as extraction source in the extraction pipeline ADR; evaluate TypeSpec emitter as an output plugin in the template pack roadmap

---

## What TypeSpec Is

TypeSpec is an open source (MIT licensed), TypeScript-inspired API definition language developed by Microsoft and now GA at v1.0. It is a higher-level language that compiles to multiple concrete artefacts simultaneously — OpenAPI 3, JSON Schema, Protobuf, client libraries, and server stubs — from a single source of truth.

The mental model: TypeSpec is to OpenAPI what TypeScript is to JavaScript. You write a concise, type-safe, composable definition once and emit many formats from it. It has a rich linter framework, an emitter plugin system distributed via NPM, and first-class VS Code support.

A simple example:

```typespec
import "@typespec/http";
using Http;

@route("/orders")
interface Orders {
  @post create(@body body: CreateOrderRequest): Order;
  @get list(): Order[];
}

model CreateOrderRequest {
  customerId: uuid;
  items: OrderItem[];
}

model Order {
  orderId: uuid;
  customerId: uuid;
  status: OrderStatus;
  items: OrderItem[];
}

enum OrderStatus {
  Pending,
  Confirmed,
  Cancelled,
}

model OrderItem {
  productId: uuid;
  quantity: integer;
}
```

This compiles to a full OpenAPI 3 spec, a JSON Schema, and (in preview) TypeScript/C#/Java/Python client and server stubs.

---

## Why It Is Complementary, Not Competing

TypeSpec and the design graph operate at different layers with different concerns:

| Dimension | TypeSpec | Design Graph |
|---|---|---|
| Scope | Single service API contract | Cross-service design intent and lineage |
| Primary concept | HTTP operations, models, schemas | Nodes, edges, field-level mappings |
| Domain models | Not modelled — only request/response shapes | First-class nodes with invariants, operations, events |
| Events | Not modelled | First-class DomainEvent nodes |
| Field lineage | Not modelled | Core capability — maps API fields to domain model fields |
| Branch awareness | Not a concern | Core differentiating capability |
| Output | OpenAPI, code stubs, docs | Design graph, drift detection, agent context |

TypeSpec is what a team uses to define and implement a single service's API contract precisely. The design graph is what a team (or AI agents) uses to understand and govern how that API relates to its domain model, events, and other services.

---

## The Three Integration Dimensions

### 1. TypeSpec as an extraction source (highest priority)

When a team uses TypeSpec to define their APIs, it is a **better extraction source than compiled OpenAPI YAML**. Here is why:

OpenAPI YAML is a serialisation format — it flattens the original design intent. `$ref` resolution inlines shared models, losing the fact that they were originally named types. Anonymous schemas lose their connection to the named models they represent. Field descriptions that were inherited from a parent model become duplicated strings with no traceability.

TypeSpec preserves the original design intent: named models, inheritance hierarchies, shared type definitions, decorators that carry semantic meaning. Parsing TypeSpec to populate design graph nodes is therefore both higher-fidelity and more reliable than parsing the compiled OpenAPI output.

**Extraction mapping:**

| TypeSpec concept | Design graph node |
|---|---|
| `@route` + `interface` operation | `APIEndpoint` cluster file |
| Request/response `model` | Schema node owned by the endpoint cluster |
| Named `model` (shared) | `DomainModel` candidate (requires human confirmation) |
| `enum` | Enum definition owned by its model cluster |
| `enum` values | Enum value nodes with state/stability |
| Model properties | Field nodes with type, nullability, cardinality |
| `@doc` decorator content | `description` field on the node |
| Inheritance (`extends`) | `derived-from` edge between models |

The extraction pipeline ADR should evaluate TypeSpec as a first-class extraction source alongside AST parsing of TypeScript/Python/Java code and OpenAPI YAML.

---

### 2. TypeSpec as an output plugin (output plugin for PDR-003)

The design graph could emit TypeSpec from agreed `APIEndpoint` nodes as an output plugin — the reverse direction: graph → TypeSpec → OpenAPI → code.

**Use case:** A team designs an API in the graph (or has it extracted and enriched). They agree on the design. They want to generate a TypeSpec file that becomes the implementation-ready contract for the engineering team. The TypeSpec emitter reads the `APIEndpoint` cluster file and its owned schemas and fields, and generates a `.tsp` file.

This is valuable because:
- TypeSpec files are more expressive and maintainable than raw OpenAPI YAML for engineering teams to work with
- A TypeSpec emitter keeps the design graph as the single source of truth, with TypeSpec as a generated output (not a hand-authored input)
- Teams can then use TypeSpec's own emitters to generate OpenAPI, JSON Schema, and code stubs from the design-graph-generated TypeSpec

**Plugin shape** (per PDR-003 output plugin model):
- Depends on: `APIEndpoint` node type, owned schema and field nodes
- Input: agreed `APIEndpoint` cluster files from the graph
- Output: `.tsp` file per service component
- Triggers: manual export, or on state transition to `agreed`

---

### 3. TypeSpec as a drift detection source

If a team maintains TypeSpec files in their service repository alongside the design graph, the extraction pipeline can compare the TypeSpec definition against the corresponding design graph node and surface drift — the same drift detection model as code extraction, but with a richer and more structured input.

**Example drift cases detectable from TypeSpec:**
- A field was added to the TypeSpec model but not to the design graph schema node
- A field was renamed in TypeSpec but the design graph still has the old name (detectable as a candidate rename, triggering the rename workflow from PDR-005)
- A new API operation was added in TypeSpec with no corresponding design graph node
- A shared TypeSpec model was split into two models, changing the lineage

This is more reliable than drift detection from compiled code because TypeSpec preserves the intent of the original design rather than the implementation details of the compiled output.

---

## Adoption Considerations

**TypeSpec is MIT licensed** — no licensing concerns for extraction, output, or drift detection use cases at any tier.

**TypeSpec adoption is currently Azure/Microsoft-centric** — teams not building Azure services or not using Microsoft tooling are less likely to be using TypeSpec today. This means TypeSpec support in the extraction pipeline is an enhancement, not a baseline requirement. OpenAPI YAML and code AST parsing must remain the primary extraction paths; TypeSpec is an additional high-fidelity source.

**TypeSpec is growing** — it is GA at v1.0, actively used across Azure, and gaining community adoption beyond Microsoft. The extraction and output plugin investment will become more valuable over time.

**TypeSpec and AsyncAPI** — TypeSpec has community libraries for AsyncAPI (event schemas). This is relevant for `DomainEvent` and `IntegrationEvent` node extraction — worth investigating when the extraction pipeline ADR is written.

---

## Recommended Actions

1. **Extraction pipeline ADR** — include TypeSpec as a first-class extraction source option alongside OpenAPI YAML and code AST. Evaluate the TypeSpec compiler's own AST/reflection API as the parsing mechanism rather than writing a custom TypeSpec parser.

2. **Template pack roadmap** — add TypeSpec emitter as a planned output plugin for `APIEndpoint` nodes. Prioritise after the core extraction pipeline is working.

3. **PDR-003 update** — reference TypeSpec emitter as a concrete example of an output plugin when PDR-003 is next revisited.

4. **AsyncAPI investigation** — check whether the TypeSpec AsyncAPI library produces output compatible with `DomainEvent` node extraction before designing the event extraction approach.

---

## Related

- ADR-002: Canonical file format — TypeSpec extraction maps to cluster file schema defined here
- ADR-003: Graph loading — TypeSpec files are a candidate extraction source; noted in prior art section
- PDR-003: Template packs and plugin architecture — TypeSpec emitter is a concrete planned output plugin
- PDR-005: Deletions, renames, and collisions — TypeSpec drift detection feeds the rename detection workflow
- Prior art: EventCatalog integrates with OpenAPI/AsyncAPI as extraction sources — TypeSpec is a higher-fidelity upstream source of the same information
