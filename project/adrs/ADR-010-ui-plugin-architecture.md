# ADR 010 — UI Plugin Architecture

**Date:** 2026-11-20
**Status:** Accepted
**Supersedes:** the "Plugin extensibility" section of ADR-007 (the `window.CorumPlugins` registry). ADR-007's no-build-step decision still stands; its use of Babel-in-the-browser for JSX does not (see section 3).

## Decision

The web UI becomes a thin host shell plus plugins. A plugin is a directory with a `plugin.yaml` manifest and an ES module. The manifest declares what the plugin adds (pages, node actions); the module supplies the code. Plugins are loaded at runtime with no build step, use a framework-neutral mount contract, and get shared modules (React, the host SDK) from the host through a single static import map.

The existing Models/Explorer and Graph screens are rewritten as built-in plugins that use exactly the same manifest, loader and SDK as third-party plugins, so the mechanism is proven by first-party use. The Dashboard stays in the host source tree as the landing page; it is not a plugin, has no manifest, is statically imported, and cannot be disabled or removed through plugin configuration. It is written against the same SDK surface as plugin pages (a `mount(el, ctx)` handler wrapped by the React adapter, data through `ctx.api`, links through `ctx.hrefForNode`) and is registered directly into the host's page registry, so it exercises the SDK, `ctx` and adapter even when no plugin loads.

No backwards compatibility is kept. `window.CorumPlugins`, `window.CorumPrimitives`, the template-override hook in `app.jsx`, and the `/api/plugins` file-list endpoint are removed.

## Context

The web UI (`web/`, `src/web/server.ts`) is hardcoded: the nav rail is a literal array in `app.jsx`, `router.js` has a fixed `KNOWN_PATHS` set, and sections are chosen by `if` chains. The only extension point is a per-template node-page override, and nothing has ever used it.

Template packs (`.corum/packs/*`, activated per graph in `graph.yaml` `templatePacks`) already let a graph gain new kinds and schemas. Packs will introduce data that needs bespoke views (user-journey maps, event-model tables with swimlanes per bounded context). A pack that adds a kind should be able to add a UI for it, and a UI should also be installable separately: some plugins work on existing schemas, others need specific pack data. Users must be able to turn a plugin off.

Constraints:
- No build step for the host or for plugin authors (ADR-007).
- The Git repo is the database; there is no external infrastructure. Plugins must be installable the same way packs are.
- Graph data access is already template-agnostic (`/api/nodes`, `/api/graph`, `/api/cluster`, `/api/lineage`, `/api/search`, `/api/templates`).

## Design

### 1. The plugin unit and its discovery

A plugin is a directory:

```
journeys/
  plugin.yaml
  index.js
  vendor/        # optional vendored libraries
```

Plugins reach the host three ways, all resolving to one in-memory plugin list:
- **Built-in.** Shipped with Corum in `web/builtin/<id>/`. Always discovered.
- **Bundled in a pack.** `pack.yaml` gains `plugins: [ui/journeys]` (paths relative to the pack). Enabling the pack makes its plugins available.
- **Standalone.** Registered in `graph.yaml` with a path (below).

`graph.yaml` has one `plugins:` list, the single source of truth for registration and overrides:

```yaml
plugins:
  - { path: .corum/plugins/journeys }          # registers a standalone plugin
  - { id: journeys, enabled: false }           # override for any discovered plugin
```

- An entry with `path` registers a standalone plugin (same shape as `templatePacks`).
- An entry with `id` and `enabled` overrides a discovered plugin (built-in, pack-bundled or standalone). Absence means enabled.
- `enabled: false` means the plugin is not loaded at all and contributes nothing.
- The writers (`src/writer/graph-writer.ts`, `src/pack/graph-yaml.ts`) and loader must round-trip and validate this key.

Plugin discovery is repo/team wide. Per-user overrides are out of scope.

### 2. Manifest

```yaml
id: journeys
version: 0.1.0
engines: { corum: ">=0.4" }
requires: { templates: [Journey, JourneyStep] }
main: ./index.js
contributes:
  pages:
    - { id: map, title: Journeys, icon: route, mount: mountJourneyMap, opens: [Journey, JourneyStep] }
  nodeActions:
    - { id: view-in-journey, label: View in journey, icon: route, appliesTo: [DomainModel], page: map, param: focus, quick: [header] }
```

