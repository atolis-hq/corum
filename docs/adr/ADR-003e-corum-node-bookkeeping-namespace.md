# ADR-003e: Corum Node Bookkeeping Namespace

**Status:** Proposed  
**Date:** 2026-07-04  
**Deciders:** Product Owner  
**Depends on:** ADR-002 (Graph File Format and Cluster Boundaries), ADR-003b (Core Logical Data Model)  
**Related:** ADR-005 (MCP Interface Design), ADR-006 (Linter and Validator), ADR-009 (Importer Architecture)

---

## Context and Problem Statement

Recent node-identity work introduced rename-history data as `properties.previousNames`. That works mechanically, but it places engine-owned bookkeeping inside the same map that templates use for domain properties. This has three problems:

1. The name is inaccurate: the values are prior node IDs, not prior display names.
2. The location is misleading: rename history is not template-defined node data.
3. The pattern does not scale: future engine-owned fields such as alias hints or import provenance would further pollute `properties`.

The file format needs a reserved place for Corum-owned node bookkeeping that is clearly separate from template properties and from existing lifecycle metadata.

---

## Decision Drivers

- **Clarity for humans and agents.** Node-describing content and tool-owned bookkeeping must be visibly distinct in YAML.
- **Accurate naming.** Identity history should use `previousIds`, not `previousNames`.
- **Controlled extensibility.** The format should allow future Corum-owned bookkeeping without creating an unbounded generic bucket like `system`.
- **Backwards migration path.** Existing graphs using `properties.previousNames` must be upgradable without ambiguity.

---

## Decision

Reserve a top-level `corum` section in node cluster documents for Corum-owned bookkeeping.

The first field under that namespace is:

```yaml
corum:
  identity:
    previousIds:
      - orders.Schema.invoice
```

Rules:

- `corum` is reserved for Corum-owned data. Template schemas cannot define or validate fields inside it.
- `corum.identity.previousIds` is a list of prior full node IDs, oldest first.
- `corum.identity.previousIds` replaces `properties.previousNames`.
- `previousIds` must never contain the node's current live ID.
- `renamed-from` edges remain the graph-level continuity record; `previousIds` is the node-local summary of that same history.

---

## Rationale

Why `corum`:

- It clearly marks the namespace as tool-owned rather than domain-owned.
- It avoids collisions with team vocabulary such as `system`, `identity`, or `history`.
- It provides one disciplined extension point for future Corum bookkeeping.

Why not `properties.previousNames`:

- Template `properties` are node-type data, not engine state.
- The field stores IDs, not names.
- Linter and loader special-casing inside `properties` makes the model harder to explain and reason about.

Why not a generic `system` top-level section:

- `system` is too broad and invites an undifferentiated bucket of unrelated concerns.
- `corum` makes ownership explicit while still allowing structured sub-sections such as `identity` and later `provenance`.

---

## Consequences

**What becomes easier:**

- Rename history is visibly first-class and no longer masquerades as template data.
- Future Corum-owned fields such as alias hints can be added without contaminating template schemas.
- MCP responses and docs can describe a clean separation: `metadata` for lifecycle/provenance already in the logical model, `properties` for template data, `corum` for Corum bookkeeping.

**What becomes harder:**

- Loader, writer, linter, mutation, reconcile, and MCP serializers all need a coordinated migration from `properties.previousNames`.
- Existing tests and fixtures must be updated to the new YAML shape.

---

## Initial Scope

This ADR only standardises:

1. the reserved `corum` top-level namespace
2. `corum.identity.previousIds`

It does not yet standardise other `corum.*` fields. Future additions must be explicitly named and documented rather than inferred from the existence of the namespace.

---

## Migration

The implementation should:

- read old `properties.previousNames` for compatibility during transition
- write only `corum.identity.previousIds`
- expose a single canonical runtime/API field for rename history during the migration window
- remove the old representation once repository fixtures, smoke tests, and docs have been migrated

---

## Related

- ADR-002: cluster YAML structure and top-level node document shape
- ADR-003b: universal node properties and the distinction between metadata and template properties
- ADR-005: MCP read/write surfaces that expose node identity history
- ADR-006: lint rules for reserved sections and rename-history validation
