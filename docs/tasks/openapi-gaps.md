# OpenAPI Adapter: Known Representation Gaps

Corum's referential model requires every type to be a named node. OpenAPI's
structural model allows types to be described inline, recursively, without
names. This document records the cases where that gap produces a lossy import,
along with the current fallback behaviour and what full support would require.

## Gaps

### 1. Union types (`oneOf` / `anyOf`) — HIGH PRIORITY

**OpenAPI:**
```yaml
field:
  oneOf:
    - $ref: '#/components/schemas/TypeA'
    - $ref: '#/components/schemas/TypeB'
```

**Current behaviour:** warning emitted, field rendered as `type: string`.

**Full support:** Corum would need a `oneOf` field property (list of node refs)
and corresponding UI/MCP handling. Common in error response polymorphism and
discriminated unions.

**Fixture:** `test/fixtures/openapi/specs/openapi-gaps.yaml` — `primaryMetric`
field.

---

### 2. Double-nested map (`Map<K, Map<K, V>>`) — ADDRESSED

**OpenAPI:**
```yaml
field:
  type: object
  additionalProperties:
    type: object
    additionalProperties:
      type: integer
```

**Current behaviour:** warning emitted, field rendered as
`collection: map-of-map, type: string` (value type lost).

**`collection: map-of-map`** was added specifically to represent this shape,
preserving that the field is a nested map even when the value type cannot be
named.

**Fixture:** `test/fixtures/openapi/specs/openapi-gaps.yaml` —
`perPersonBreakdown` field.

---

### 3. Map-of-array (`Map<K, V[]>`) — LOW PRIORITY

**OpenAPI:**
```yaml
field:
  type: object
  additionalProperties:
    type: array
    items:
      $ref: '#/components/schemas/Metric'
```

**Current behaviour:** warning emitted, field rendered as
`collection: map, type: string` (array shape and value type both lost).

**Full support:** would require `collection: map-of-array` and a separate
ref for the array item type.

**Fixture:** `test/fixtures/openapi/specs/openapi-gaps.yaml` —
`groupedMetrics` field.

---

### 4. Anonymous inline objects in shared-schema context — MEDIUM PRIORITY

**OpenAPI:**
```yaml
# components/schemas (not in a path operation)
ReportSummary:
  type: object
  properties:
    location:
      type: object   # anonymous, no endpoint context
      properties:
        lat: {type: number}
        lng: {type: number}
```

**Current behaviour:** warning emitted, field rendered as `type: string`.
Anonymous objects ARE expanded correctly when they appear inside a path
operation's inline schemas (endpoint context provides a rootId for the
sibling schema). The gap is specifically for schemas that are only ever
referenced via `$ref` and never appear as an endpoint's direct request/response.

**Full support:** treat the shared schema itself as the root when emitting
inline sibling schemas.

**Fixture:** `test/fixtures/openapi/specs/openapi-gaps.yaml` — `location`
field on `ReportSummary`.

---

## What is NOT a gap

- **Recursive / self-referential schemas** — handled correctly. `localSchemas`
  is populated before `emitFields` is called, so a schema that references itself
  resolves to the already-registered local ref.
- **`allOf: [{$ref}]` nullable pattern** — unwrapped by `resolveAllOfRef`.
- **`additionalProperties: boolean`** — treated as `collection: map, type: string`.
- **`patternProperties`** — regex-keyed maps; extremely rare in practice, not modelled.
- **`not` / `if` / `then` / `else`** — validation-only constructs, no semantic graph meaning.

## Collection model summary

| `collection` value | Meaning                          | OpenAPI shape                              |
|--------------------|----------------------------------|--------------------------------------------|
| *(absent)*         | Single value (default)           | plain `$ref` or scalar                     |
| `array`            | Ordered list                     | `type: array, items: ...`                  |
| `map`              | String-keyed dictionary          | `type: object, additionalProperties: ...`  |
| `map-of-map`       | Nested string-keyed dictionary   | nested `additionalProperties`              |
