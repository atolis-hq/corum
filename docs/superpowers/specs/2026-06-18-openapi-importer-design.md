# OpenAPI Importer — Design Spec

**Status:** Proposed
**Date:** 2026-06-18
**Implements:** ADR-009 (Importer Architecture) — in-process `SpecAdapter` front door
**Depends on:** ADR-003b (data model + `derivation`), ADR-009 (importer architecture), 2026-06-17-openapi-adapter-design.md (mapping detail)
**Supersedes mapping detail in:** 2026-06-17-openapi-adapter-design.md (that doc covers the node mapping; this doc covers the full build: CLI, config, pack adapter config, reconcile, testing)

---

## 1. Scope

This document specifies the full OpenAPI importer build — the first end-to-end adapter in Corum. It covers:

- Project structure and where new code lives
- Import config format and CLI interface
- Pack adapter config (how the `rest` pack declares its OpenAPI mappings)
- `SpecAdapter` interface
- Parsing approach
- Reconcile (v1, per-component scope)
- Testing strategy and done criteria

It does not re-specify the OpenAPI → node mapping detail (field types, ID derivation, owned sections) — that remains in `2026-06-17-openapi-adapter-design.md`.

---

## 2. Architecture overview

Three new pieces added to the existing `corum` package. All existing code (schema types, pack loader, graph writer, MCP server) is unchanged except adding `derivation` and `derivedBy` to `Node` and `Edge` in `src/schema/index.ts`.

```
src/
  adapters/
    index.ts           SpecAdapter interface, AdapterContext, AdapterResult, registry
    openapi/
      index.ts         OpenAPIAdapter class
      parser.ts        swagger-parser bundle() wrapper
      mapper.ts        OpenAPI document → Node[]/Edge[] using pack adapter config
  import/
    config.ts          ImportConfig type, YAML loader, CLI normalisation
    runner.ts          orchestrates: load config → load pack → run adapter → reconcile → write
  reconcile/
    index.ts           per-component reconcile (v1)
  bin/
    corum.ts           CLI entry point (commander)
```

**Pipeline for a single import run:**

```
corum import [flags | --config file]
  → normalise to ImportConfig
  → load active packs (existing pack loader, unchanged)
  → load pack adapter config from active pack
  → run SpecAdapter → { nodes, edges, diagnostics }
  → reconcile against existing graph
  → write/update cluster YAML (existing graph writer)
  → stage-1 lint
  → report diagnostics
```

`corum reconcile` (cross-component pass) is a separate command, out of scope for this build.

---

## 3. Schema changes

**TypeScript types** — add optional fields to `Node` and `Edge` in `src/schema/index.ts`, as specified in ADR-003b:

```typescript
interface Node {
  // ... existing fields unchanged ...
  extractedFrom?: string                           // source spec/code path — already present
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string    // e.g. 'adapter:openapi', 'extractor:treesitter'
}

interface Edge {
  // ... existing fields unchanged ...
  derivation?: 'determined' | 'inferred' | 'manual'
  derivedBy?: string
}
```

**YAML cluster files** — `extractedFrom`, `derivation`, and `derivedBy` all live inside the `metadata` block (updated in `node.schema.yaml`). An imported cluster file looks like:

```yaml
id: orders.APIEndpoint.create-order
template: APIEndpoint
schemaVersion: "1"

metadata:
  component: orders
  state: implemented
  stability: unstable
  lastModifiedAt: "2026-06-18"
  extractedFrom: ./specs/orders-api.yaml   # source spec — in metadata alongside state/stability
  derivation: determined
  derivedBy: adapter:openapi

properties:
  method: POST
  path: /orders/...
```

**Implementation note — writer/loader separation:** The writer (`graph-writer.ts`) currently uses `Node.extractedFrom` as the cluster output file path, and the loader sets it to the cluster file path. These are two distinct concepts that must be separated before the importer can use `extractedFrom` for the source spec path. The implementation plan will address this: the cluster output path should be derived from the node ID (component + template + name), freeing `extractedFrom` to carry its intended meaning.

---

## 4. Import config format

`ImportConfig` is the single canonical representation. Both the YAML file loader and the CLI flag parser produce one — nothing downstream sees anything else.

```typescript
interface ImportConfig {
  imports: ImportEntry[]
}

type ImportEntry = OpenAPIImportEntry | AsyncAPIImportEntry

interface OpenAPIImportEntry {
  adapter: 'openapi'
  spec: string                          // file path or URL
  componentMapping:
    | { strategy: 'uri-segment'; segment: number }    // positional: /orders/v1/... → segment 0 → "orders"
    | { strategy: 'uri-segment'; pattern: string }    // regex: first capture group from URI
    | { strategy: 'tag' }                             // OpenAPI operation tag → component
    | { strategy: 'hardcoded'; component: string }    // explicit, for specs with no derivable structure
}

interface AsyncAPIImportEntry {
  adapter: 'asyncapi'
  spec: string
  componentMapping:
    | { strategy: 'channel' }
    | { strategy: 'hardcoded'; component: string }
}
```

