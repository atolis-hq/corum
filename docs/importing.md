# Importing

Importing populates the graph from existing specifications so you aren't
modelling services from scratch. Imports are deterministic: the same spec
produces the same nodes.

| Adapter | Input | Pack needed |
| --- | --- | --- |
| `openapi` | OpenAPI specs (3.0, 3.2 examples in [spec-examples](spec-examples/openapi)) | `rest` |
| `asyncapi` | AsyncAPI specs (2.6 and 3.0 examples in [spec-examples](spec-examples/asyncapi)) | `messaging` |
| `corum` | `*.corum.yaml` interchange files from `corum-extract` tooling | `extract` |

## The Corum interchange format

OpenAPI and AsyncAPI cover contracts, but much of a real system isn't described
by a spec: domain models, commands, internal events, and the calls between
them. **Corum does not try to solve extraction.** Every codebase, language and
framework differs, so Corum instead defines one small, documented interchange
format (`*.corum.yaml`) and a single importer for it. Anything that can write
that file can feed the graph.

An interchange file has an envelope (`corum` version, optional `info`), a map
of `nodes` keyed by full Corum node ID, shared JSON-schema `components`, and
optional explicit `edges`. Schemas are expanded into `Schema` and `Field` nodes
at import time. Nodes can carry `x-aka` alternative names so the importer can
match them to nodes from other adapters (for example a controller class and an
OpenAPI operation), and provenance saying where each came from. The envelope is
defined by `.corum/packs/extract/interchange.schema.yaml`.

Edges may carry `notes` and `provenance.sources`, an ordered array of opaque
source IDs (for example, `['orders-service:src/CreateOrderHandler.cs#Handle']`).
Strings, order, and duplicates survive import and save/reload. MCP includes sources
only with `include_provenance: true`. Legacy `provenance.extractedFrom` remains
accepted as one source and retains its scalar output. When both forms appear,
`sources` is the complete list and takes precedence.

Re-import replaces a supplied list only for edges owned by that import source.
Omission preserves it; `sources: []` explicitly clears it. Edge identity and
interchange version 1.0 are unchanged. Prefer stable file-and-symbol IDs over
line numbers, which shift with unrelated edits and cause unnecessary rewrites.
Corum does not parse IDs or turn them into links.

Each node entry may set `parentId` to another node ID in the same document,
or to `null` to declare an independent root. Explicit ownership takes precedence
over ID shape; an unknown explicit parent is an error. Node and parent IDs use
the same component normalization (for example, `_` becomes `_unresolved`).
An explicit parent must be the direct owner in ID terms: `{parentId}.{section}.{name}`.

When `parentId` is omitted, compatibility inference drops the last two ID
segments and uses that parent only if it exists and has at least three segments.
Short namespace nodes therefore do not capture three-segment roots. Inference
through a section outside `schemas`, `enums`, `fields`, `values`, `mappings`,
and `operations` emits a heuristic warning but retains the relationship; custom
packs can own other sections, so explicit metadata avoids this warning.

For example, beside `orders.Schema.foo`, an independent node named
`orders.Schema.foo.fields.bar` must set `parentId: null`. An owned entry may
set `parentId: orders.Schema.foo` explicitly. Existing producers can omit
the field for conventional ownership. This optional addition keeps version
`1.0` and imposes no length restriction on root IDs.

How to produce one:

- **Ask an agent.** Point your coding agent at the repository, give it the
  interchange schema and the templates you use, and ask it to emit a
  `*.corum.yaml` file.
- **Have an agent build a script.** For something repeatable, ask the agent to
  write an extractor for your stack (a Roslyn, tree-sitter or reflection based
  script, say) that outputs the file, and run it in CI. Deterministic scripts are
  preferable to re-running an agent when the source is regular.
- **Use existing extractors**, where available (`corum-extract` tooling).

Then import it:

```bash
corum pack install extract
corum import corum build/output.corum.yaml
```

Any gaps the extractor reports (unresolved types, name collisions) come back as
warnings. Extractor output can be combined with spec imports in one config
file, with `deduplication` rules deciding which adapter's nodes win when both
describe the same thing.

## Component mapping

Corum groups nodes by **component** (the first segment of every node ID), but a
spec doesn't say what component an endpoint belongs to. A *component mapping
strategy* decides:

- OpenAPI: `uri-segment` (default), `tag`, `hardcoded`
- AsyncAPI: `channel-segment` (default), `channel-pattern`, `name-segment`,
  `name-pattern`, `tag`, `hardcoded`

