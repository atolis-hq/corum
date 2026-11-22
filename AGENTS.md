# AGENTS.md

## What This Is

Corum is a Git-native design graph for service architecture. It models components (APIs, domain models, schemas, fields) as nodes with typed edges, exposed via MCP tools. The Git repo is the database; no external infrastructure.

## Commands

```bash
npm run build          # tsc -> dist/
npm test               # build + Node test runner
npm run mcp            # start stdio MCP server (default graph: .corum/graph)
npm run web            # start Express web UI
node --test dist/test/loader.test.js  # run single test file
node dist/src/bin/corum.js lint       # lint the graph (template/property/edge-type rules)
node dist/src/bin/corum.js import --config <yaml> [-b <branch>]  # import specs; git sources require a target branch
```

## Architecture

**Load pipeline** (`src/loader/`): packs -> clusters -> edges -> in-memory `Graph` (Maps keyed by node ID / edge endpoints). `loadPacks()` topologically sorts templates by inheritance before cluster parsing.

**Clusters vs. Nodes**: A cluster YAML file defines a root node. Template `ownedSections` (e.g. DomainModel owns `schemas`, `enums`) cause child nodes to be materialized inline; one YAML block becomes multiple `Node` objects with auto-generated structural edges (`has-field`, `has-value`).

**Node IDs** follow ownership hierarchy: `orders.DomainModel.order.schemas.order.fields.id`. The dot path encodes the full parent chain. The grammar (`src/loader/id-grammar.ts`) is enforced at load: dot-separated segments of `[A-Za-z0-9_-]`, `__` reserved for edge IDs, roots are `component.Template.name`. Owned children carry a materialized `parentId`.

**Edges** are either structural (auto-generated from template ownership) or explicit (declared in `edges/**/*.yaml`, optionally with `properties:`). Edge IDs: `{from}__{type}__{to}`. The type vocabulary is pack-extensible: core types are declared in `CORE_EDGE_TYPES` (`src/loader/constants.ts`); packs add more via `edge-types.yaml` with a `category` (`structural|semantic|lineage`) that drives engine behavior (summary counts, lineage defaults, collapse filtering). Core types: `triggers`, `produces`, `reads`, `uses-type`, `calls`, `implements`, `maps-to`, `derived-from`, `renamed-from`, `has-field`, `has-value`.

**Templates** (`src/loader/pack-loader.ts`) live in `.corum/packs/*/templates/*.yaml` and can extend other templates. Core pack provides base types; domain/rest/messaging packs extend them. Templates may declare `info.role` (`field|value|type-container|enum-container|mapping`), resolved through the extends chain - engine behavior (schema collapse, field lineage, structural classification) keys off roles, never template names, so `AvroSchema extends Schema` inherits Schema's engine behavior.

**Linter** (`src/linter/index.ts`): validates node properties against template schemas, explicit edges against template `edge-types:` constraints, and edge properties against pack edge-type schemas. Runs on every load; diagnostics are warnings (strict mode only throws on errors).

**MCP tools** (`src/mcp/index.ts`): reads - `list_nodes`, `list_templates`, `get_template`, `get_cluster`, `get_graph`, `get_graph_metadata`, `get_lineage`, `get_graph_summary`, `search_nodes`, `get_linked_fields`, `list_branches`, `diff_branch`; writes (thin wrappers over `src/mutate/`) - `start_changes`, `apply_cluster`, `create_node`, `update_node`, `rename_node`, `delete_node`, `create_edges`, `update_edge`, `delete_edge`, `create_fields`, `pending_changes`, `discard_changes`, `commit_changes`. While a working session is open, reads serve the session's working graph. `rename_node` is the only rename path; `apply_cluster` and imports never infer renames.

**Mutation engine** (`src/mutate/`): all graph mutations live here - rename cascade with `previousNames` + hidden `renamed-from` trail edges (alias map gives cross-branch/import resolution of retired IDs), soft/hard delete tiers gated by default-branch presence, and the working session (`session.ts`: validate-before-apply, journal, autosave WIP checkpoints, guarded squash at `commit_changes`).

