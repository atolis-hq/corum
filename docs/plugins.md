# UI plugins

Plugins add pages and links from node pages to the [web UI](web-ui.md). A plugin
is a directory containing a `plugin.yaml` manifest and a browser ES module.
It can be installed separately or bundled with a [template pack](templates-and-packs.md).
No build step is required.

**Trust:** plugins run arbitrary JavaScript with the full privileges of the
web page. They are not sandboxed. Only install plugins, including plugins
bundled in packs, from sources you trust; treat installation like installing
a software package.

## Configure plugins

For a filesystem source, register plugins in the graph's `graph.yaml`
(normally `.corum/graph/graph.yaml`), not `.corum/config.yaml`:

```yaml
# Add these entries alongside the graph's existing metadata and templatePacks.
plugins:
  - path: ../plugins/node-list
  - id: graph
    enabled: false
```

Paths are relative to the directory containing `graph.yaml`. In this example,
`../plugins/node-list` points to `.corum/plugins/node-list/`. It must contain
`plugin.yaml`; merely copying a standalone plugin into `.corum/plugins/`
does not register it. Absolute filesystem paths are also accepted, but
relative paths are easier to share in Git.

Each list entry has one of two forms:

| Entry | Effect |
| --- | --- |
| `{ path: ../plugins/node-list }` | Register a standalone plugin directory |
| `{ id: node-list, enabled: false }` | Disable a discovered plugin by its manifest ID |

Keep registration and overrides in separate entries. Overrides apply to
built-in, pack-bundled and standalone plugins. Plugins are enabled by default;
remove the disabling entry, or change its `enabled` value to `true`, to enable
one again. Enabling does not bypass version or template requirements.
Configuration applies to everyone using this graph, with no per-user toggle.

The built-in Graph page has ID `graph`. Disabling it removes its navigation
entry and its "View in graph" node actions. Dashboard and Explorer are currently
host features and cannot be disabled through plugin configuration.

Plugin IDs must be unique. Discovery visits built-ins, pack plugins, then
standalone plugins; a duplicate is logged and the first discovered plugin is
kept. A standalone plugin cannot replace a built-in by reusing its ID.

Restart the server after configuration changes, then reload the browser.
Alternatively, use the UI's Reload control, or run with the file watcher
enabled (`CORUM_FILE_WATCHER=true`), to re-resolve the plugin list without a
restart.

### Current source and tooling limits

Custom plugins and `graph.yaml` overrides work with filesystem and Git sources.
Git sources discover pack-bundled and standalone plugins from the default branch.
Each plugin list or asset request pins one commit, including template compatibility
checks. Branch and overlay views use that same default-branch plugin set. New
default-branch commits are picked up by reloads; asset ETags track content changes.
Only allowed asset types are served, never YAML, and Git symlinks are rejected.

If a declared plugin directory or `plugin.yaml` is missing at that commit, its
unavailable entry uses the exact declared path as both ID and displayed name.
The reason includes that path and the short commit SHA. Once the manifest exists,
the entry uses its real manifest ID. For local plugin development, use
`source: file` (see [Configuration](configuration.md)).

There is no `corum plugin init`, `corum plugin validate`, `corum plugin update`
or `corum web --plugin-dir` command yet. Create and register directories as
described here. SDK TypeScript declarations are not yet shipped.

## Create a working plugin

This example adds a **Node list** page and an **Open node list** action on
node pages. It needs an existing, loadable filesystem graph, such as one
created by `corum init`.

### 1. Create the files

```text
.corum/
  graph/
    graph.yaml
  plugins/
    node-list/
      plugin.yaml
      index.js
```

Create `.corum/plugins/node-list/plugin.yaml`:

```yaml
id: node-list
version: "0.1.0"
engines:
  corum: ">=0.1.0 <0.2.0"
main: ./index.js
contributes:
  pages:
    - id: home
      title: Node list
      icon: list
      order: 30
      mount: mountNodeList
  nodeActions:
    - id: open-list
      label: Open node list
      appliesTo: ["*"]
      page: home
```

The compatibility range above targets Corum 0.1.x. Set `engines.corum` to the
versions you have tested when publishing your own plugin.

Create `.corum/plugins/node-list/index.js`:

