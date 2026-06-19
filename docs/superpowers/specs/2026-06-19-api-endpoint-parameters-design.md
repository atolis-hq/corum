# APIEndpoint Parameters Design

**Date:** 2026-06-19  
**Status:** Approved

## Summary

Add a `parameters` property to `APIEndpoint` nodes to represent HTTP operation parameters — path, query, and header. Parameters are modelled as an inline map inside `properties`, following the same pattern as `responses`. Cookie parameters are out of scope.

## Decisions

- **Parameters are not independently addressable nodes** — inline map property, not an owned section, no child nodes, no structural edges.
- **All three locations are modelled**: `path`, `query`, `header`. Path parameters are included because the path string gives only the name, not the type.
- **Single `parameters` map** keyed by parameter name, with `location` as a field on each entry — mirrors the `responses` map pattern exactly. Parameter names are unique within an operation (OpenAPI requirement), so the name is a safe key.
- **`$defs`** defines the parameter shape once within the `APIEndpoint.yaml` properties schema; `query` and `headers` reference it via `$ref: '#/$defs/Parameter'`. Avoids duplication, stays standard JSON Schema.
- **Enum-constrained parameters map to `type: string`** — enum values are a validation concern in the source spec, not the graph model.
- **`required: boolean`** rather than `nullable: boolean` (as on `Field`) — semantically correct for parameters ("must the caller supply this").
- **Type vocabulary identical to `Field`**: same scalar type enum, same `cardinality` values.
- **No server-side transformation** — structured `{ location, type, required, cardinality }` preserved in API and MCP responses. Keeps data editable in a future edit mode and consistent across all consumers.
- **UI** renders via the existing generic `PropertiesTable` (nested object expansion). No UI changes required.

## Template: APIEndpoint.yaml

Add a `parameters` property inside the existing `properties` schema, alongside `method`, `path`, `request`, and `responses`. Use `$defs` at the properties schema root to define the parameter shape once:

```yaml
properties:
  type: object
  $defs:
    Parameter:
      type: object
      additionalProperties: false
      required:
        - location
        - required
        - cardinality
      properties:
        location:
          type: string
          enum: [path, query, header]
        type:
          type: string
          enum: [uuid, string, integer, decimal, boolean, datetime, date, time]
        required:
          type: boolean
        cardinality:
          type: string
          enum: [one, many]
  properties:
    method: ...   # unchanged
    path: ...     # unchanged
    description:  # unchanged
    parameters:
      type: object
      description: "Parameters accepted by this operation, keyed by name"
      additionalProperties:
        $ref: '#/$defs/Parameter'
    request: ...   # unchanged
    responses: ... # unchanged
```

Both `parameters` and `type` within a parameter are optional to allow partial definitions, but `location`, `required`, and `cardinality` are required on every parameter entry.

## Cluster YAML shape

Parameters sit inside `properties` alongside `method`, `path`, and `responses`:

```yaml
properties:
  method: GET
  path: /pet/{petId}
  parameters:
    petId:
      location: path
      type: integer
      required: true
      cardinality: one
  responses:
    '200': pet.Schema.Pet
    default: shared.Schema.Error
```

```yaml
properties:
  method: GET
  path: /pet/findByStatus
  parameters:
    status:
      location: query
      type: string
      required: false
      cardinality: one
  responses:
    '200': '#/schemas/findPetsByStatus-response-200'
```

```yaml
properties:
  method: DELETE
  path: /pet/{petId}
  parameters:
    petId:
      location: path
      type: integer
      required: true
      cardinality: one
    api_key:
      location: header
      type: string
      required: false
      cardinality: one
```

## Mapper: src/adapters/openapi/mapper.ts

In `mapDocument`, after building each endpoint node, collect parameters from both `pathItem.parameters` and `operation.parameters`. Operation-level parameters take precedence over path-item parameters with the same name (standard OpenAPI override semantics).

For each parameter:
- Skip `in: cookie` — out of scope.
- Skip `$ref` parameter objects — not resolved.
- Map `in` value: `path → path`, `query → query`, `header → header`.
- Derive `type` and `cardinality` from the parameter's `schema`:
  - `schema.type === 'array'` → `cardinality: many`, type from `schema.items`
  - Otherwise → `cardinality: one`, type from `schema.type` / `schema.format`
  - Use existing `deriveScalarType()` for type mapping.
  - Enum-constrained schemas (`schema.enum` present) → `type: string`.
  - Unknown types → emit warning diagnostic, default to `type: string`.
- `required` from `parameter.required ?? false`.
- Accumulate into a single `parameters` map; set on `endpointNode.properties.parameters` only if non-empty.

## Tests

### New fixture spec: `test/fixtures/openapi/specs/params-example.yaml`

A minimal OpenAPI spec covering:
- `GET /items/search` — query params: one scalar (`limit: integer, required`), one array (`tags: string[], optional`), one enum-constrained (`status: string` with enum values → maps to `type: string`)
- `GET /items/{itemId}` — path param only (`itemId: uuid, required`)
- `DELETE /items/{itemId}` — path param (`itemId: uuid, required`) + header param (`X-Api-Key: string, required`)
- Path-item-level parameter shared across operations under the same path

### New golden directory: `test/fixtures/openapi/expected/params-example/`

One YAML file per endpoint with expected output including `parameters` in properties. Normalized `<date>` and `<spec>` placeholders as per existing golden tests.

### New test case: `test/import/runner.test.ts`

```
describe('import runner — params-example.yaml')
  it('output matches golden files')
```

### New unit tests: `test/adapters/openapi/mapper.test.ts`

Direct calls to `mapDocument` covering:
- Query param with `cardinality: one`
- Query param with `cardinality: many` (array schema)
- Enum-constrained query param maps to `type: string`
- Path param appears in `parameters` with `location: path`
- Header param appears in `parameters` with `location: header`
- Cookie param is skipped
- Path-item-level param is inherited by operations
- Operation-level param overrides path-item param of the same name

## Out of Scope

- Cookie parameters
- `$ref` parameter objects (parameter references in `components/parameters`)
- Parameter `description` field (not modelled — `Field` has no description property either)
- `deprecated` flag on parameters
- `style` / `explode` serialization hints