**UI plugin boundary** (`test/architecture.test.ts` enforces it):
- Built-in plugins (`web/builtin/**`) import only their own files plus `corum:ui`, `corum:ui/react` and the vendored libraries; no `window.Corum*` globals, no direct `fetch` (use `ctx.api` / `useApi`).
- Host code (`web/app.jsx`, `web/host`, `web/search.jsx`) never names a specific plugin; `web/sdk` never imports host or plugins, host never imports plugins.
- SDK exports are a snapshot-pinned, documented compatibility promise; hex colour literals in `web/` scripts are a ratchet that may only go down.

**Serialization** (`src/mcp/serializers.ts`): YAML (default), JSON, or TOON (compact token format). `compact_keys` shortens common keys (`id->i`, `template->t`, etc.) to reduce token usage. MCP omits node provenance by default; node-returning tools accept `include_provenance: true` when codebase/source bridging is needed. `get_lineage` is lean by default and omits `edges` unless `include_edges: true`.

**Error handling**: Load errors are collected as diagnostics and bundled in `LoadError`; not thrown per-item unless `strict: true`. Query failures throw `QueryError` immediately.

## Key Files

| Path | Role |
|------|------|
| `src/schema/index.ts` | Core types: Node, Edge, Graph, Template, State, Stability, EdgeTypeDef |
| `src/loader/index.ts` | Load orchestrator |
| `src/loader/cluster-loader.ts` | Node materialization from cluster YAML |
| `src/loader/id-grammar.ts` | Node ID grammar: validation + sanitization |
| `src/graph/roles.ts` | Template role resolution (capability contract) |
| `src/graph/index.ts` | Query functions (listNodes, getCluster, getLinkedFields) |
| `src/linter/index.ts` | Lint rules (property/edge-type validation) |
| `src/mcp/index.ts` | MCP server + tool handlers |
| `.corum/packs/` | Template pack definitions |
| `project/adrs/` | Architecture decisions; read before changing core abstractions |
| `project/` | Decisions (ADRs/PDRs), plans, specs, reports. `docs/` is for public-facing guides only; new superpowers specs/plans go in `project/superpowers/{specs,plans}` |

## Design & Styling

The styling contract is ADR-011 (`project/adrs/ADR-011-design-tokens-themes-and-layouts.md`); read it before touching `web/style.css`, theme code, or any UI markup. Rules for every UI change:

