# APIEndpoint Parameters Design

**Date:** 2026-06-19  
**Status:** Approved

## Summary

Add `query` and `headers` as inline properties on `APIEndpoint` nodes to represent HTTP operation parameters. Path parameters are implicit in the `path` string and not modelled explicitly. Cookie parameters are out of scope.

## Decisions

- Parameters are **not** independently addressable nodes — no child nodes, no `maps-to` edges from parameters.
- Path parameters are implicit from the path string (e.g. `/pet/{petId}`); no explicit modelling needed.
- Only `query` and `header` locations are declared explicitly.
- Enum-constrained parameters map to `type: string` — enum values are a validation concern that lives in the source spec, not the graph model.
- `required: boolean` is used instead of `nullable: boolean` (as on `Field`) — semantically correct for parameters.
- Otherwise the type vocabulary (`type`, `cardinality`) is identical to `Field`: same scalar type enum, same cardinality values.
- No server-side transformation of parameter data — structured `{ type, required, cardinality }` is preserved in the API and MCP responses, keeping the data editable in a future edit mode and consistent across all consumers.
- UI renders parameters via the existing generic `PropertiesTable` (3-level nested object expansion). No UI changes required.

## Template: APIEndpoint.yaml

Add two new optional top-level properties alongside `request` and `responses`:

```yaml
query:
  type: object
  description: "Query parameters accepted by this operation"
  additionalProperties:
    type: object
    additionalProperties: false
    required:
      - required
      - cardinality
    properties:
      type:
        type: string
        enum: [uuid, string, integer, decimal, boolean, datetime, date, time]
      required:
        type: boolean
      cardinality:
        type: string
        enum: [one, many]

headers:
  type: object
  description: "Request header parameters accepted by this operation"
  additionalProperties:
    type: object
    additionalProperties: false
    required:
      - required
      - cardinality
    properties:
      type:
        type: string
        enum: [uuid, string, integer, decimal, boolean, datetime, date, time]
      required:
        type: boolean
      cardinality:
        type: string
        enum: [one, many]
```

`type` is required unless omitted — there is no `$ref` alternative (parameters are not addressable), so `type` is always the type mechanism. Both `query` and `headers` are optional on the node; omit when the operation has no parameters of that kind.

## Mapper: src/adapters/openapi/mapper.ts

In `mapDocument`, after building the endpoint node, collect parameters from both `pathItem.parameters` and `operation.parameters`. Operation-level parameters take precedence over path-item parameters with the same name and location (standard OpenAPI override semantics).

For each parameter:
- Skip `in: path` — implicit from the path string.
- Skip `in: cookie` — out of scope.
- Skip `$ref` parameter objects — not resolved.
- Derive `type` and `cardinality` from the parameter's `schema`:
  - `schema.type === 'array'` → `cardinality: many`, type from `schema.items`
  - Otherwise → `cardinality: one`, type from `schema.type` / `schema.format`
  - Use existing `deriveScalarType()` for type mapping.
  - Enum-constrained schemas → `type: string`.
  - Unknown types → emit a warning diagnostic, default to `type: string`.
- `required` comes from `parameter.required ?? false`.
- Accumulate into `query` and `headers` maps; set on `endpointNode.properties` only if non-empty.

Example output for `GET /pet/findByStatus`:

```yaml
properties:
  method: GET
  path: /pet/findByStatus
  description: Finds Pets by status.
  query:
    status:
      type: string
      required: false
      cardinality: one
  responses:
    '200': '#/schemas/findPetsByStatus-response-200'
```

Example output for `GET /pet/findByTags`:

```yaml
query:
  tags:
    type: string
    required: false
    cardinality: many
```

Example output for `DELETE /pet/{petId}` (header param, path param excluded):

```yaml
headers:
  api_key:
    type: string
    required: false
```

## Tests

### New fixture spec: `test/fixtures/openapi/specs/params-example.yaml`

A minimal OpenAPI spec covering:
- `GET /items/search` — two query params: one scalar (`limit: integer`), one array (`tags: string[]`), one enum-constrained (`status: string` with enum values)
- `DELETE /items/{itemId}` — one header param (`X-Api-Key: string, required`), path param excluded
- `GET /items/{itemId}` — path param only, confirming no `query` or `headers` appear in output

### New golden directory: `test/fixtures/openapi/expected/params-example/`

One YAML file per endpoint reflecting the expected output, including normalized `<date>` and `<spec>` placeholders.

### New test case in `test/import/runner.test.ts`

```
describe('import runner — params-example.yaml')
  it('output matches golden files')
```

### New unit tests in `test/adapters/openapi/mapper.test.ts`

Direct calls to `mapDocument` covering:
- Query param with `cardinality: one`
- Query param with `cardinality: many` (array schema)
- Enum-constrained query param maps to `type: string`
- Header param appears in `headers`, not `query`
- Path param produces no output
- Path-item-level param is inherited by operations
- Operation-level param overrides path-item param of same name

## Out of Scope

- Cookie parameters
- `$ref` parameter objects (parameter references in `components/parameters`)
- Parameter `description` field (not modelled — same as `Field` which has no description property)
- `deprecated` flag on parameters
- `style` / `explode` serialization hints
