# Generic Code Extractor (tree-sitter) — Design Spec

**Status:** Proposed
**Date:** 2026-06-17
**Implements:** ADR-009 (Importer Architecture) — external producer via the contract-import front door
**Depends on:** REF — Ingestion contract, ADR-003b (`derivation`), ADR-004 (template packs), ADR-004b (edge vocabulary)
**Build sequence:** the second producer — proves the contract door + multi-source reconcile.

---

## 1. Purpose

A configurable, language-portable tool that parses source via tree-sitter and emits domain-model and event **nodes** (plus implied `has-field`/`has-value`) as a versioned ingestion contract file. The contract is a serialization of the existing `Node`/`Edge` schema types (ADR-003b) — not a new format. Conventions live in **data** (extraction packs), not code, so the tool is reusable across codebases and languages. It runs **agent-side / standalone** (ADR-009, [01 §7](../../architecture/01-architecture-overview.md)) and never runs inside the Corum engine.

**Node-first.** It emits nodes only. Semantic edges (`maps-to`, `produces`) are deferred to the linker stage.

## 2. Architecture — two layers

1. **Language binding** (code, one per grammar) — wraps a tree-sitter grammar and implements a fixed predicate/extraction interface. The *only* per-language code.
2. **Extraction pack** (data, one per codebase) — recognizers, field rules, type maps, component derivation. A codebase ships its own pack; no pack is built into the tool.

The binding compiles pack predicates (`baseType`, `implements`, `nodeKind`) down to tree-sitter queries (`.scm`); pack authors never write `.scm`.

## 3. Language-binding interface

```
typesInFile(path)        -> TypeDecl[]
  TypeDecl: { name, kind, baseTypes[], interfaces[], attributes[], namespace, span }
membersOf(TypeDecl)      -> Member[]
  Member:   { name, declaredTypeText, accessors, isCollection, isNullable, attributes[] }
enumMembers(TypeDecl)    -> string[]
```

Everything a pack's `match` needs is satisfiable from the CST **without semantic resolution** → recognition is deterministic and portable. The interface intentionally leaves room for a binding to back these calls with a richer semantic engine later (e.g. a compiler frontend or language server) — the precision escape hatch — without changing pack authoring.

## 4. Extraction-pack schema

The pack below is **illustrative**: every value (paths, base types, source type names, namespaces) is supplied by the pack author for their own codebase and language. The tool ships none of it.

```yaml
language: <language-id>            # selects the binding (one per tree-sitter grammar)
version: "1.0"

component:
  from: path
  segmentAfter: modules            # e.g. src/modules/orders/... -> component "orders"

scalarTypes:                       # source type name -> Corum scalar (illustrative)
  uuid: uuid
  string: string
  int: integer
  long: integer
  decimal: decimal
  bool: boolean
  timestamp: datetime
  date: date

scalarValueObjects: [Money, EmailAddress]   # keep these flat; do not explode into ValueObject nodes

fieldRules: &fields
  include:
    publicProperties: true
    recordParameters: true
    readonlyCollectionWrappers: true   # private collection field + public read-only accessor
    settableStateProperties: true      # internally-settable properties = domain state
  nullable: { fromOptionalMarker: true, fromNullableType: true }
  cardinality: { collectionTypes: [List, Collection, Array, Sequence, "[]"] }
  ref:
    recurseNamespaces: ["<root-namespace>.*"]
    stopAt: [scalar, enum, external]
    maxDepth: 10

recognizers:
  - id: aggregate
    template: DomainModel
    scope: { paths: ["**/domain/**/*Aggregate.*"] }
    match: { anyOf: [ { baseType: AggregateRoot }, { baseType: Entity } ] }
    name: { fromTypeName: true, strip: ["Aggregate"] }   # OrderAggregate -> Order
    fields: *fields
    confidence: deterministic

  - id: integration-event
    template: IntegrationEvent
    scope: { paths: ["**/contracts/**/*", "**/events/**/*"] }
    match: { anyOf: [ { implements: IntegrationEventBase }, { nameMatches: ".*IntegrationEvent$" } ] }
    name: { fromTypeName: true }
    fields: *fields

  - id: domain-event
    template: DomainEvent
    scope: { paths: ["**/domain/**/events/*"] }
    match: { anyOf: [ { implements: DomainEventBase }, { nameMatches: ".*DomainEvent$" } ] }
    name: { fromTypeName: true }
    fields: *fields

  - id: enum
    template: EnumDefinition
    scope: { paths: ["**/enums/**/*", "**/domain/**/*"] }
    match: { nodeKind: enum }
    values: { fromEnumMembers: true }
```

