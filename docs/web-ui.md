# Web UI

The web UI is currently a read-only browser view of the graph, for people who
want to look at what an agent has built. Changes are made through the agent and
[MCP tools](mcp-tools.md), not in the browser.

> **Status:** an edit mode, where you can create and change nodes from the UI
> using the same validated change path as the agent, is planned but not yet
> available. Until then, ask your agent to make changes.

## Starting it

```bash
corum web                 # http://localhost:3000
corum web --port 4000
```

`corum mcp` also starts the web UI unless you pass `--no-web`. See [Running the
MCP server and web UI together](#running-with-the-mcp-server) below. To host
it for a team, see [Hosting the web UI](configuration.md#hosting-the-web-ui).

## Views

The left rail switches between three views:

- **Dashboard** - graph-wide statistics: nodes, namespaces, edges and
  diagnostics, plus a count of namespaces by kind.
- **Models** - browse nodes by namespace and template. The sidebar has one
  section per kind, labelled from the kind registry (for example `Component`
  and any pack-defined kind); a kind with no registry entry appears under its
  kind id. A node's page shows its properties, its schemas and fields (with
  their types and field-level links), and its enums. Template colours and
  icons come from each template's `ui` settings. Selecting a namespace of any
  kind other than `component` opens a generic page listing its owned nodes and
  its inbound and outbound edges, with links to the nodes.
- **Graph** - an interactive diagram of nodes and edges. The top level shows
  `component` namespaces by default; when the graph has several kinds a kind
  filter (including **All**) switches this, and namespaces and nodes are
  coloured by kind. Pick a focus node and adjust the depth to explore what
  surrounds it; edges are labelled with their type, including custom types from
  packs.

A search box at the top finds nodes by ID. A debug toggle shows fully qualified
node names instead of display names.

## Plugins

The Graph view is a built-in plugin. Plugins can add pages to the navigation
rail and actions to **Open in** menus on node pages and connection rows, with
optional icon shortcuts beside node titles and connections. Menu membership
(`menu`, default `true`) and icon placement (`quick`) are independent settings.
Connection actions target the linked node and preserve the viewed branch.
Dashboard and Models currently remain in the host UI.

For filesystem sources, configure plugins in the graph's `graph.yaml`:

```yaml
plugins:
  - path: ../plugins/node-list  # relative to graph.yaml's directory
  - id: graph
    enabled: false
```

Plugins are enabled by default. Disabling one removes its pages and actions;
direct links show an unavailable page. Git sources currently load built-in
plugins only and do not apply these registrations or overrides.

See [UI plugins](plugins.md) for installation, configuration, an end-to-end
authoring example, the manifest and SDK contract, and troubleshooting. Plugins
run with the page's full privileges, so only install ones you trust.

## Branches and comparing proposals

A branch bar lets you switch which branch you are viewing. With a Git source
you can also overlay other branches on the current one, with three modes:

| Mode | Shows |
| --- | --- |
| Single | Only the branch you're viewing |
| Selected | The branches you tick under *Compare* |
| Consolidated | Every other branch at once |

Changes from overlaid branches appear as striped "ghost" entries, coloured per
branch. Where proposals touch the same item differently they're flagged as
conflicts. This is the quickest way to see which parallel designs collide and
which can be combined.

A *Reload* control refreshes branches and graph data. Branches that fail to load
are flagged, with the reason on hover.

## Keeping it up to date

| Source | How the UI refreshes |
| --- | --- |
| Filesystem | Set `CORUM_FILE_WATCHER=true` (or run `corum mcp --watch`) to reload when files change |
| Git | Set `git_poll_seconds` (`CORUM_GIT_POLL_SECONDS`) to re-fetch on an interval |

Otherwise use the Reload control. See [Configuration](configuration.md).

## Running with the MCP server

`corum mcp` starts the web UI in the same process, sharing the graph the
agent works on, so what you see in the browser is what the agent sees.

- Add `--watch` (file graphs) so the browser picks up changes the agent commits.
  Without it the UI keeps showing what it loaded at start until you reload.
- Each MCP client launches its own `corum mcp` process. If the web port is
  already in use, the web server fails to start, a message is written to stderr
  and the MCP server carries on without it. Use `--no-web` in the client
  config and run a single `corum web` yourself for a persistent UI.
- `corum web` alone loads the graph strictly and exits with an error if it
  can't be loaded.
