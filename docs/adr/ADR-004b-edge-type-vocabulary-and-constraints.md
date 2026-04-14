# ADR-004b: Edge Type Vocabulary and Connection Constraints

**Status:** Accepted  
**Date:** 2026-04-12  
**Deciders:** Product Owner  
**Depends on:** ADR-004 (Template Pack Format), ADR-003b (Core Logical Data Model)  
**Related:** ADR-006 (Linter and Validator)

---

## Context and Problem Statement

ADR-003b established edges as first-class entities with a `type` field and defined the core edge type vocabulary. ADR-004 removed edge target declarations from individual templates because coupling templates to each other by name breaks on rename and prevents independent pack composition.

This ADR decides two remaining questions:

1. **Are edge connections constrained at all, and if so how?**
2. **Where does the edge type vocabulary live — in packs or in the tool?**

---

## Decision Drivers

- **The tool reasons about specific edge types.** Field-level lineage, drift detection, and the linter all depend on `maps-to` and `derived-from` having stable, known semantics. These cannot be arbitrary team-defined strings.
- **Cross-pack composability.** A vocabulary defined in one pack creates hidden dependencies. Templates in pack B referencing types declared only in pack A fail when pack A is not loaded.
- **No premature extensibility.** Designing a custom edge type extension mechanism before there is a concrete use case is premature. The core vocabulary defined in ADR-003b covers everything the default pack needs.
- **Authoring simplicity.** Templates should be easy to write. Requiring both `outgoing` and `incoming` declarations for every edge type creates an unnecessary coupling concern — authors should be able to express "this node participates in `reads` edges" without thinking about directionality unless it matters.
- **Directionality where it matters.** Some edge types have strong directional semantics worth enforcing. An `APIEndpoint` is always the source of `triggers`, never the target. A `DomainEvent` never triggers anything downstream. The declaration model should support this expressiveness without requiring it everywhere.

---

## Options Considered

### Option A: No constraints — allow all

Any node connects to any other via any string `type` value. The linter does not validate edge structure.

**Pros:** Zero configuration; maximum flexibility  
**Cons:** Edge type names become inconsistent; graph quality degrades silently; the tool cannot reason about edges reliably  
**Effort:** Lowest — but produces an ungoverned graph at scale

---

### Option B: Core vocabulary only; connections unconstrained

Edge types are fixed in the tool. Nodes may use any core type to connect to any other node. No per-template constraints.

**Pros:** Consistent naming; simple linter check; no authoring burden  
**Cons:** Structurally nonsensical connections are still valid; no basis for detecting missing expected edges; less informative than a model with structural guidance  
**Effort:** Low

---

### Option C: Core vocabulary; templates declare `outgoing` and `incoming` (previous model)

Templates declare which edge types they send and which they receive. Linter validates the intersection.

**Pros:** Full directional expressiveness; linter can detect directional anomalies  
**Cons:** Authors must think in terms of incoming vs outgoing for every edge type — creates an implicit coupling concern even when directionality doesn't matter for the type in question  
**Effort:** Medium

---

### Option D: Core vocabulary; templates declare `supports`, `outgoing`, and `incoming` (selected)

Templates may declare any combination of three sections:

- `supports` — this node participates in these edge types in either direction
- `outgoing` — this node may only *send* these edge types, never receive them
- `incoming` — this node may only *receive* these edge types, never send them

Most templates use only `supports`. `outgoing` and `incoming` are available for templates where directionality is a meaningful structural constraint worth enforcing.

**Pros:**
- Authoring simplicity — most templates just list types they participate in
- Directionality is expressible when it genuinely matters
- No coupling concern for types declared in `supports`
- Cross-pack composability unchanged — all types reference the core vocabulary only

**Cons:**
- Slightly more declaration surface than Option B
- Three sections require clear documentation of precedence rules

**Effort:** Medium — same as Option C but more natural to author

---

## Decision

**Chosen option: Option D — core vocabulary in the tool; templates declare `supports`, `outgoing`, and `incoming`**

All edge types are from the core vocabulary defined in ADR-003b. Custom edge type extensibility is deferred — see the future work note at the end of this ADR.

Constraint violations are linter **warnings** by default in v1, not errors. The two exceptions are both **hard errors**: unknown edge type names, and `maps-to` used between non-Field nodes.

---

## Core Edge Type Vocabulary

The following eight edge types are defined by the tool. They are always available, always carry the same semantics, and are not declared in any pack. All template edge declarations must reference only these names.

| Type | Applies between | Meaning |
|---|---|---|
| `triggers` | root → root | Source node's occurrence initiates the target |
| `produces` | root → root | Source operation produces the target event or schema |
| `reads` | root → root | Source reads from the target at runtime |
| `calls` | root → root | Source invokes the target contract boundary |
| `implements` | root → root | Source is a concrete realisation of the target contract |
| `maps-to` | field → field only | Source field corresponds to target field across a schema boundary. **Hard error if used between non-Field nodes.** |
| `derived-from` | any → any | Source is computed from the target. Valid at root level (ReadModel from DomainModel) and field level (projected field from source field). |
| `renamed-from` | any → any | Source was previously known as the target identity (PDR-005) |

**`maps-to` vs `derived-from`:** These are distinct and should not be conflated. `maps-to` is a specific field-to-field correspondence — this request field maps to this domain model field. `derived-from` expresses a broader computational relationship — this read model is derived from this aggregate; this projected field is derived from this source field. A `ReadModel` is `derived-from` a `DomainModel`; it does not `maps-to` it.

---

## Template Edge Declarations

Templates declare which edge types they participate in using up to three optional sections. All type names must be from the core vocabulary above.