```js
export function mountNodeList(el, ctx) {
  const content = document.createElement('section')
  content.className = 'node-list-page'
  const title = document.createElement('h1')
  title.textContent = 'Node list'
  const focus = document.createElement('p')
  const list = document.createElement('ul')
  content.append(title, focus, list)
  el.replaceChildren(content)

  let disposed = false
  let request = 0

  async function render() {
    const current = ++request
    focus.textContent = ctx.params.get('id')
      ? `Opened for: ${ctx.params.get('id')}`
      : 'Choose a node to open its view.'
    try {
      const nodes = await ctx.api.get('nodes')
      if (disposed || current !== request) return
      list.replaceChildren()
      for (const node of nodes) {
        const item = document.createElement('li')
        const link = document.createElement('a')
        link.href = ctx.hrefForNode(node.id)
        link.textContent = node.id
        item.append(link)
        list.append(item)
      }
    } catch (error) {
      if (!disposed && current === request) ctx.onError(error)
    }
  }

  const unsubscribe = ctx.subscribe(() => { void render() })
  void render()
  return () => {
    disposed = true
    unsubscribe()
    el.replaceChildren()
  }
}
```

The page uses `textContent` for graph values, gets data through `ctx.api` and
creates node links through the host. It also handles query changes and ignores
responses that arrive after cleanup or a newer request.

### 2. Register and run it

Add the standalone registration to `.corum/graph/graph.yaml`, preserving the
file's existing contents (append to `plugins` if it already exists):

```yaml
plugins:
  - path: ../plugins/node-list
```

Start the web UI from your project directory:

```bash
corum web --graph .corum/graph
```

Open `http://localhost:3000/#/p/node-list/home`. **Node list** should appear
in the navigation rail and list the graph's top-level nodes. An empty graph
produces an empty list. Open a node page and choose **Open node list** in its
**Open in** menu; the plugin receives that node's ID in `ctx.params.get('id')`.
You can also test the parameter directly with
`#/p/node-list/home?id=orders.DomainModel.order`.

### 3. Edit and reload

After editing JavaScript or CSS, reload the browser to load the new module.
After editing registrations or manifests, restart the server and reload the
browser, or use the UI Reload control followed by a browser reload. Plugin
modules are cached within a browser page; navigating away and back does not
reload their code.

The plugin list is resolved at startup and again when plugins or packs change.
With the file watcher enabled (`CORUM_FILE_WATCHER=true`), editing `graph.yaml`,
a file in one of the graph's template packs, or a standalone plugin's
`plugin.yaml` re-resolves the plugin list, and the page reloads if the list
changed. Editing graph data (node files) does not re-resolve plugins. The
watcher does not provide JavaScript/CSS hot reload, so edits to a plugin's
other files need a browser reload. Update a plugin by replacing its directory
contents, then reload as above.
To uninstall a standalone plugin, remove its `path` registration and any
associated override before deleting the directory.

## Manifest reference

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | Yes | Stable, unique ID matching `^[a-z0-9-]+$`; used in routes and asset URLs |
| `version` | Yes | Plugin version string; use semver. Display metadata, not a cache key |
| `engines.corum` | Yes | Semver range supported by the plugin; incompatible or invalid ranges make it unavailable |
| `main` | Yes | Relative `.js` or `.mjs` entry point inside the plugin directory; use forward slashes |
| `requires.templates` | No | Exact template names that must exist in the loaded graph; defaults to `[]` |
| `contributes.pages` | No | Page contributions; defaults to `[]` |
| `contributes.nodeActions` | No | Node action contributions; defaults to `[]` |

For example, a plugin that needs the domain pack can declare:

```yaml
requires:
  templates: [DomainModel]
```

Requirements check availability; they do not install packs. A template
requirement is distinct from the matching rules for `opens` and `appliesTo`.

### Pages and node actions

Every page requires an `id` (unique within the plugin), `title` and `mount`.
`mount` must name a function exported by `main`. Optional `icon` is a Font
Awesome solid icon name without `fa-`; optional numeric `order` defaults to
100. Navigation sorts pages by ascending order, then title, after the host
items. Use simple URL-safe page IDs such as `home` or `map`.

An optional `opens` list claims templates or roles that the page can display:

```yaml
contributes:
  pages:
    - id: map
      title: Journeys
      mount: mountJourneyMap
      opens: [Journey, type-container]
  nodeActions:
    - id: view-journey
      label: View in journey
      icon: route
      appliesTo: [DomainModel]
      page: map
      param: focus
      menu: true
      quick: [header, relations]
```