| Field | Meaning |
|---|---|
| `id` | Unique, `[a-z0-9-]`. Namespaces routes, assets, element names, CSS classes. Appears in URLs, so treat as stable once published. |
| `version` | The plugin's own semver. Display metadata only; not used for caching. |
| `engines.corum` | Semver range of Corum versions the plugin supports. The host refuses to load a plugin outside the range and reports why. |
| `requires.templates` | Templates that must exist in the loaded graph. A plugin may require templates it does not open. |
| `main` | The ES module the host loads. It is the code. |
| `contributes` | Declarative list of what the plugin adds. It is data, so the host can build nav, check `requires` and honour the enable toggle without executing plugin code. |

`mount` values name exports of `main`.

Contribution types for v1:
- **pages**: a route plus a nav entry (title and icon yield the nav item; there is no separate nav-item contribution). Optional `order`. Optional `opens`: templates or roles for which this page is a destination when a node is opened (section 5a).
- **nodeActions**: a link the host shows on node pages for nodes matching `appliesTo` (template names or roles, resolved through the extends chain per `src/graph/roles.ts`; `"*"` matches every node). It is a generated direct link to the named `page` for that node, `#/<branch?>/p/<plugin>/<page>?<param>=<nodeId>` (built by the SDK's `hrefForAction`); there is no custom action code. This is the "View in journey" mechanism. Optional fields:
  - `icon`: a Font Awesome icon name used when the action is shown as a quick link.
  - `param`: the query parameter that carries the node id on the target page. Default `id`.
  - `menu`: whether the action appears in "Open in" menus. Default `true`; `false` permits shortcut-only actions. Independent of `quick`.
  - `quick`: surfaces where the host also shows the action as an icon-only link, a list drawn from `header` (the node page title row) and `relations` (each connection row, targeting the linked node, so `appliesTo` is matched against that node). Default none. Unknown surfaces are a manifest error.

  Node headers and connection rows have an "Open in" menu listing matching page claims and applicable actions whose `menu` is true. Connection-row matching uses the linked node's owning root, while links retain the original linked node ID and viewed branch. Empty menus are hidden. Menu membership and icon placement are independent: `quick` alone does not add or remove a menu entry. One action can appear in both places without a second declaration. The host names no plugin: the Graph plugin's "View in graph" link is a `"*"` action with `menu: true` and `quick: [header, relations]`, so disabling the plugin removes every Graph link.

Deliberately not in v1: custom node-page renderers (a plugin that wants to render a node opens a page), plugin-defined extension points (other plugins contributing into a plugin's slots), and shadow-DOM isolation. Each can be added later without breaking manifests.

### 3. Module contract

`main` is a plain ES module. There is no build step and no in-browser transpilation: first-party and third-party plugins alike are plain JavaScript. For markup, the SDK exports an `html` tagged template (htm bound to React's `createElement`) and plugin authors may use `createElement` directly. Authors who want JSX or TypeScript may compile with their own tooling; the output only has to satisfy this contract.

Handlers are framework-neutral:

```js
export function mountJourneyMap(el, ctx) {
  // render into el
  return () => { /* unmount */ }
}
```

`ctx` is one object per page mount, kept live by the host. Its fields:

| Field | Meaning |
|---|---|
| `route`, `params` | The parsed current route and its query parameters (`URLSearchParams`), including the focused node `id`. |
| `branch` | The branch segment of the URL, if any. |
| `viewingRef` | The branch ref being viewed (`null` for file sources). |
| `templates` | The loaded templates for the viewed graph. |
| `revision` | The host's data revision: a number incremented whenever the graph reloads. Included in the `subscribe` change check, so listeners learn of a reload without a remount. |
| `api.get(path, params)` | Branch-aware GET over the `/api/*` endpoints (`path` is `/api/graph` or just `graph`; `params` is an object, `URLSearchParams` or list of pairs). It adds the `ref` query parameter from `viewingRef`, returns parsed JSON and throws on non-2xx. |
| `navigate(hash)` | Set the location hash. |
| `hrefForNode(id, { via })`, `openNode(id, { via })` | Node link resolution from section 5a, as an href or as a navigation. |
| `nodeLinks(id)` | The entries behind the quick links and the "Open in" menu for a node: `{ quick: { header, relations }, menu: { explorerHref, destinations, actions } }`, each link `{ key, pluginId, id, label, icon, href }`, resolved through the node's owning root with the node action and claim rules of section 5a. |
| `hrefForPage(params, { page })` | Href for this plugin's own page (default: the current one) with the given query parameters and the viewed branch. |
| `subscribe(listener)` | Calls `listener` when `route`/`params`, `viewingRef`, `templates` or `revision` change; returns an unsubscribe function. |
| `onError(error)` | Report an asynchronous failure so the host shows its error panel for this mount. |

The host remounts a page only when the plugin, page or viewed branch changes. A change to query parameters alone (a graph focusing a node, a table changing sort order) does not remount: the page reads the new values through `subscribe`. Framework-neutral handlers should re-render from `ctx` inside their listener; the plugin owns its state across such changes.

The SDK ships a React adapter (`corum:ui/react`: `mountReact(Component)`) that wraps a component in this contract. The component receives `ctx` as a prop, and a `useCtx()` hook returns the same value anywhere beneath it; both re-render whenever `subscribe` fires, so `ctx.params` and friends are plain values in render code. Built-in plugins use the adapter. `corum:ui/react` also exports `useApi(path, params)`, which returns `{ data, error, loading, refresh }` from `ctx.api.get` and refetches when the request, the viewed ref or `ctx.revision` changes (stale responses are dropped; errors are reported, not thrown), so plugin pages refresh after a graph reload exactly as host screens do. It also exports `CtxProvider` (supplies a ctx to `useCtx()`; the host wraps its own pages in one backed by a host-level ctx) and the node link components `NodeLinks`, `QuickLinks` and `OpenInMenu`, which render `ctx.nodeLinks` and are used by the host's node page and connection rows as well as by plugin pages.

The SDK (`corum:ui`) also exports the shared components currently in `web/primitives.jsx` (`SchemaCard`, `StateTag`, `StabilityTag`, `TemplateBadge`, `PropertiesTable`, `Icon`, ...) and the generic helpers `getDisplayName(id)` and `kindColour(kind)`. The export list of both SDK specifiers is pinned by `test/architecture.test.ts`; adding or removing an export is a compatibility promise. Plugins always obtain shared components from the SDK, never by file path or globals. This keeps future host-controlled overrides of shared components (for example replacing how a template renders in a card) possible without touching plugins. Such overrides are not part of v1.

### 4. Getting graph data

Plugins read through `ctx.api` (and a `useGraph`-style helper in the React adapter), a branch-aware client over the existing `/api/*` endpoints. Plugins do not hand-build URLs, so branch and overlay handling stays in the host. Raw `fetch` is possible but unsupported.

No server extension in v1. The existing endpoints are generic enough to build the journey and event-model views. A server hook (plugin-contributed routes or queries) is deferred until a plugin demonstrates a need the generic API cannot meet.

### 5. How code and pages reach the browser

**Modules and import map.** `web/index.html` contains one static import map, written before any module script and never extended at runtime. It maps:
- `corum:ui` and `corum:ui/react` (the host SDK)
- `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`
- the shared heavy libraries used by built-ins (reactflow, elk)

The host serves these from its own vendored files, not a third-party CDN, so the app works offline and cannot be broken by a CDN change. Where a library has no usable ESM build, the host serves a small generated shim module that re-exports the library's global with an explicit list of named exports. The set of specifiers the host provides is the plugin-facing contract and is versioned with `engines.corum`.

**Serving.** The server resolves enabled plugins at startup and on reload and serves each plugin directory at `/plugins/<id>/…`.
- Only an extension allowlist is served (`.js`, `.mjs`, `.css`, `.json`, `.svg`, `.png`, `.wasm`). `plugin.yaml` and other YAML are never served.
- Requested paths are normalised and must stay inside the plugin directory; `..` and symlinks that escape it are rejected. MIME types come from the extension (JavaScript as `text/javascript`).
- Responses use `Cache-Control: no-cache` with an `ETag`. Version query strings are not used, because they would not cover a plugin's own relative imports.
- **File sources** read from the plugin directory on disk.
- **Git sources** read plugin files from the default-branch ref, pinned to one commit per request, resolving paths with the same prefix check; ETag is derived from the blob or commit id. Other branches and overlay views use the default branch's plugin set; plugin availability (`requires`) is evaluated against the default-branch graph.

**Resolved plugin list.** `GET /api/plugins` returns resolved manifests with a status per plugin: `enabled`, `disabled`, or `unavailable` plus reason (missing templates, `engines` mismatch, load error). It replaces the old file-list endpoint.

**Loading and failure.**
- Enabled plugins' manifests are read at boot (cheap); their `main` modules are imported lazily on first use of a contribution, keeping startup fast.
- A rejected `import()` marks the plugin `unavailable` with the reason and never blocks the shell.
- Each mount runs inside a host error boundary; an exception in a plugin shows an error panel for that mount only.
- Reload (SSE `/api/events`, or `--plugin-dir` file changes) re-resolves the plugin list and performs a full page reload; ES modules cannot be unloaded, so in-place hot swap is not attempted.

**Routing.** Plugin routes are `#/p/<id>/<page>?…`, optionally with a leading branch segment as today. `router.js` is rewritten so that:
- `p` is a reserved first segment that parses syntactically as a plugin route (`pathname` retains `/p/<id>/<page>`), with no dependency on the plugin registry, so deep links parse before plugins load. A branch literally named `p` is therefore unreachable and is documented as reserved.
- `buildRoute` produces the same form.
- `KNOWN_PATHS` for host pages is retained for the host's own routes (`/node`, `/namespace`); the Dashboard is a host route (`/dashboard`); the other sections (models, graph) become plugin pages.

**Default route.** An empty route goes to the host Dashboard. The nav rail shows the Dashboard first, then enabled plugin pages ordered by `order`. With every plugin disabled the app still works, showing only the Dashboard and the generic node page.

The host shell keeps: the Dashboard, top bar, search, nav rail rendering, router, import map, the generic node page, the plugin loader and the "plugin unavailable" page.

### 5a. Node resolution and navigation

Nothing builds node URLs itself. All links to a node, in search, the Explorer, the Graph, lineage and plugins, go through one host function: `ctx.openNode(nodeId)`, or `ctx.hrefForNode(nodeId)` where an `href` is needed. The generic node page `#/node?id=…` remains the canonical address and the fallback. Search is a host feature and builds its links the same way; plugins do not contribute search results in v1.

Resolution:
1. Resolve the node to its owning root (a hit on a child such as a field opens its root cluster and scrolls to the child, as the node page does today).
2. Collect pages from enabled, available plugins whose `opens` matches the root's template or role (roles resolved through the extends chain).
3. Apply the first rule that matches:
   - Exactly one page matches: go to it, passing the node id as a route parameter (`#/p/<id>/<page>?id=…`).
   - Two or more match: do not choose. Go to the generic node page, which shows an "Open in…" bar listing each claimant and the generic view.
   - None match: the generic node page.

Because the chooser is the node page, ambiguity works for plain links and shared URLs and needs no popup. There is no priority field and no pinned default; the chooser is the only tie-break (a team-wide pin can be added later if wanted).

Direct links skip resolution. `hrefForNode(id, { via: '<pluginId>' })` (and `openNode(id, { via })`) return the plugin page URL (`#/p/<id>/<page>?id=…`) for that node. The entries in the "Open in…" bar and `nodeActions` are plain links of this form, not redirects, so each is a stable, shareable URL, and cross-plugin links such as "View in journey" use it. Opening a direct link whose plugin is disabled or removed shows a host "plugin unavailable" page with the reason and a link to the generic node page. The resolved `#/node?id=…` link is the form that survives plugin changes.

**Explorer view bypass.** The resolved link picks the primary plugin view; the host's built-in node page (the Explorer view, Models detail) must always stay reachable. `#/node?id=…&view=explorer` renders that page without redirecting, even with exactly one claimant (with several it shows the page with the Open in menu). `hrefForExplorerView(id, { branch })` builds it; the Open in menu's "Explorer view" entry (`ctx.nodeLinks(...).menu.explorerHref`) uses it, and navigation that starts inside Models (tree, connections, schema references) uses it so the Explorer stays in the Explorer. Every host `/node` page is the Explorer, with or without `view=explorer`, so all node links rendered on it (connection rows, schema links, property links) use the Explorer form. Resolved links (`#/node?id=…`) from elsewhere (plugin pages, Dashboard) and search results are unchanged. There is no new configuration; rendering a plugin in place instead of redirecting, and pinned default views, remain deferred.

Disabled or unavailable plugins are excluded from step 2, so a resolved link never points at a page that is not mounted.

### 6. Enablement

Covered by section 1 (`plugins:` in `graph.yaml`). Additionally, a plugin whose `requires.templates` are missing, or whose `engines` range excludes the running Corum, is `unavailable`: not mounted, no nav entry, with the reason surfaced in `/api/plugins` and the UI.

### 7. Libraries, conflicts and isolation

Plugins share one page, so isolation is by convention, not sandbox:
- **Host-provided modules** (the specifiers in the import map: React, ReactDOM, the SDK, reactflow, elk) come only from the host. Plugins never vendor their own copies; two copies of React or a repeated custom-element definition break.
- **Everything else** is vendored under the plugin directory (relative imports) or imported from an absolute URL. ES modules are keyed by URL, so two plugins can use different versions of the same library and each gets its own instance. Vendoring is preferred over CDN URLs.
- **Names**: custom elements and CSS classes must be prefixed with the plugin id.
- **CSS**: light DOM. Plugins do not extend the import map.

### 8. Trust

A plugin is arbitrary JavaScript running with the full privileges of the page, and plugins can arrive through a graph repo. This is accepted, with the same trust level as installing a package. There is no sandbox. Docs must say so, and plugin installation should be as explicit as pack installation. Standalone `plugins: - path:` entries in `graph.yaml` may point at any directory containing a `plugin.yaml`, under the same trust model as installing a package: the path is an explicit act of installation by whoever controls the graph configuration.

### 9. Versioning and updates

- `engines.corum` is checked at load; the host-provided module specifiers and the `ctx`/SDK surface are the contract it protects.
- Updating a plugin is the same act as updating a pack: replace the directory (re-install or git pull). `no-cache` plus ETag means the browser revalidates every module, including a plugin's relative imports.
- A `corum plugin update` command is a later concern.
- Contract changes are made as breaking changes while Corum is pre-1.0; `engines` ranges carry the compatibility signal.

### 10. Developer experience

v1:
- `corum web --plugin-dir <path>`: load an unpacked plugin without registering it, with reload on change via the existing file watcher.
- Type declarations for the host SDK (`.d.ts`), so JSDoc gives type checks with no build step.

After the first third-party plugin works: `corum plugin init <id>` (scaffold), `corum plugin validate [dir]` (manifest schema, `engines`, and `requires.templates` against a graph), and a mock host plus fixture-graph harness for unit tests (Playwright is already in the repo for end-to-end).

## Alternatives considered

1. **React-only component contract.** Simpler, shares primitives directly. Rejected: it couples every plugin, and the contract, to React. Neutral `mount` plus a React adapter costs one thin layer and is exercised by the built-ins from day one.
2. **Built-ins stay JSX compiled in the page, third-party plugins plain ESM.** Avoids rewriting about 2,500 lines of JSX. Rejected: it leaves two loading paths and the built-ins would not prove the real path. The rewrite is accepted because validating the architecture is a goal.
3. **Plugins only as pack content (no standalone).** Fewer concepts. Rejected: UIs should be installable and toggleable independently of schemas, and some plugins work over existing schemas.
4. **Imperative global registry (extend `window.CorumPlugins`).** Rejected: no declarative surface, so the host cannot build nav, gate on `requires`, or disable a plugin without executing it; also global-state coupling.
5. **Bundler or module-federation based plugins.** Rejected: reintroduces a build step for plugin authors and the host, contrary to ADR-007. Authors who want a build can still produce an ES module that satisfies the contract.
6. **One iframe per plugin.** Real isolation. Rejected for now: it loses shared context, navigation integration and primitives, which cross-page features like "View in journey" depend on.
7. **Separate nav-item contribution.** Rejected: a page already carries title and icon, so one contribution yields route and nav entry and they cannot drift apart.
8. **Node-page renderer contribution.** Rejected for v1: a plugin that wants to render a node opens a page; the chooser and direct links cover navigation without a second way to claim a template.
9. **Priority or pinned defaults for ambiguous nodes.** Rejected for v1: the "Open in…" chooser on the generic node page is deterministic, shareable and needs no extra schema.

## Consequences

- `graph.jsx` and the Explorer part of `app.jsx` are rewritten as built-in plugins, and `primitives.jsx` becomes the host SDK, all in plain ES modules; nav and routing become data-driven. The Dashboard, node page and shell stay in the host. This is the bulk of the work and should be staged: contract, loader and router first, then one screen ported end to end (Graph is the most self-contained), then the Explorer.
- Third-party CDN script tags for React, reactflow and elk are replaced by vendored host-served modules.
- `pack.yaml` and `graph.yaml` schemas grow (`plugins`).
- A new manifest schema, plugin loader, asset-serving path (including git sources) and SDK surface must be maintained.
- Authors get a no-build path; first-party built-ins prove it.
- Plugins can break the page; trust is by installation, not enforcement.

## Open items (builder decisions)

- Whether the host shell's own code (Dashboard, node page) stays JSX compiled in the page or moves to plain ES modules too; it only needs to consume the SDK as an ES module.
- Whether reactflow and elk have ESM builds that can be vendored or need generated shim modules.
- Whether standalone plugin installation goes through the pack registry or a new registry entry type.
- Whether `html` (htm) or plain `createElement` is the recommended authoring style in docs and scaffolds.
- When to add: custom node renderers, extension points, shadow-DOM isolation, pinned defaults, server-side extension.
