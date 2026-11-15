# ADR-008: Template Structure and Reference Syntax

**Status:** Accepted  
**Date:** 2026-04-19  
**Deciders:** Product Owner  
**Depends on:** ADR-004 (Template Pack Format), ADR-003d (Inline Schema and Reference Resolution)  
**Related:** ADR-006 (Linter and Validator)

---

## Context

Three problems emerged during web app development:

1. **Template metadata is flat at the top level** (`version`, `core`, `abstract`, `description` alongside structural keys like `properties` and `ui`), making it harder to distinguish metadata from owned sections at a glance.

2. **Field type declaration uses bespoke keys** (`scalarType`/`objectRef`) that are not recognisable to anyone familiar with OpenAPI or JSON Schema.

3. **Schema reference values in node data files are plain strings** with no syntactic signal that they are references rather than arbitrary labels — a `request: create-order-request` in an APIEndpoint file looks the same as any other string property.

A future linter will validate node files using JSON Schema tooling. The template format should be compatible with that tooling now.

---

## Decisions

### 1. Template `info:` block

Metadata fields `version`, `core`, `abstract`, and `description` are nested under a top-level `info:` key. `name` and `extends` remain at the top level as structural identifiers.

```yaml
name: APIEndpoint
info:
  version: "1.0.0"
  core: false
  abstract: false
  description: |
    An HTTP operation exposed to external consumers.
```

Aligns with the `info:` convention in OpenAPI and AsyncAPI.

### 2. Field type: `type` / `$ref`

The `scalarType` / `objectRef` pair is replaced with `type` (primitives) XOR `$ref` (node references). These are mutually exclusive, mirroring OpenAPI's schema pattern.

```yaml
fields:
  id:
    type: uuid            # primitive — closed enum of known scalar types
    nullable: false
    cardinality: one
  status:
    $ref: '#/enums/order-status'   # local enum ref
    nullable: false
    cardinality: one
  items:
    $ref: '#/schemas/order-line-item'  # local schema ref
    nullable: false
    cardinality: many
```

`cardinality: one | many` is retained as a domain concept rather than `type: array` — it enables meaningful semantic diffs over time and supports future richness (e.g. `zero-or-one`).

The `$ref` key is reserved for field type declarations only. It is not a JSON Schema `$ref` — these are Corum data files, not JSON Schema documents. JSON Schema validators treat `$ref` under `properties:` as a plain property name when validating data, so this is safe for future linter use. The `$` prefix is a deliberate signal that the value is a reference, consistent with the OpenAPI convention authors already know.

### 3. `format: node-ref` in template property schemas

Wherever a template property accepts a local schema/enum name or global node ID, the property schema is annotated with `format: node-ref`. This is the JSON Schema extension point for string semantics — the same mechanism OpenAPI uses for `format: uuid`, `format: date-time`, etc.

```yaml
# APIEndpoint.yaml — properties block
request:
  type: string
  format: node-ref

responses:
  type: object
  additionalProperties:
    type: string
    format: node-ref
```

The server uses this annotation to resolve values and return `{ display, nodeId }` objects for UI link rendering. The linter will use it for reference validation.

### 4. `#/schemas/` and `#/enums/` prefix convention

All node-ref values in node data files use the same prefix convention as field `$ref` values. This makes references immediately distinguishable from plain strings without requiring authors to know the template schema.

```yaml
# node data
properties:
  request: '#/schemas/create-order-request'
  responses:
    "201": '#/schemas/create-order-response'
    "400": '#/schemas/problem-detail'
```

- `#/schemas/<name>` — local schema in this node's `schemas:` block
- `#/enums/<name>` — local enum in this node's `enums:` block  
- bare string — global node ID

The `#/` prefix must be single-quoted in YAML (unquoted `#` starts a comment). Writers must ensure these values are always emitted quoted.

---

## Consequences

- All existing template YAML files require an `info:` block migration.
- All existing node data files require field `scalarType`/`objectRef` → `type`/`$ref` migration, plus `#/schemas/` prefix on node-ref property values.
- The graph writer must be verified to emit quoted `#/`-prefixed strings.
- Template schemas must not use JSON Schema `$ref` for internal composition while `$ref` is also defined as a valid data property name in the same file — this would create two meanings of `$ref` in one document. Revisit if template schemas grow complex enough to need DRY composition.