`opens` and `appliesTo` match a template's name, its inheritance chain and its
resolved role. For an owned child, the host uses its owning cluster root's
template for matching, including when the child is linked in a connection row.
Node actions additionally support `"*"` for all nodes. Each
action needs `id`, `label` and `page`; supply `appliesTo` to select nodes
(an omitted or empty list matches none). `page` must name a page declared in
the same plugin. Actions are generated links, with no action handler export.

`param` defaults to `id`; the example instead supplies the node ID as
`ctx.params.get('focus')`. Optional `quick` accepts only `header` and
`relations`: these add icon shortcuts beside a node title or on connection
rows. Connection shortcuts match and target the linked node. Supply an `icon`
for quick links.

`menu` separately controls whether an action appears in **Open in** menus,
both in node headers and on connection rows. It defaults to `true`; set
`menu: false` for a shortcut-only action. `quick` never changes menu membership.

| Settings | Result |
| --- | --- |
| `menu` omitted, no `quick` | Menu entry only |
| `menu: true`, `quick: [header, relations]` | Menu entry and icons in both places |
| `menu: false`, `quick: [header]` | Header icon only |
| `menu: false`, no `quick` | No visible action |

Declare one action when the same destination should appear in both the menu
and quick links: `quick` adds shortcuts for that action, so no second action
is needed. Two actions targeting the same page create two menu entries if both
allow menu display, even if they differ only in label or query parameter.

Connection rows show icons only for actions that opt into `relations`, plus an
**Open in** overflow menu listing matching page claims and menu-enabled actions.
The menu and shortcuts target the linked node, preserving the viewed branch.
A menu-only action therefore remains accessible from a connection row without
adding an icon. The host hides the overflow trigger when it has no destinations.
Page claims through `opens` remain menu destinations independently of `menu`.

## Mount lifecycle and context

The host lazily imports `main` on first use of a page, then calls its named
export as `mount(el, ctx)`. Mount synchronously into `el` and return a cleanup
function. Start asynchronous work inside the handler, rather than making the
mount function itself `async`. Clean up subscriptions, listeners, timers and
framework roots when the host calls the returned function.

The host remounts when the plugin, page or viewed branch changes. Query-only
navigation does not remount; subscribe to changes and read the live context.

| Context member | Use |
| --- | --- |
| `ctx.route` | Parsed route, including `pathname`, `branch` and `params` |
| `ctx.params` | Current query parameters as `URLSearchParams` |
| `ctx.branch` | Branch segment in the route, if present |
| `ctx.viewingRef` | Viewed branch ref; `null` for filesystem sources |
| `ctx.templates` | Loaded template metadata |
| `ctx.revision` | Data revision, a number the host increments each time the graph reloads (file watcher, git poll, manual reload) |
| `ctx.api.get(path, params)` | Fetch parsed JSON from an API endpoint; throws on non-2xx responses |
| `ctx.navigate(hash)` | Navigate to a hash URL |
| `ctx.hrefForNode(id, options)` | Resolve a node destination; optional `{ via: 'plugin-id', page: 'page-id' }` selects a plugin page |
| `ctx.nodeLinks(id)` | Quick-link and **Open in** entries for a node, as `{ quick: { header, relations }, menu: { explorerHref, destinations, actions } }`. Each link is `{ key, pluginId, id, label, icon, href }`; `explorerHref` (the Explorer view, `#/node?id=…&view=explorer`, which never redirects to a plugin) is non-null only when a plugin page claims the node. A child node resolves through its owning root and keeps its own ID in every href. |
| `ctx.openNode(id, options)` | Navigate using the same resolution as `hrefForNode` |
| `ctx.hrefForPage(params, options)` | Build a URL for this plugin, preserving the viewed branch; optional `{ page: 'map' }`, otherwise the current page |
| `ctx.subscribe(listener)` | Listen for route/query, viewed-ref, template or `revision` changes; returns an unsubscribe function |
| `ctx.onError(error)` | Report an asynchronous failure to the host's error panel for this mount |

Use `ctx.api.get('nodes', { template: 'DomainModel' })` or
`ctx.api.get('/api/graph')` for graph data. Parameters can be an object,
`URLSearchParams` or a list of pairs. The client supplies the viewed `ref`
unless explicitly provided. Other existing read endpoints include
`/api/templates`, `/api/cluster`, `/api/search` and `/api/lineage`; plugins do
not add server endpoints. Use the context API rather than building fetch URLs
so requests retain the viewed branch.

### Refreshing after a graph reload

