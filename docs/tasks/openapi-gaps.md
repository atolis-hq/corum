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

**Current behaviour:** field rendered as `collection: map-of-map` with `type`
or `$ref` resolved from the inner `additionalProperties` value. Scalar inner
types (e.g. `integer`) and `$ref` inner types are both resolved correctly.
A warning is only emitted when the inner value is a further-nested object that
cannot be represented.

**`collection: map-of-map`** was added to represent this shape; the value type
is now resolved from the inner `additionalProperties`, consistent with how all
other collection types carry their element type.

**Fixture:** `test/fixtures/openapi/specs/openapi-gaps.yaml` —
`perPersonBreakdown` field.

---

### 3. Map-of-array (`Map<K, V[]>`) — ADDRESSED

**OpenAPI:**
```yaml
field:
  type: object
  additionalProperties:
    type: array
    items:
      $ref: '#/components/schemas/Metric'
```

**Current behaviour:** field rendered as `collection: map-of-array` with `$ref`
(or `type`) pointing to the array element type. No information lost.

**`collection: map-of-array`** was added to represent this shape. The `type`
or `$ref` property describes the array element, consistent with how `collection:
array` works.

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
| `map-of-array`     | String-keyed dictionary of arrays | `additionalProperties: {type: array, items: ...}` |