- **No hard-coded colours.** Never write a hex/rgb/hsl literal in CSS, JSX or JS. Use a semantic token (`var(--background)`, `var(--foreground)`, `var(--border)`, `var(--accent)`, `var(--destructive)`, ...). The ratchet test in `test/architecture.test.ts` may only go down.
- **Public tokens only.** Use Tier 2 semantic tokens. Never use primitive palette variables (`--c-*`) outside a theme file, and never invent a new `--` token without adding it to `web/sdk/tokens.json` (and a `since` version).
- **`web/sdk/tokens.json` is the source of truth** for tokens (DTCG; light values) and `web/sdk/classes.json` for standard classes. After editing run `npm run tokens` (regenerates the committed `web/tokens.css`) and `npm run styling:snapshot`. A removal or rename needs a contract version bump; an addition needs `since` set to the current version. Built-in plugin classes must be standard classes or `graph-*`/`explorer-*`.
- **No legacy names.** `--paper*`, `--ink*`, `--rule*`, `--accent-2`, `--accent-ink`, `--ok`, `--warn` are replaced by the semantic names in ADR-011 with no aliases. Never use or reintroduce them.
- **Every change must work in every theme.** Check light and dark at minimum; never assume a white or dark page. Do not use `color-scheme`-specific literals or `@media (prefers-color-scheme)` in component styles (themes own that).
- **Pack colours are data.** Colours from `ui.colour`, kinds and edge types come from pack data via `--node-colour` / `--edge-colour` and derived tint/border/text tokens. Never hard-code a kind or edge-type colour, and never duplicate edge-type styling; use the shared helper.
- **Standard markup.** Reuse the documented classes (`card`, `card-head`, `label-xs`, `meta-strip`, `quick-link*`, `open-in*`, ...) rather than writing one-off styles. Renaming or removing a documented class or token is a breaking change: bump the contract version, update every in-tree use and the snapshot, and note it in the PR. Do not keep aliases or compatibility shims.
- **Plugins style through the contract.** Built-in plugins use only documented tokens and classes (no inline hex, no host internals), so the style guide plugin proves the contract works for third parties.
- **Accessibility is part of styling.** Keep text contrast adequate in every theme, visible focus (`--ring`), and keyboard operability for menus and popovers (follow the Open in menu pattern).
- **Layouts are CSS-only.** Do not hide or reorder host regions from a layout; structure is controlled through `--nav-width`, `--content-max`, `--density` and `data-layout`.
- **Screenshots.** A PR that changes how the UI looks embeds before/after screenshots in its body, stored on the `pr-assets` branch. Capture with plain Playwright, then publish and embed with `npm run screenshots:publish -- --pr <n> --update-pr` (see `DEVELOPMENT.md` "PR screenshots"). Capture only what the change affects, and include mobile (375 px wide) captures, with menus and popovers open, whenever mobile is likely affected, for example new menus, popovers, shell or nav changes, and layout changes. Never commit images to the PR branch. If you cannot produce them, say so in the PR.
- **Update docs and the style guide** (`docs/styling.md`, style guide plugin) in the same change when you add or change a token, class or standard pattern.

## Raising Issues

Before creating a GitHub issue, ask the user (via a single-select menu) how it should be dispatched. Do not default to any of these:

- No assignment: file for manual triage.
- Assign to `atolis-hq-agent`: Wake starts working it on its next tick.
- Assign to `atolis-hq-agent` and label `dark-factory`: Wake works it end-to-end, unattended, via the dark-factory workflow.
- Label `dark-factory` with no assignment: routes into the dark-factory workflow once someone assigns it later.

Assigning is dispatch: guessing wrong starts real work. Also apply the normal type label (`bug`, `enhancement` or `documentation`).

When the chosen dispatch is unattended (assigned and/or labelled `dark-factory`), use `.github/ISSUE_TEMPLATE/dark-factory-task.md`. State the intended outcome explicitly and separately from any suggested approach. A prescriptive fix sketch with no stated outcome leaves the working agent unable to tell whether to extend scope when the sketch turns out incomplete, so it will correctly report back blocked instead of guessing. If one issue depends on another, say so in the body and link it.

## State & Stability Defaults

Every node and edge has `state` (`draft|proposed|agreed|future|removed|implemented`, default `proposed`) and `stability` (`unstable|stable|deprecated`, default `unstable`). Always include these fields when creating nodes or edges.

## Runtime Config

Corum loads runtime config from `.corum/config.yaml`, then overlays environment variables, then CLI flags. Source selection lives in `src/source/config.ts`.

- `CORUM_SOURCE`: `file` / `filesystem` / `fs` (default) or `git`
- `CORUM_GRAPH_PATH`: filesystem graph path
- `CORUM_GIT_LOCAL_PATH` or `CORUM_GIT_REMOTE_URL`: exactly one for git mode
- `CORUM_GIT_BRANCH`: default branch ref for git-backed reads
- `CORUM_GIT_POLL_SECONDS`: git poll interval for web reloads
- `CORUM_GIT_TOKEN` / `CORUM_GIT_USERNAME`: remote git auth
- `CORUM_WEB_PORT`: default web port
- `CORUM_FILE_WATCHER` or `CORUM_WATCH`: enable filesystem watch mode for the web server

Write-session defaults differ by source:
- filesystem source: autosave defaults on
- git source: autosave defaults off