When the graph reloads, the host increments `ctx.revision` and notifies
`ctx.subscribe` listeners. The page is not remounted: query-state, scroll and
local state survive. Plugin pages refresh the same way host screens do. In
React, `useApi(path, params)` from `corum:ui/react` fetches through `ctx.api.get`
and refetches automatically when the path, params, viewed ref or revision
changes. It returns `{ data, error, loading, refresh }`, ignores out-of-date
responses, keeps the previous `data` while a refresh for the same request is
in flight, and reports failures in `error` instead of throwing. Plain DOM
plugins subscribe and refetch when `ctx.revision` changes.

```js
import { html } from 'corum:ui'
import { useApi } from 'corum:ui/react'

const Nodes = () => {
  const { data, error, loading } = useApi('nodes', { template: 'DomainModel' })
  if (error) return html`<p>${error.message}</p>`
  return loading && !data ? html`<p>Loading</p>` : html`<p>${data.length} nodes</p>`
}
```

### Routing and opening nodes

Plugin pages use `#/p/<plugin-id>/<page-id>?...`, with an optional leading
branch segment. `p` is reserved by the router, so a branch literally named
`p` cannot be addressed through the web UI.

Use `ctx.hrefForPage({ id: nodeId })` for links within your plugin. Use
`ctx.hrefForNode(nodeId)` for general node links, or `ctx.openNode(nodeId)`
for programmatic navigation. The host resolves a child node through its owning
root for `opens` matching, while passing the original node ID to the page.
With one matching page, it opens that page; with several, the generic node
page shows an **Open in** chooser; with none, it opens the generic node page.
Only enabled, available plugins participate. Adding `opens` therefore changes
where normal node links lead; omit it when you only want an optional action.

The resolved link is the one that picks the primary plugin view. The host's
built-in node page (the Explorer view) is always available at
`#/node?id=<id>&view=explorer`, which never redirects to a plugin, even with a
single claimant; the **Open in** menu's "Explorer view" entry uses it, and
`hrefForExplorerView(nodeId, { branch })` builds it. Plugin pages shown for a
node should include `<NodeLinks nodeId=... surface="header" />` so users can
reach the other views.

Direct plugin URLs bypass that choice. A link to a disabled, unavailable or
removed plugin shows the host's unavailable page. Retain the node ID under
`id` in a direct link if you want that page to offer a generic node-page link.

## SDK, libraries and styling

Plain DOM plugins need no imports. React plugins use host-provided modules:

```js
import { html, StateTag } from 'corum:ui'
import { mountReact, useCtx } from 'corum:ui/react'

function Page() {
  const ctx = useCtx()
  return html`<section className="node-list-page">
    <h1>Node list</h1>
    <p>${ctx.params.get('id') ?? 'No node selected'}</p>
    <${StateTag} state="proposed" />
  </section>`
}

export const mountNodeList = mountReact(Page)
```

This can replace the example's `index.js` without changing its manifest.
`mountReact(Component)` handles mounting and cleanup. The component receives
`ctx` as a prop; `useCtx()` also exposes it to descendants. Both update when
the context changes. `html` is htm bound to React, so JSX is unnecessary.
If you use JSX or TypeScript, compile it yourself to browser ES modules.

`corum:ui/react` exports `mountReact`, `useCtx`, `useApi`, `CtxProvider` and the node link
components. `NodeLinks({ nodeId, surface })` renders the quick icons for
`surface` (`'header'` or `'relations'`) followed by the **Open in** menu button,
the same controls the host shows on node pages and connection rows.
`QuickLinks({ nodeId, surface })` and `OpenInMenu({ nodeId })` render the two
parts separately; each renders nothing when it has no entries. They read
`useCtx()`, so they work in any component under `mountReact`, or under
`CtxProvider ctx=${ctx}` for a ctx you hold yourself:

```js
import { html } from 'corum:ui'
import { NodeLinks } from 'corum:ui/react'

const Heading = ({ nodeId }) => html`<h2>${nodeId} <${NodeLinks} nodeId=${nodeId} surface="header" /></h2>`
```

The components use the host's `quick-links`, `quick-link`, `open-in`,
`open-in-trigger`, `open-in-menu`, `open-in-item` and `open-in-sep` CSS classes;
these are the styling hooks. The `ok` test fixture plugin
(`test/fixtures/plugins/ok`) demonstrates them together with `SchemaCard`.

