# OpenAPI Adapter — Design Spec

**Status:** Proposed
**Date:** 2026-06-17
**Implements:** ADR-009 (Importer Architecture) — in-process `SpecAdapter` front door
**Depends on:** ADR-003b (data model + `derivation`), ADR-004 (template packs), ADR-004b (edge vocabulary), the `rest` pack
**Build sequence:** [01 §10](../../architecture/01-architecture-overview.md) step 9 — the first end-to-end adapter; proves the pipeline.

---

## 1. Purpose

The first **in-process producer**. Parses an OpenAPI document and produces a `CandidateGraph` of API-layer nodes, validating the full reconcile → emit → lint → review pipeline against a standard, well-understood format before the higher-risk external extractor is introduced.

It is the authoritative source for the **API/schema layer**. Where its output overlaps another producer's, OpenAPI wins on schema shape (types, nullability, required, enums, formats).

## 2. Front door & interface

Implements `SpecAdapter` (`@corum/schema/ports`). Runs inside the engine; consumes a single portable spec document via a real OpenAPI parser (`openapi-types` + a parser). Binds to the `rest` pack. Never touches YAML/fs (§6.3).

```
read(specPath) -> { nodes: Node[], edges: Edge[], diagnostics: Diagnostic[] }
write(namespace, graph) -> OpenAPI document   # export, lower priority
```

`Node` and `Edge` are the existing schema types (ADR-003b), extended by the `derivation` and `derivedBy` fields. No new type is introduced.

## 3. Inputs

- OpenAPI 3.0 / 3.1 / 3.2 documents (reference schemas already vendored under `docs/spec-references/openapi/`).
- Resolved or unresolved `$ref`s (the parser resolves component references).

## 4. Mapping: OpenAPI → Corum nodes

| OpenAPI construct | Corum node / property |
|---|---|
| Path + operation (`get`/`post`/…) | `APIEndpoint` — `method`, `path`, `operationId`, `summary`, `auth` |
| `security` on operation | `auth_required` / policy on `APIEndpoint` |
| Request body schema | owned request `Schema` + `Field` nodes (→ `has-field`) |
| Response schema (per status) | owned response `Schema` + `Field` nodes |
| `components/schemas` reused via `$ref` | a shared `Schema` (or `ValueObject`) node; fields use `ref` |
| `enum` on a schema | `EnumDefinition` + `EnumValue` nodes (→ `has-value`) |
| Property `type`/`format` | `Field.type` (scalar) via the type map below |
| `nullable` / not in `required` | `Field.nullable` |
| `type: array` | `Field.cardinality: many` |

**Type map (OpenAPI → Corum scalar, ADR-003b):**
`string`→`string`; `string/format=uuid`→`uuid`; `string/format=date`→`date`; `string/format=date-time`→`datetime`; `integer`→`integer`; `number`→`decimal`; `boolean`→`boolean`. Object/`$ref` → `Field.ref`.

## 5. ID derivation

```
APIEndpoint   {component}.APIEndpoint.{operationId}
request Schema  {endpoint-id}.schemas.{request-name}
response Schema {endpoint-id}.schemas.{response-name}
Field           {schema-id}.fields.{fieldName}      (nested via dotted path)
Shared schema   {component}.Schema.{componentSchemaName}
```

`component` derivation: from a configured mapping of OpenAPI `tags` (or a path-segment rule) to bounded contexts. Where OpenAPI tags do not map cleanly to internal modules, the component may be enriched during reconcile by another producer (see §7).

## 6. Derivation / confidence

All OpenAPI-derived nodes and fields are `derivation: deterministic, derivedBy: "adapter:openapi"` — OpenAPI is an authoritative spec. No `inferred` output.

## 7. Reconcile behaviour

Produces `{ nodes, edges }` with `state: implemented`, `extractedFrom` = spec path (or source URL), idempotent IDs. The standard reconcile step (ADR-006) matches existing nodes by canonical ID, diffs properties, and (in a later phase) proposes `maps-to`. Precedence on overlap: **OpenAPI wins for API field shapes**; component attribution and DTO type identity may be merged from other producers (e.g. the code extractor) without overwriting shapes.

## 8. What it does / does not emit

- **Emits:** `APIEndpoint`, request/response `Schema`, `Field`, `EnumDefinition`/`EnumValue`, and the structural `has-field`/`has-value` (implied).
- **Does not emit:** events (no event surface in OpenAPI — that is the extractor's / AsyncAPI's domain), domain models, or semantic edges (`maps-to`/`produces` — deferred to the linker).

## 9. Done when

- Importing a service's OpenAPI document yields `APIEndpoint` nodes whose count and request/response field shapes match a hand-checked sample, with correct nullability/enum/format mapping.
- Re-importing unchanged spec is idempotent (no spurious diffs).
- The full pipeline runs green end to end (stage-1 + stage-2 lint pass, cluster files written, review response returned).

## 10. Open decisions

1. **Component mapping source** — OpenAPI `tags` vs a path-segment rule vs a config map. (Recommend: config map, since tags may not equal bounded contexts.)
2. **Shared component schemas** — emit as `Schema` or `ValueObject` when reused across endpoints? (Recommend: `Schema`, promote to `ValueObject` only when also referenced by domain nodes.)
3. **Export (`write`)** — in scope for v1 or deferred? (Recommend: defer; import-only first.)

## Related

- ADR-009 — Importer architecture (in-process front door)
- REF — Ingestion contract (the equivalent shape this adapter produces in memory)
- 2026-06-17 — tree-sitter extractor design (the external producer built next)
