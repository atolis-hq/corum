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
  merging matching nodes from an extractor.

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
  code-derived) imports, anything a human or agent set is kept: `state`,
  `stability` and `notes` survive re-imports, as does rename history.
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
