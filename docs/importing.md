# Importing

Importing populates the graph from existing specifications so you aren't
modelling services from scratch. Imports are deterministic: the same spec
produces the same nodes.

| Adapter | Input | Pack needed |
| --- | --- | --- |
| `openapi` | OpenAPI specs (3.0, 3.2 examples in [spec-examples](spec-examples/openapi)) | `rest` |
| `asyncapi` | AsyncAPI specs (2.6 and 3.0 examples in [spec-examples](spec-examples/asyncapi)) | `messaging` |
| `corum` | `*.corum.yaml` interchange files from `corum-extract` tooling | `extract` |

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