**Config file** (`corum-imports.yaml` at graph root, or `--config <path>`):

```yaml
imports:
  - adapter: openapi
    spec: ./specs/orders-api.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0

  - adapter: openapi
    spec: ./specs/gateway-api.yaml
    componentMapping:
      strategy: uri-segment
      pattern: "^/([^/]+)/"

  - adapter: openapi
    spec: ./specs/legacy-api.yaml
    componentMapping:
      strategy: hardcoded
      component: legacy
```

Graph output path comes from the existing graph config (`.corum/graph` by default) — no new field needed.

---

## 5. CLI interface

A new `bin/corum.ts` entry point using `commander`. Added to `package.json`:

```json
{
  "bin": { "corum": "./dist/bin/corum.js" }
}
```

**Commands:**

```
corum import openapi <spec> [flags]    # single spec — flags normalise to ImportConfig
corum import --config <file>           # config file — one or many specs
```

**Single-spec flags** (mirror `OpenAPIImportEntry` field names exactly):

```
corum import openapi ./orders.yaml --component-strategy uri-segment --segment 0
corum import openapi ./gateway.yaml --component-strategy uri-segment --pattern "^/([^/]+)/"
corum import openapi ./legacy.yaml --component-strategy hardcoded --component legacy
```

**Normalisation — single code path downstream:**

```typescript
// CLI single-spec path
const config: ImportConfig = {
  imports: [{
    adapter: 'openapi',
    spec: args.spec,
    componentMapping: buildComponentMapping(opts)
  }]
}
runImport(config, graphPath)

// Config file path
const config = loadImportConfig(opts.config)
runImport(config, graphPath)
```

**Exit codes:** 0 = success (warnings allowed), 1 = import errors, 2 = config/invocation error. Diagnostics to stderr; summary line to stdout.

---

## 6. Pack adapter config

Lives at `.corum/packs/rest/adapters/openapi.yaml`. The adapter code is generic — template names, section names, and scalar mappings all come from this file.

```yaml
adapter: openapi
version: "1.0"

constructs:
  operation:
    template: APIEndpoint
    properties:
      summary: description          # only entries where openapi name ≠ template property name

  requestSchema:
    template: Schema
    section: schemas

  responseSchema:
    template: Schema
    section: schemas

  schemaProperty:
    template: Field
    section: fields

  enumDefinition:
    template: EnumDefinition
    section: enums

  enumValue:
    template: EnumValue
    section: values

scalarTypes:
  string:            string
  string/uuid:       uuid
  string/date:       date
  string/date-time:  datetime
  integer:           integer
  number:            decimal
  boolean:           boolean
```

**Discovery:** the pack loader already reads all files under `.corum/packs/*/`. The adapter queries loaded packs for an `adapters/openapi.yaml` entry. Missing config → `severity: error` diagnostic: `"No OpenAPI adapter config found in active packs — is the rest pack active?"`. If two active packs both ship an `adapters/openapi.yaml`, the pack declared last in `graph.yaml` wins (same precedence as template inheritance).

**Typed representation:**

```typescript
interface AdapterPackConfig {
  adapter: string
  version: string
  constructs: Record<string, ConstructMapping>
  scalarTypes: Record<string, string>
}

interface ConstructMapping {
  template: string
  section?: string
  properties?: Record<string, string>    // sparse: openapi field → template property
}
```

---

## 7. SpecAdapter interface

```typescript
interface SpecAdapter<TEntry extends ImportEntry = ImportEntry> {
  readonly adapterId: TEntry['adapter']
  import(entry: TEntry, context: AdapterContext): Promise<AdapterResult>
}

interface AdapterContext {
  packConfig: AdapterPackConfig
  templates: Map<string, Template>
}

interface AdapterResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}
```

Registry in `src/adapters/index.ts`:

```typescript
const registry = new Map<string, SpecAdapter>([
  ['openapi', new OpenAPIAdapter()],
])

function getAdapter(adapterId: string): SpecAdapter {
  const adapter = registry.get(adapterId)
  if (!adapter) throw new QueryError(`Unknown adapter: ${adapterId}`)
  return adapter
}
```

---

## 8. Parsing

**Library:** `@apidevtools/swagger-parser` via `bundle()` — resolves external file `$ref`s into a single document but preserves internal `$ref`s (e.g. `#/components/schemas/Order`). This is essential: the mapper must distinguish inline schemas (owned child nodes) from shared component schemas (standalone `Schema` nodes with `objectRef` on referencing fields). Full dereferencing would lose this distinction.

```typescript
// src/adapters/openapi/parser.ts
async function parseSpec(specPath: string): Promise<OpenAPIV3.Document> {
  return SwaggerParser.bundle(specPath) as Promise<OpenAPIV3.Document>
}
```