### Match predicates (all CST-satisfiable)

`baseType`, `implements`, `attribute`, `nodeKind`, `nameMatches` (regex on type name), `namespaceMatches`, plus `scope.paths` globs. Combinable via `anyOf`/`allOf`.

## 5. Type mapping & `$ref` resolution

- A member's `declaredTypeText` is looked up in `scalarTypes` → `Field.type`; in `scalarValueObjects` → treated as a flat scalar; if it's an enum in scope → `ref` to the `EnumDefinition`; otherwise a complex type → `ref` to another node.
- **`$ref` resolution (v1 default): name-reconcile within `component`.** tree-sitter gives the type *name* as text; binding it to a node ID is a heuristic match within the component → emitted as `derivation: inferred`. Node *shapes* remain `deterministic`; only the cross-type link is `inferred`.
- Recursion follows `ref.recurseNamespaces`, stops at `ref.stopAt`, capped at `ref.maxDepth` (a diagnostic is emitted at the cap).

## 6. Emission

For each matched type, emit one `Node` of the mapped template (ADR-003b schema), with fields as owned children (→ `has-field`), enums as `EnumDefinition` + `EnumValue` (→ `has-value`). Set `extractedFrom` = file path, `derivedBy` = `extractor:treesitter`, `derivation` per §5. Serialize the resulting `Node[]` (and any `Edge[]`) to the versioned ingestion contract file, consumed by `corum import contract`.

## 7. Pipeline

```
discover files by scope.paths
  -> parse (tree-sitter)
  -> classify (recognizers.match)
  -> extract members (fieldRules)
  -> map types (scalarTypes / scalarValueObjects / enum / ref)
  -> resolve $ref by name within component  [inferred]
  -> emit ingestion contract
```

## 8. Determinism

- Node shapes, classification, and enum extraction are **deterministic** — pure functions of the CST + pack.
- Re-running on unchanged source MUST produce a byte-identical contract.
- Only `$ref` links are `inferred` under the v1 default.

## 9. Done when

- Running the extractor + an example pack over a target repository produces a contract whose `DomainModel` / `IntegrationEvent` / `DomainEvent` / `ValueObject` / `EnumDefinition` counts and field shapes match a hand-checked sample of that repository's aggregates and events.
- Out-of-scope files are never parsed.
- Re-run is byte-identical.
- The contract imports clean through the pipeline and reconciles against spec-adapter-derived nodes without duplicate logical entities.

## 10. Open decisions (v1 defaults adopted)

1. **`$ref` resolution** — name-reconcile within component (`inferred`). *Adopted.* Alternative: plug a semantic backend (a compiler frontend or language server) for deterministic refs — deferred via the binding interface.
2. **Value-object boundary** — `scalarValueObjects` allow-list keeps named VOs flat; everything else complex becomes a `ValueObject` node. *Adopted.*
3. **Binding backend** — tree-sitter only for v1; semantic backend optional later behind the same interface. *Adopted.*

## Related

- ADR-009 — Importer architecture (external producer / contract front door)
- REF — Ingestion contract (the emitted format)
- 2026-06-17 — OpenAPI adapter design (the in-process producer built first)
- ADR-004b — edge vocabulary (`has-field`/`has-value` implied by emitted structure)
