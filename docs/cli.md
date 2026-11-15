# CLI reference

Run `corum --help` or `corum <command> --help` for the live option list. Use
`npx @atolis-hq/corum <command>` if Corum isn't installed globally.

| Command | Purpose |
| --- | --- |
| `corum init` | Scaffold `.corum/` and install default packs |
| `corum mcp` | Start the MCP server (and web UI) |
| `corum web` | Start the web UI only |
| `corum lint` | Validate the graph |
| `corum pack install` / `list` | Manage template packs |
| `corum import` | Import specifications |

`--graph <path>` overrides the graph directory on commands that load a graph.

## `corum init`

Creates `.corum/config.yaml`, `.corum/graph/` (with `graph.yaml`,
`nodes/`, `edges/`), `.corum/packs/` and `.corum/packs.yaml`, and installs
`core`, `domain`, `rest` and `messaging`. Steps whose target already exists are
skipped.

## `corum mcp`

```bash
corum mcp [--no-web] [--watch] [--graph <path>]
```

Starts the stdio MCP server, plus the web UI unless `--no-web` is given.
`--watch` reloads file-backed graphs on local changes; Git-backed graphs reload
by polling. Tools are listed in [MCP tools](mcp-tools.md). How the embedded web
UI behaves alongside it is covered in [Web UI](web-ui.md#running-with-the-mcp-server).

## `corum web`

```bash
corum web [--port <n>] [--graph <path>]
```

Starts the browser UI (default port 3000, or `CORUM_WEB_PORT`); see [Web UI](web-ui.md). Filesystem graphs can be watched with
`CORUM_FILE_WATCHER=true`; Git-backed graphs reload when `git_poll_seconds` is
set. To run it as a shared service, see [Hosting the web UI](configuration.md#hosting-the-web-ui).

## `corum lint`

```bash
corum lint [--graph <path>]
```

Loads the graph and reports diagnostics for:

- node properties that don't match their template schema
- explicit edges that violate a template's `edge-types` constraints
- edge properties that don't match the edge type's schema
- load problems such as invalid IDs

Lint also runs on every load and before `commit_changes`.

## `corum pack`

```bash
corum pack install <name>          # latest tag
corum pack install <name>@<ref>    # specific tag, e.g. domain@v0.1.5
corum pack list                    # installed packs, versions, install dates
```

See [Templates and packs](templates-and-packs.md).

## `corum import`

```bash
corum import --config <path> [-b <branch>] [--graph <path>]
corum import openapi <spec> [options]
corum import asyncapi <spec> [options]
corum import corum <spec> [options]
```

`-b, --branch` names the branch that receives the import and is required for
Git sources.

**`import openapi`**

| Option | Meaning |
| --- | --- |
| `--component-strategy` | `uri-segment` (default), `tag`, `hardcoded` |
| `--segment <n>` | URI segment index (`uri-segment`) |
| `--pattern <regex>` | Regex (`uri-segment`) |
| `--component <name>` | Component name (`hardcoded`) |

**`import asyncapi`**

| Option | Meaning |
| --- | --- |
| `--component-strategy` | `channel-segment` (default), `channel-pattern`, `name-segment`, `name-pattern`, `tag`, `hardcoded` |
| `--separator <char>` | Separator for segment strategies (default `.`) |
| `--segment <n>` | Segment index; negative counts from the end |
| `--pattern <regex>` | Regex for pattern strategies |
| `--component <name>` | Component name (`hardcoded`) |
| `--event-classification` | `always-integration` (default) or `always-domain` |
| `--include-consumed` | Also import receive (consumed) operations |

**`import corum`** reads a self-describing `*.corum.yaml` interchange file; no
mapping options are needed. It requires the `extract` pack
(`corum pack install extract`).

More on strategies and config files in [Importing](importing.md).
