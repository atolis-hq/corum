# CLI Pack Management Design

**Date:** 2026-06-18
**Branch:** cli-setup

## Overview

Extend the `corum` CLI to support graph initialisation and pack management. Users need a way to set up the filesystem so it is ready to receive nodes: a `graph.yaml`, an empty directory structure, and template packs downloaded from the official registry.

## File Layout

### In this repo (committed, static)

```
packs/registry.yaml          ← official pack registry, fetched by CLI at install time
```

### In a user's project (written by CLI commands)

```
.corum/
  config.yaml                ← gains a pack_registry URL field
  packs.yaml                 ← local manifest of installed packs
  packs/
    core/                    ← downloaded from registry
    domain/
    rest/
    messaging/
  graph/
    graph.yaml               ← minimal scaffold; templatePacks populated by pack installs
    components/              ← empty, ready for nodes
    edges/                   ← empty, ready for explicit edges
```

## File Formats

### `packs/registry.yaml` (this repo)

```yaml
version: "1.0"
packs:
  - name: core
    description: "Core templates required by all graphs"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/core
  - name: domain
    description: "Domain model templates (DomainModel, Command, ReadModel, etc.)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/domain
  - name: rest
    description: "REST API templates (APIEndpoint)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/rest
  - name: messaging
    description: "Messaging templates (DomainEvent, IntegrationEvent)"
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/messaging
```

No ref is stored in the registry. The CLI resolves the ref at install time.

### `.corum/config.yaml` (extended scaffold)

Adds one new uncommented field — `pack_registry` — since it is required for pack commands to work:

```yaml
pack_registry: https://github.com/atolis-hq/corum/packs/registry.yaml

# ... existing commented options unchanged ...
```

The CLI parses `github.com/{owner}/{repo}/{path}` and fetches `raw.githubusercontent.com/{owner}/{repo}/HEAD/{path}`. The registry is always fetched from `HEAD` of the default branch so the pack list is always current. Pack file downloads use the resolved release ref instead (see `corum pack install`).

### `.corum/graph/graph.yaml` (minimal scaffold)

```yaml
schema-version: '1.0'
name: My Graph
templatePacks: []
components: []
```

`templatePacks` starts empty. Each `corum pack install` appends to it.

### `.corum/packs.yaml` (local manifest)

```yaml
packs:
  - name: core
    repo: https://github.com/atolis-hq/corum
    path: .corum/packs/core
    ref: v0.1.6
    installedAt: "2026-06-18T10:00:00Z"
```

Records the resolved ref that was actually installed, enabling future `pack update` and `pack list`.

## Commands

### `corum init` (extended)

Creates the full project scaffold, then installs the four default packs.

Steps (each skipped if target already exists — idempotent):

1. Write `.corum/config.yaml` with `pack_registry` URL
2. Write `.corum/graph/graph.yaml` (minimal scaffold)
3. Create `.corum/graph/components/` and `.corum/graph/edges/` directories
4. Invoke pack install logic for `core`, `domain`, `rest`, `messaging` in order

Pack installs in step 4 handle writing `packs.yaml` and updating `graph.yaml` — the same code path as `corum pack install`.

### `corum pack install <name[@ref]>`

```
corum pack install domain
corum pack install domain@v0.1.5
```

1. Read `pack_registry` from `.corum/config.yaml`
2. Fetch and parse registry YAML
3. Find matching pack entry by name
4. Resolve ref: use specified `@ref` if provided, otherwise call GitHub releases API (`GET /repos/{owner}/{repo}/releases/latest`) for the latest tag
5. Construct raw file base URL: `https://raw.githubusercontent.com/{owner}/{repo}/{ref}/{path}`
6. Fetch `{base}/pack.yaml` → parse template list
7. Fetch `{base}/templates/{name}.yaml` for each template
8. Write all files to `.corum/packs/<name>/`
9. Upsert entry in `.corum/packs.yaml` (create file if absent)
10. Append `templatePacks` entry to `.corum/graph/graph.yaml` if not already present, using relative path `../packs/<name>`

Exits with a non-zero code and a clear message if the pack name is not found in the registry or the network request fails.

### `corum pack list`

```
corum pack list
```

Reads `.corum/packs.yaml` and prints a table of name, ref, and `installedAt` for each pack.

## Implementation Structure

New module `src/pack/`:

| File | Responsibility |
|------|----------------|
| `src/pack/registry.ts` | Fetch and parse `registry.yaml` from a URL; resolve latest GitHub release tag via the GitHub releases API |
| `src/pack/installer.ts` | Download a pack: fetch `pack.yaml`, discover template list, fetch each template file, write to `.corum/packs/<name>/` |
| `src/pack/manifest.ts` | Read/write `.corum/packs.yaml` — upsert installed pack entries |
| `src/pack/graph-yaml.ts` | Read/write `.corum/graph/graph.yaml` — append `templatePacks` entries |

`src/bin/corum.ts` changes:
- Extend existing `init` command to call scaffold + pack install logic
- Add `pack` subcommand with `install` and `list` sub-subcommands

Dependency order: `registry` → `installer` → (`manifest` + `graph-yaml`). No circular dependencies.

## Out of Scope

- `corum pack update` (possible future command; `packs.yaml` is structured to support it)
- Custom/private registries (config accepts any URL, so this works without extra code)
- Pack dependency resolution (not needed; packs are independent)