```
edges:
  supports: [...]    # participates in either direction — the common case
  outgoing: [...]    # sends only, never receives — for strong directional constraints
  incoming: [...]    # receives only, never sends — for strong directional constraints
```

All three sections are optional. A template with no `edges` section is unconstrained — no linter warnings are issued for any edge involving that template.

**Precedence:** If a type appears in `outgoing`, it may not also appear in `supports` or `incoming`. If a type appears in `incoming`, it may not also appear in `supports` or `outgoing`. Overlap is a linter error — each type must appear in exactly one section.

---

## Default Pack Template Edge Declarations

Using only the eight core edge types defined in ADR-003b:

```yaml
# APIEndpoint — directly calls or produces a command; does not trigger reactively
edges:
  outgoing: [calls, produces]
  supports: [reads]
```

```yaml
# DomainOperation — receives triggers and calls; produces events; may read and chain
edges:
  supports: [reads]
  outgoing: [produces, triggers, calls]
  incoming: [triggers, calls]
```

```yaml
# DomainModel — can be read from and derived from; may produce events
edges:
  supports: [reads, derived-from]
  outgoing: [produces]
```

```yaml
# Event (abstract base — not directly instantiable; declarations inherited by subtypes)
edges:
  outgoing: [triggers]
  incoming: [produces]
```

```yaml
# DomainEvent — inherits Event edge declarations via extends
# No additional edge declarations needed; behaviour is the same as the base
```

```yaml
# IntegrationEvent — inherits Event edge declarations via extends
# No additional edge declarations needed; behaviour is the same as the base
```

```yaml
# ReadModel — derived from other nodes; read from; never produces
edges:
  incoming: [reads, derived-from]
```

```yaml
# Field — field-level lineage only; maps-to and derived-from in either direction
edges:
  supports: [maps-to, derived-from]
```

```yaml
# Command — produced by an endpoint; triggers an operation; never called directly
edges:
  outgoing: [triggers]
  incoming: [produces]
```

```yaml
# UserJourney — structural grouping; participates via implements and triggers
edges:
  supports: [implements]
  outgoing: [triggers]
```

---

## Validation Logic

The linter applies these checks to every edge:

1. **Vocabulary check:** Edge `type` must be one of the eight core types. Any other value is a **hard error**.

2. **`maps-to` structural check:** `maps-to` edges must connect two Field nodes. Any other combination is a **hard error**.

3. **Source constraint check:** If the source node's template declares `outgoing` or `supports`, the edge type must appear in one of them. Violation is a **warning** (configurable to error per repo via linter config).

4. **Target constraint check:** If the target node's template declares `incoming` or `supports`, the edge type must appear in one of them. Violation is a **warning** (configurable to error per repo).

5. **`renamed-from` directionality:** `renamed-from` edges should always point from the new identity to the old. The linter warns if the edge appears reversed based on node state (a `removed` node as the target is expected; a `removed` node as the source is suspicious).

If a template has no `edges` declaration at all, no constraint checks are applied for that endpoint — the missing declaration is treated as unconstrained, not as `supports: []`.

---

## Pack Structure

Because the edge type vocabulary is defined in the tool, packs do not contain an `edge-types.yaml` in v1. The filename is reserved in the pack directory structure (ADR-004) for the future custom edge type extension mechanism. Its absence is not an error.

---

## Future Work: Custom Edge Type Extension

Teams with domain-specific relationships not covered by the eight core types have no extension mechanism in v1. When a concrete need arises, the options to evaluate are:

- Pack-defined edge types with cross-pack conflict detection
- A registered extension namespace (e.g. `x-saga-step`) similar to OpenAPI vendor extensions  
- Community proposals to add types to the core vocabulary

The `supports`/`outgoing`/`incoming` declaration model in templates extends naturally to include custom type names alongside core ones when this mechanism is designed.

---

## Linter Responsibilities (full specification in ADR-006)

From this ADR, the linter must enforce:

- All edge `type` values are from the core vocabulary (**error**)
- `maps-to` edges connect two Field nodes (**error**)
- Overlap between `supports`, `outgoing`, and `incoming` within a single template declaration is rejected (**error**)
- Edge type names in `supports`, `outgoing`, and `incoming` are from the core vocabulary (**error**)
- Where source or target has declared constraints (via `supports` or directional sections), the edge type is permitted (**warning** by default; configurable to error)

---

## Consequences

**What becomes easier:**
- Most templates simply list which edge types they participate in via `supports` — no directional reasoning required for the common case
- Templates with strong directional semantics (APIEndpoint, DomainEvent) can express that precisely via `outgoing`/`incoming`
- All eight core types have stable, tool-understood semantics — agents and drift detection can rely on them
- Cross-pack composition requires no coordination — all templates reference the same core vocabulary

**What becomes harder:**
- Teams needing relationship types not in the core vocabulary have no v1 mechanism
- Template authors must avoid overlap between `supports`, `outgoing`, and `incoming` sections

**What is newly possible:**
- The linter can detect suspicious directional violations — a `triggers` edge pointing at an `APIEndpoint` will warn because `APIEndpoint` declares `outgoing: [triggers]`
- `derived-from` and `maps-to` chains can be traversed reliably by drift detection because their semantics are guaranteed by the tool

---

## Related

- ADR-003b: Core logical data model — defines the eight core edge types used throughout this ADR
- ADR-004: Template pack format — pack structure; templates include `edges:` declarations referencing core types from this ADR
- ADR-006: Linter and validator — implements the validation logic described here
- PDR-005: Deletions, renames, and collisions — `renamed-from` edge type semantics