Parse errors (invalid YAML/JSON, broken `$ref`s, OpenAPI schema validation failures) surface as `severity: error` diagnostics and halt the import — no output files are written for a spec that fails to parse or validate.

**Supported formats:** YAML and JSON (handled natively by swagger-parser).
**Supported versions:** OpenAPI 3.0.x and 3.1.x. OpenAPI 2.0 (Swagger) not supported in v1.

**Shared vs inline schema detection in the mapper:**

```typescript
if ('$ref' in schema) {
  const name = schema.$ref.split('/').pop()   // '#/components/schemas/Order' → 'Order'
  // emit standalone Schema node; Field.objectRef = name
} else {
  // emit owned Schema node on the endpoint
}
```

---

## 9. Reconcile (v1 scope)

Per-component only. Cross-component concerns (maps-to proposals, multi-producer merging, stage-2 lint) are deferred to `corum reconcile`.

**Algorithm:**

```
reconcile(incoming: AdapterResult, specPath: string, graphPath: string)

1. Load existing graph (existing loader)
2. For each incoming node:
   - No existing node with this ID → new, queue write
   - Existing node, spec-owned properties changed → queue update
   - Existing node, unchanged → skip (idempotent)
3. For each existing node where extractedFrom === specPath
   and ID absent from incoming nodes:
   → set state: removed, queue update
4. Write queued changes via existing graph writer
5. Run stage-1 lint on affected cluster files
6. Return diagnostics
```

**Property ownership rules (step 2):**
- The adapter owns properties the spec expresses: method, path, field types, nullability, cardinality, operationId. These are overwritten on every import.
- The adapter does not touch human-owned properties the spec has no opinion on: `state`, `stability`, `notes`. These are preserved even when the node is otherwise updated.

**`derivation` rule:** the adapter's value always wins. If an existing node carries `derivation: manual` but the adapter now produces it deterministically, the node becomes `derivation: determined`. The human's prior authorship is visible in git history.

**Produced node fields:** all adapter-produced nodes carry `derivation: determined`, `derivedBy: 'adapter:openapi'`, `extractedFrom: <specPath>`.

---

## 10. Testing strategy

### Unit tests — pure functions, no I/O

| Function | What to cover |
|---|---|
| `buildComponentMapping(opts)` | All four strategies; regex edge cases; missing required flags |
| `loadImportConfig(path)` | Valid YAML, invalid YAML, missing file, wrong schema |
| ID derivation | Unusual operationIds, nested field paths, shared schema IDs |
| Scalar type mapping | All mapped types, unknown type → diagnostic |
| `$ref` detection | Inline schema, internal `$ref`, external `$ref` (post-bundle) |
| Reconcile diff | New node, changed node, unchanged node, orphan, `state: removed` already set |

### Fixture / golden file tests — full pipeline

```
test/fixtures/openapi/
  specs/
    orders-simple.yaml          # inline schemas only
    orders-shared.yaml          # components/schemas $refs
    orders-enums.yaml           # enum definitions
    multi-component.yaml        # multiple components via uri-segment
    orders-simple.json          # JSON format (same content as orders-simple.yaml)
  expected/
    orders-simple/              # expected cluster YAML output, byte-for-byte
      orders/
        APIEndpoint.create-order.yaml
    orders-shared/
      orders/
        APIEndpoint.create-order.yaml
        Schema.order.yaml
    ...
```

Each fixture test runs the full import pipeline and diffs output against `expected/`. Byte-identical match required. Idempotency is tested by running each fixture twice and asserting no second-run changes.

---

## 11. Done criteria

| # | Criterion |
|---|---|
| 1 | Importing a spec with inline schemas produces `APIEndpoint` nodes with correct method, path, field types, nullability |
| 2 | Importing a spec with `components/schemas` produces shared `Schema` nodes with `objectRef` on referencing fields |
| 3 | Enums produce `EnumDefinition` + `EnumValue` nodes |
| 4 | A spec covering multiple paths produces nodes in the correct components via uri-segment strategy |
| 5 | Re-importing an unchanged spec produces no file changes (idempotent) |
| 6 | A removed endpoint sets that node's `state: removed` |
| 7 | Both YAML and JSON spec files parse correctly |
| 8 | An invalid spec produces `severity: error` diagnostics and no output files |
| 9 | All produced nodes carry `derivation: determined`, `derivedBy: adapter:openapi`, `extractedFrom: <specPath>` |
| 10 | `state`, `stability`, and `notes` on existing hand-authored nodes are not overwritten by re-import |
| 11 | Unit test coverage on all pure functions in mapper, config loader, and reconcile step |
| 12 | Existing test suite (45 nodes, 38 edges) stays green |

---

## Related

- ADR-009 — Importer architecture (two front doors, one pipeline)
- ADR-003b — Core logical data model (`derivation` axis)
- 2026-06-17-openapi-adapter-design.md — OpenAPI → node mapping detail (ID derivation, type map, section ownership)
- 2026-06-17-treesitter-extractor-design.md — external producer built next