`corum:ui` exports `html` and shared components including `Icon`, `StateTag`,
`StabilityTag`, `Chip`, `TemplateBadge`, `PropertyValue`, `PropertiesTable`,
`SchemaCard` and `BrandMark`, plus the helpers `getDisplayName(id)` (the last
segment of a node ID) and `kindColour(kind)` (a stable colour per node kind).
Shared node references in `SchemaCard`, `PropertyValue` and `PropertiesTable` use
the surrounding context's `hrefForNode`. Render them under `mountReact` or
`CtxProvider` so links preserve the viewed branch and normal plugin resolution.
An explicit property `onNavigate` callback still handles ordinary clicks (for
example, scrolling to a node already displayed); the resolved href remains
available for opening a new tab. The host supplies Explorer routing in Explorer views.

The remaining exports, `navigate`, `createRegistry`, `matchKeysFor`,
`owningRoot`, `resolveNodeTarget`, `hrefForNode`, `hrefForAction`, `hrefForExplorerView` and
`isPageAvailable`, are routing and registry plumbing the host shell uses;
plugins should prefer the equivalent `ctx` members. Adding or removing an SDK
export is a compatibility promise, so the export list is pinned by
`test/architecture.test.ts`.

Plugins use SDK specifiers only: do not read host globals such as
`window.CorumHost` or `window.CorumRouter`, and do not import host or other
plugin files by path. Built-in plugins are held to this by architecture tests. The static import map also provides `react`, `react-dom`,
`react-dom/client`, `react/jsx-runtime`, `htm`, `reactflow` and `elkjs`.
Use the host's copies of these libraries, especially React. Plugins cannot
extend the import map. Vendor other dependencies inside the plugin and import
them with relative module paths.

Plugins share the page's light DOM and CSS. Prefix CSS classes and custom
element names with your plugin ID. A plugin can attach a stylesheet using
`new URL('./style.css', import.meta.url)` as the `href` of a `<link
rel="stylesheet">` element, and remove the link during cleanup. CSS imports
that require a bundler are not handled automatically.

Assets are served under `/plugins/<id>/...` only while the plugin is enabled
and available. Allowed extensions are `.js`, `.mjs`, `.css`, `.json`, `.svg`,
`.png` and `.wasm`. YAML, including `plugin.yaml`, is never served. Files must
stay within the plugin directory, including through symlinks. Module and asset
responses use `Cache-Control: no-cache` with ETags; no version query string is
needed for relative imports.

## Bundle a plugin with a pack

Put the plugin under the pack directory and add its directory to `pack.yaml`:

```yaml
# Merge these keys into the pack's existing manifest.
plugins:
  - ui/node-list
files:
  - ui/node-list/plugin.yaml
  - ui/node-list/index.js
```

Plugin directory paths are relative to the pack and must stay inside it.
Discovery uses the packs listed in the graph's `templatePacks`; no standalone
`path` registration is needed. A graph can still disable the plugin by ID.

For packs distributed through `corum pack install`, list every plugin file in
the pack's `files` list, including relative imports and stylesheets, alongside
any existing adapter files. The `plugins` list discovers directories; it does
not download their contents. The current pack installer downloads `files` as
text, so distribute binary assets separately rather than relying on that
installer to preserve them.

## Troubleshooting

Visit `http://localhost:3000/api/plugins` for server-resolved manifests,
versions, origins and statuses. `enabled` means the server accepts the plugin;
its module may not have been imported yet. `disabled` means a graph override
turned it off. `unavailable` includes a reason such as missing templates or an
incompatible Corum version.

| Symptom | Check |
| --- | --- |
| Plugin absent from `/api/plugins` | Filesystem source, registration path relative to `graph.yaml`, and server logs for missing/invalid manifests or duplicate IDs |
| Plugin unavailable | `engines.corum`, `requires.templates`, and the reported reason |
| Page fails on first open | Browser console/network errors, relative imports, and the exact named `mount` export; browser import failures are recorded client-side, not in the server's status response |
| Asset returns 404 | Plugin enabled, correct filename, allowed extension, file inside the plugin directory |
| Query changes have no effect | Use `ctx.subscribe()` or the React adapter; do not capture query values only at mount |
| Edits do not appear | Re-resolve manifests on the server and reload the browser to clear loaded modules |
| Node action absent | `appliesTo` matching, a `page` declared in the same manifest, and `menu`/`quick` settings for the intended surface |

A thrown mount error or a failure reported through `ctx.onError` shows an error
panel for that mount; other pages remain usable. Before sharing a plugin,
check direct navigation, query-only navigation, leaving and reopening the
page, its node actions, and disabling it through `graph.yaml`.
