# Corum Transport Importer — Design Spec

## Overview

Implement an importer for the **corum interchange format** (`*.corum.yaml`), the output of extraction tools such as the treesitter-based `corum-extract`. The format is a flattened, pack-agnostic representation of corum nodes and edges that can be reconstructed into graph clusters.

The adapter is simpler than openapi/asyncapi because the interchange format is already corum-native: node IDs, template names, and `$ref` values require no concept translation. The adapter's job is parse, validate the envelope, reshape to `Node`/`Edge` objects, and surface gaps as warnings.

---

## Format Summary

A `*.corum.yaml` file has six top-level sections:

| Section | Required | Description |
|---|---|---|
| `corumInterchange` | yes | Format version string (currently `"1.0"`) |
| `targets` | no | Pack requirements declared by the extractor |
| `source` | no | Extractor metadata (tool name, version, language, repo) |
| `nodes` | yes | Flat list of all nodes including structural children |
| `edges` | no | Explicit non-structural edges (e.g. `produces`) |
| `gaps` | no | Diagnostics from the extractor (unresolved types, collisions) |

Each node has `id`, `template`, `properties`, and `provenance`. The ID encodes the full ownership hierarchy (`component.Template.name.section.childname`). Template names are corum-native (`Command`, `Field`, `EnumDefinition`, etc.). Field `$ref` values are already corum node IDs.

Each edge has `from`, `to`, `type`, and `provenance`. Edge IDs are absent from the file and constructed as `{from}__{type}__{to}`.

---

## New Files

### Extract pack

```
.corum/packs/extract/
  pack.yaml                   # pack manifest
  adapters/corum.yaml         # adapter config stub (constructs: {}, scalarTypes: {})
  interchange.schema.yaml     # formal envelope schema (tooling contract for extractors)
```

### Adapter

```
src/adapters/corum/
  index.ts      # CorumAdapter class — thin orchestrator
  parser.ts     # YAML parse + CorumInterchangeDocument interface + type guard
  mapper.ts     # converts parsed doc → Node[] + Edge[], maps provenance
```

### Changed files

```
src/adapters/index.ts     # register CorumAdapter
src/import/config.ts      # add CorumImportEntry to ImportEntry union
src/bin/corum.ts          # add `corum import corum <spec>` subcommand
README.md                 # document extract pack, import entry, CLI usage
```

### Tests

```
test/adapters/corum/mapper.test.ts
test/import/corum-runner.test.ts
test/fixtures/corum/basic.corum.yaml
```

---

## Import Entry

```typescript
export interface CorumImportEntry {
  adapter: 'corum'
  spec: string
}
```

Config YAML usage:
```yaml
imports:
  - adapter: corum
    spec: path/to/output.corum.yaml
```

No component-mapping strategy is needed — the component is already the first segment of every node ID.

---

## Data Flow

```
CorumImportEntry
      │
      ▼
parser.ts  parseSpec(specPath)
  - readFileSync + yaml.parse
  - isCorumInterchangeDocument() type guard
      • requires: corumInterchange (string), nodes (array)
      • each node requires: id (string), template (string)
  - validates version is "1.0" — warning on unknown version, error if key missing
  - returns { document | null, diagnostics }
      │
      ▼
mapper.ts  mapDocument(document, specPath)
  - gaps[] → one warning diagnostic per gap (kind + reason)
  - nodes[] → Node objects:
      • component = id.split('.')[0]
      • derivation: 'resolved' → 'determined', 'inferred' → 'inferred', absent → 'determined'
      • derivedBy: `adapter:corum/${provenance.by}` or `adapter:corum` if absent
      • state: 'implemented', stability: 'unstable'
      • properties passed through as-is (template-specific, validated by graph loader)
  - edges[] → Edge objects:
      • id = `{from}__{type}__{to}`
      • type validated against known EdgeType values — warning + skip if unknown
      • derivation/derivedBy mapped same as nodes
      • state: 'implemented', stability: 'unstable'
  - NO structural edge reconstruction (runner skips has-field/has-value; hierarchy
    is encoded in node IDs and reconstructed by the cluster loader)
  - returns { nodes, edges, diagnostics }
      │
      ▼
AdapterResult → runner → diffNodes → serializeGraph → commit
```

The adapter **ignores `context.packConfig`** — the interchange format is self-describing and requires no template mapping or scalar type translation.

---

## Provenance Mapping

| Interchange `provenance.derivation` | Node `derivation` |
|---|---|
| `resolved` | `determined` |
| `inferred` | `inferred` |
| absent | `determined` |

`provenance.confidence` is extractor-internal metadata. It informed which nodes were included in the file. The importer does not act on it — all nodes present in the file are imported. Filtering is the extractor's responsibility.

`provenance.by` → `derivedBy: 'adapter:corum/{by}'` (e.g. `adapter:corum/treesitter`).

---

## The `interchange.schema.yaml`

Lives in the extract pack. Defines the envelope structure only — node properties are template-specific and validated by the graph loader post-import, not here.

The schema is a documentation and tooling contract: extraction tools (treesitter etc.) can validate their output against it before shipping. It is **not** used for runtime validation in the adapter — the adapter uses TypeScript type guards.

---

## CLI

New subcommand:
```
corum import corum <spec>
  [--graph <path>]   Override CORUM_GRAPH_PATH
```

Help menu update to `corum import --help`:
```
Commands:
  openapi <spec>    Import an OpenAPI spec into the graph
  asyncapi <spec>   Import an AsyncAPI spec into the graph
  corum <spec>      Import a corum interchange file into the graph
```

---

## Extract Pack Config

`adapters/corum.yaml` — present to satisfy the runner's pack config requirement. The adapter ignores its contents.

```yaml
adapter: corum
version: '1.0'
constructs: {}
scalarTypes: {}
```

---

## Error Handling

| Condition | Behaviour |
|---|---|
| File not found / unreadable | error diagnostic, import skipped |
| YAML parse failure | error diagnostic, import skipped |
| Missing `corumInterchange` key | error diagnostic, import skipped |
| Unknown `corumInterchange` version | warning diagnostic, import continues |
| Node missing `id` or `template` | warning + skip that node |
| Edge with unknown `type` | warning + skip that edge |
| Gap entry | warning diagnostic (kind + reason surfaced) |

---

## Testing

**`test/adapters/corum/mapper.test.ts`** — unit:
- Resolved node → `derivation: 'determined'`, `state: 'implemented'`
- Inferred node → `derivation: 'inferred'`
- `provenance.by` → `derivedBy` formatting
- Missing provenance handled gracefully (defaults to `determined`)
- Edge ID construction (`{from}__{type}__{to}`)
- Unknown edge type → warning + skip
- Gap entry → warning diagnostic

**`test/import/corum-runner.test.ts`** — integration:
- Fixture `test/fixtures/corum/basic.corum.yaml`: handful of nodes (Command, Schema, Field, EnumDefinition, EnumValue, DomainEvent) + one `produces` edge + one gap
- Full import run against temp graph dir
- Asserts serialized cluster YAML matches golden files in `test/fixtures/corum/expected/`