## Quick import

```bash
corum import openapi specs/orders.openapi.yaml --component-strategy uri-segment --segment 0
corum import asyncapi specs/orders.asyncapi.yaml --include-consumed
corum import corum build/output.corum.yaml
```

Run `corum import <adapter> --help` for every option. See the [CLI
reference](cli.md#corum-import).

## Config file

For repeatable or multi-spec imports, use a config file:

```bash
corum import --config .corum/imports.yaml
```

```yaml
# Fix up component names that differ between specs
componentNameReplacements:
  - from: ordershipping
    to: order-shipping

# After all imports, merge duplicates from different adapters.
# Keep the primary adapter's nodes, merge/drop the secondary's.
deduplication:
  - primary: openapi
    secondary: corum

# Optional ID maps linking source-native IDs across sources (see below).
# idMaps:
#   - ./maps/code-to-spec.yaml

imports:
  - adapter: openapi
    spec: ./specs/order-shipping.openapi.yaml
    componentMapping:
      strategy: uri-segment
      segment: 0

  - adapter: asyncapi
    spec: ./specs/order-shipping.asyncapi.yaml
    componentMapping:
      strategy: channel-segment
      separator: "."
      segment: 0
    messageNaming:
      strategy: name-segment
      separator: "."
      segment: -1
```

- Replacements apply in order; the first matching `from` wins.
- Deduplication runs after every adapter finishes. It is meant for
  reconciling sources, e.g. keeping OpenAPI endpoints as canonical while
  merging matching nodes from an extractor. Field endpoints match exactly,
  including case, against the primary’s actual fields. Edges with no matching
  primary endpoint are dropped with a warning naming the endpoint and edge.
  With `edgeCasing: match`, a single unambiguous case-insensitive primary
  field match is also accepted; missing or ambiguous matches still warn and drop.

## ID maps: linking sources without Corum IDs

Different sources often describe the same thing: a code extractor emits
`Orders.Contracts.CreateOrderRequest`, and the OpenAPI spec generated from that
code has a schema `CreateOrderRequest`. Each source keeps its own IDs, and an
**ID map** says which IDs refer to the same node, so no extractor has to compute
Corum node IDs.

```yaml
# .corum/imports.yaml
idMaps:
  - ./maps/code-to-spec.yaml   # relative to this config file; earlier files take precedence
```

```yaml
# maps/code-to-spec.yaml
exact:
  clr:Orders.Contracts.LegacyOrder: openapi:orders/schema/OrderV1
rules:
  - from: clr:{area}.Contracts.{type}
    to:   openapi:{area|lower}/schema/{type}
  - from: clr:{area}.Contracts.{type}#{field}
    to:   openapi:{area|lower}/schema/{type}/{field|camel}
```

Patterns are literal text with named captures (one or more characters other
than `.`, `#`, `/` and whitespace). In `to`, a capture can take one transform:
`lower`, `camel` (lower-case first letter), `kebab` or `pascal`. No code runs,
so a map can be hand-written or generated by any tool. A malformed map
(unknown key, unknown transform, a `to` capture `from` does not define) stops
the run.

**Source-native IDs.** Adapters register IDs taken from the spec itself, which
do not change when Corum's ID derivation does:

- `openapi:{component}/schema/{SchemaName}` and `.../schema/{SchemaName}/{property}`
- `openapi:{component}/op/{operationId}`, or `.../op/{METHOD} {path}` without an `operationId`
- `asyncapi:{component}/message/{name}` and `asyncapi:{component}/channel/{address}`

`{component}` is the Corum component the adapter assigned (after
`componentNameReplacements`). Interchange nodes can declare more with
`ids: [clr:Orders.Contracts.CreateOrderRequest]`.

**Resolution.** Any edge endpoint or field `$ref` that is not a node is resolved
once all adapters (and `deduplication`) have finished, so it can point at nodes
created earlier in the same run:

1. an exact Corum node ID or rename alias;
2. a registered or declared source ID;
3. an `exact` map entry, otherwise the `rules`. A candidate only counts if it
   resolves through steps 1 and 2.

- An `exact` entry beats every rule, whichever file each is in. If several
  files have an `exact` entry for the same ID, the earliest file wins and the
  later one is warned about.
- Every rule is evaluated. One distinct resolving target resolves the
  reference; two or more different targets make it **ambiguous**: a warning
  lists the candidates and the reference is left unresolved.

Mapping is reference resolution, not merging. A mapped reference points at the
target node; nothing is declared, merged or dropped. A declared node is merged
into a node from another source only when a `deduplication` rule covers the two
adapters. Then its fields are matched through the map's field rules
(`{declared id}#{field}`), falling back to identical names. Fields with no match
are **kept**, carried over onto the target node, with a warning naming them.

**Persisted source IDs.** Source-native and declared IDs are stored on the node
they identify, as `corum.identity.sourceIds`. Every import reads them back, so a
reference to `openapi:...` or a declared `clr:...` ID resolves even when the
file that registered it isn't part of the run. Because source IDs use the
spec's names, they stay valid when a schema is promoted from inline to
standalone. ID map files are not stored in the graph: a rule only applies in
runs whose config lists the map.

**Diagnostics.** Rules that matched nothing warn, and ambiguous references warn
with all candidates. `corum import` prints how many references each rule and
`exact` entry resolved (and how many a rule lost to an `exact` entry or left
ambiguous).

### Pending edges

An edge endpoint that resolves to no node (by Corum ID, alias, source ID or ID
map) doesn't drop the edge. The import warns, naming the edge, the endpoint and,
when an ID map rule matched, the rule and the ID it produced. The edge is
written with a `pending` marker holding the reference as written:

```yaml
- from: orders.DomainModel.OrderAggregate
  to: clr:Orders.Contracts.Missing
  type: derived-from
  pending:
    to: clr:Orders.Contracts.Missing
```

Every later import retries all pending edges, from every source, against the
current nodes, persisted source IDs and the ID maps of that run. When an
endpoint resolves, the edge is rewritten to point at the real node (its ID
changes), the marker is removed, and notes, provenance and ownership are kept.
If the resolved edge already exists, the existing edge is kept and the import
warns. Only the import that writes an edge warns about it; edges still pending
from other sources are retried silently. `corum lint` reports them as
`edge pending resolution`, and MCP edge output includes `pending`.
Nodes created through MCP write tools don't resolve pending edges until the
next import.

## Git-backed graphs

With a Git source, imports must say which branch receives the result:

```bash
corum import --config .corum/imports.yaml --branch feat/import-orders
```

Review the result like any other change.

## Re-importing

Running an import again reconciles the new input with what is already in the
graph rather than starting over:

- **New** nodes are added.
- **Existing** nodes are updated from the source. For `determined` (contract- or
  code-derived) imports, source-supplied properties overwrite existing values.
  Unsupplied properties (such as hand-written descriptions) survive, along with
  `state`, `stability`, `notes` and rename history. Corum records supplied keys
  in `corum.ownership.importedProperties` and removes previously recorded keys
  when the source stops supplying them. Legacy nodes without this record keep
  all unsupplied properties.
- **Missing** nodes are marked `removed` (a soft delete), but only those that
  were originally imported from the *same source file*. Nodes from other
  sources and hand-modelled nodes are left alone.

Because of the last rule, feed each source file in full. Importing a partial
file makes everything it omits look removed. Review the result on a branch, and
use deduplication rules when several adapters describe the same thing.

> **Status:** imports currently write straight to the graph rather than through
> a working session (so they bypass the lint gate), and a dry-run mode and an
> explicit partial-import mode are planned. Treat imports of derived or
> inferred data as branch-only until reviewed.

## Provenance and removal

Each imported node records `extractedFrom`: the `spec` path exactly as written
in the import config entry, normalised (forward slashes, no leading `./`, no
redundant separators). Absolute paths in the config stay absolute. It does not
depend on the working directory or machine, so the same config gives the same
values everywhere. The spec file itself is still read relative to the current
working directory. Removal detection compares nodes against this key.

There is no migration: nodes imported earlier with an absolute-path
`extractedFrom` are updated in place on re-import if still present in the spec,
but are treated as coming from a different source for removal, so nodes already
dropped from a spec are not marked `removed` by the first re-import.

## Imports and renames

Imports never guess renames. If a spec renames something, the importer treats
it as a new node. Renaming a node through the agent (`rename_node`) leaves an
alias trail so later imports that still use the old name resolve to the renamed
node.

## Reading the result

Import output lists diagnostics, such as unresolved types or name collisions
reported by an extractor. Run `corum lint` afterwards, and ask your agent for a
graph summary to see what arrived.

> **Status:** adapters and mapping options are being extended. Importing from
> Git sources in particular may change.
