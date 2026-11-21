# UI Plugins: Follow-up Issues (to file after the core lands)

Source: `project/adrs/ADR-010-ui-plugin-architecture.md` and `project/superpowers/plans/2026-11-20-ui-plugin-architecture.md`.

Filing rules (AGENTS.md): before creating each issue, ask the user how it is dispatched (no assignment / assign `atolis-hq-agent` / assign + `dark-factory` / `dark-factory` only), and add the type label (`enhancement`, `documentation`). Use `.github/ISSUE_TEMPLATE/dark-factory-task.md` for unattended dispatch. Each issue below is written to that template shape: intended outcome stated separately from the non-binding approach. All depend on the core PR stack (Stages 1-3) being merged.

Status: none filed yet.

---

## 1. Port Models/Explorer to a built-in plugin (optional, low priority)
- **Note:** Graph already proves the plugin mechanism, and the Explorer has no swap-out need. Port it only for consistency or if a second large screen is wanted to exercise the mechanism. Plugging into search results (without changing the core search) is a separate, later idea.
- **Problem:** The Models/Explorer (`NavTree`, `NamespacePage`, `NamespacesPage`, node tree in `web/app.jsx`) is still hardcoded host code; only Graph proves the plugin path.
- **Intended outcome:** Models/Explorer is a built-in plugin (`web/builtin/explorer/`) using the same manifest/loader/SDK as Graph. The host keeps only the Dashboard, generic node page, shell and search. Deep links to namespaces and nodes keep working.
- **Acceptance:** `npm test`, `npm run test:web`; `#/p/explorer/…` routes work; `#/node?id=…` generic page unchanged; existing mobile-navigation and table-scroll specs pass.
- **Constraints:** Do not change `/api/*` contracts or the manifest schema; ADR-010 section 5a resolution rules unchanged.
- **Approach (non-binding):** Mechanical JSX → htm port as done for Graph; move `nav.js` helpers under the plugin.
- **Depends on:** core Stage 3. The nav helpers (`buildNavTree`, `buildOverlayIndicatorIds`, `groupNamespacesByKind`, `namespaceEdges`) move into the Explorer plugin as private modules instead of staying on `window.CorumNav`; they are not SDK exports (decided: navigation and search are host features plugins plug into).

## 2. Git-source plugin assets (pack-bundled and standalone)
- **Problem:** For git sources, discovery returns built-ins only; pack-bundled and standalone plugins from the repo are not served.
- **Intended outcome:** With a git source, plugins listed in `pack.yaml` `plugins:` and `graph.yaml` `plugins:` are discovered and served from the default-branch ref, pinned to one commit per request, with the same path-prefix, extension-allowlist, and ETag rules as file sources. Other branches/overlays use the default branch's plugin set; `requires.templates` is evaluated against the default-branch graph.
- **Acceptance:** tests with an in-memory/local git fixture: asset served, traversal rejected, YAML never served, ETag derived from blob/commit id, plugin dir missing at ref → `unavailable` with reason.
- **Constraints:** Do not change the YAML-only `loadPackContent` behaviour for template loading.
- **Approach (non-binding):** Add a `readPluginFile(ref, path)` capability on `GraphSource` using `git.listFiles`/`readBlob`.
- **Depends on:** core Stage 2.

## 3. `corum web --plugin-dir <path>` with live reload
- **Intended outcome:** A plugin author runs `corum web --plugin-dir ./my-plugin` and the unpacked plugin is loaded without registering it in `graph.yaml`; editing its files reloads the page via the existing watcher/SSE.
- **Acceptance:** CLI test covering flag parsing and discovery with `origin: 'dev'`; web test that a changed file triggers the reload event; plugin shown as dev in `/api/plugins`.
- **Constraints:** No effect on normal runs; dev plugin never persisted to `graph.yaml`.
- **Depends on:** core Stage 2.

## 4. SDK type declarations (`.d.ts`)
- **Intended outcome:** Plugin authors get type checking via JSDoc/`// @ts-check` against shipped declarations for `corum:ui`, `corum:ui/react`, the `ctx` object and the manifest, with no build step.
- **Acceptance:** A sample plugin with `// @ts-check` passes `tsc --noEmit` against the shipped `.d.ts`; declarations included in the package `files`.
- **Constraints:** Declarations must match the actual SDK exports (add a test that fails on drift).
- **Depends on:** core Stage 3 (the Graph port settles the `ctx` shape).

## 5. Plugin tooling: `corum plugin init` and `corum plugin validate`
- **Intended outcome:** `corum plugin init <id>` scaffolds a working manifest, entry module and sample page; `corum plugin validate [dir]` checks manifest schema, `engines`, and `requires.templates` against the loaded graph, exiting non-zero with readable errors.
- **Acceptance:** CLI tests: scaffold loads in the dev server; validate catches each manifest error class used by `parsePluginManifest`.
- **Depends on:** issues 3 and 4 recommended first.

## 6. Plugin documentation and ADR housekeeping
- **Intended outcome:** `docs/web-ui.md` documents the plugin contract (manifest, `ctx`, SDK modules, routing, enablement in `graph.yaml`, trust model, authoring a plugin end to end). `AGENTS.md` mentions the plugin system in the architecture section. ADR-010 status is Accepted and its open items are resolved or re-listed.
- **Acceptance:** A reader can create a working plugin from the docs alone (checked by following them once).
- **Depends on:** issues 1-3.

## 7. Additional plugin test coverage
- **Intended outcome:** Beyond the core tests, add coverage for: duplicate plugin ids across origins, `graph.yaml` `enabled: false` override of a built-in, `engines` prerelease handling, reload re-resolving the plugin list, a branch named `p` (documented unreachable), and an overlay/branch fixture so SchemaCard ghost-field rows and the overlay legend (`web/sdk/schema-rows.js`) are covered by an e2e or visual check (the sample graph has no overlay data, so the htm rewrite of these was not visually verified).
- **Acceptance:** tests present and passing in `npm test` / `npm run test:web`.

## 8. Flaky Playwright specs (mobile navigation, table scroll)
- **Problem:** Two existing browser specs fail intermittently, unrelated to the plugin work. Observed on 2026-11-20: `test/browser/mobile-navigation.spec.cjs` (the `toBeFocused` assertion near line 66) failed 1 of 8 runs on the pre-plugin `index.html` and 2 of 6 (agent saw 3 of 5) on the vendored-libraries `index.html`; `test/browser/table-scroll.spec.cjs` (393px viewport) failed about 4 of 6 baseline runs. Both appear timing-dependent (focus assertion racing with in-browser Babel compile and render).
- **Intended outcome:** Both specs pass reliably (no failures in at least 20 consecutive local runs and in CI) without weakening what they verify.
- **Acceptance:** `npx playwright test test/browser/mobile-navigation.spec.cjs test/browser/table-scroll.spec.cjs --repeat-each=20` passes; assertions still check focus behaviour and scrollability.
- **Constraints:** Fix test synchronisation (wait on a real readiness signal such as app-rendered state or an explicit focus condition), not by adding fixed sleeps or raising timeouts alone; do not change user-visible behaviour unless the flake reveals a real bug.
- **Approach (non-binding):** Investigate whether focus is stolen by a later re-render; add a deterministic "app ready" marker (for example a `data-ready` attribute set once the first render completes) and wait on it. Re-check after the plugin core lands, since Babel is no longer the only startup cost.
- **Labels:** `bug`. **Depends on:** none (can run any time; more useful after core Stage 3).

## 9. Make the generic node page reachable for single-claimant nodes
- **Problem:** With a single plugin claiming a template (`opens`), `#/node?id=…` always `location.replace`s to the plugin page (`web/app.jsx` NodePage), so the generic node page for that node cannot be reached or shared. ADR-010 section 5a calls the generic page the canonical address and fallback; a plugin page also has no way to link back to it.
- **Intended outcome:** Every node has a reachable, shareable generic view regardless of plugin claims, and resolution still redirects by default so "open node" lands in the claimant plugin.
- **Acceptance:** Playwright spec: a node claimed by one plugin can be opened on the generic page via an explicit generic link, the plugin page offers a "Generic view" link, and the default `hrefForNode` still resolves to the plugin page.
- **Constraints:** Do not change the resolution order in ADR-010 5a for default links; no new manifest fields unless the ADR is amended.
- **Approach (non-binding):** A `view=generic` route parameter that bypasses redirect (and `hrefForNode(id, { via: 'generic' })`); add the link to the plugin-unavailable page and the Open-in bar. Update ADR-010 5a accordingly.
- **Labels:** `bug`. **Depends on:** core Stage 2.

## 10. SDK primitives build node links without the branch
- **Problem:** SDK schema rows build `/node?id=` links themselves (`web/sdk/schema-rows.js`, around line 122) and omit the viewed branch/overlay, violating ADR-010 5a ("nothing builds node URLs itself"). Links from a SchemaCard on a non-default branch drop back to the default branch.
- **Intended outcome:** All node links produced by SDK primitives go through a host-provided link helper (the same `hrefForNode`/`buildRoute` path as `ctx.hrefForNode`) that honours the viewed branch and overlay, so a link never changes the branch being viewed.
- **Acceptance:** Unit test that SDK schema rows render hrefs from the injected helper (branch prefixed when a branch is viewed); Playwright check that clicking a node reference inside a SchemaCard on a branch keeps the branch in the URL.
- **Constraints:** No change to the plugin-facing SDK exports beyond accepting the helper; generic node page URLs stay unchanged.
- **Approach (non-binding):** Pass a `hrefForNode` (or link component) prop/context into `SchemaCard` and schema rows instead of concatenating `#/node?id=`.
- **Labels:** `bug`. **Depends on:** none.

## 11. Vendor fonts and Font Awesome (no runtime CDN)
- **Problem:** `web/index.html` still loads Google Fonts and Font Awesome from CDNs. Every fresh browser (each Playwright context) makes several HTTPS connections and DNS lookups to third parties; during local test runs on Windows this contributed thousands of sockets to the TIME_WAIT pile (observed 2026-11-21: roughly 6,600 to port 443 and 3,700 to port 53 out of ~17,800), which eventually made every browser fail with `net::ERR_ADDRESS_IN_USE`. The app also does not work offline.
- **Intended outcome:** The UI makes no third-party requests at runtime: fonts and icons are served by the host (like the vendored scripts), so the app works offline and tests do not depend on the network.
- **Acceptance:** Playwright spec asserting that loading the app triggers no requests to hosts other than the Corum server; visual parity of icons and fonts on Dashboard, node page and Graph.
- **Constraints:** Respect font and icon licences (include licence files); keep the `fa-solid fa-<name>` class usage working.
- **Approach (non-binding):** Serve a subset of Font Awesome free-solid and the two font families from `node_modules` or vendored files via the existing `/vendor` allowlist.
- **Labels:** `enhancement`.

## 12. Local verification gaps to re-run once the machine is clean
- The final menu and quick-link changes (commits after `2d761c5`) passed unit tests but their Playwright specs could not be re-run locally on 2026-11-21 because of the socket exhaustion above. CI runs `npm test` only (no browser specs). Re-run `npx playwright test` locally after a reboot and fix anything that surfaces.

## 13. Plugins must not read host globals: share generic helpers, keep the rest private (done in PR 4)
- **Problem:** The Graph plugin reads the host global `window.CorumGraphUtils` (`web/builtin/graph/constants.js`). A plugin depending on an undocumented host global breaks the rule that plugins use SDK specifiers only, and third-party plugins cannot do the same.
- **Intended outcome:** Generic helpers a plugin author could plausibly want (`getDisplayName(id)`, `kindColour(kind)`) are exported from `corum:ui` and documented. Graph-specific helpers (connected components, thread and owner scope filters, edge-type filtering, namespace map) move into `web/builtin/graph/` and are no longer shared globals. No built-in plugin reads a `window.Corum*` global.
- **Acceptance:** `grep -rn "window.Corum" web/builtin` finds nothing; `node web/graph-utils.test.js` (updated for the new locations) and the Graph Playwright spec pass; the SDK exports are listed in `docs/plugins.md`.
- **Constraints:** No behaviour change in Graph or the host. The SDK stays small: only things plugins need to call or reuse, each a compatibility promise covered by `engines.corum`.
- **Approach (non-binding):** ES modules under `web/sdk/` for the generic helpers; the host classic scripts read them from `window.CorumHost.sdk`.
- **Depends on:** core Stage 3.
- **Not in scope (decided):** Navigation tree helpers (`window.CorumNav`) and the search modal (`window.CorumSearch`) are host features that plugins plug into rather than extend; they do not go in the SDK. The nav helpers become private to the Explorer plugin when it is ported (issue 1).

## 14. Error, loading and empty-state panels in the SDK
- **Problem:** `PluginErrorBoundary`, the loading text and the empty-state panels live in `web/app.jsx`, so each plugin invents its own and error handling looks different per plugin.
- **Intended outcome:** The SDK exports `ErrorPanel`, `LoadingPanel` and `EmptyState` with the host's current markup and `data-testid`s; the host and the Graph plugin use them.
- **Acceptance:** Existing `plugin-error` assertions pass; a plugin page can show all three states using only SDK imports; documented.
- **Constraints:** Keep the `plugin-error` test id and wording stable. Low priority.
- **Depends on:** core Stage 3.

## 15. Data-change signal for plugins and a `useApi` hook (done in PR 4)
- **Principle (decided):** plugin pages and host screens refresh through the same mechanism, so plugin pages behave exactly like host pages and bind to data changes by default.
- **Problem:** Plugins call `ctx.api.get` in effects and hand-roll loading and error state. Mounted plugin pages also never learn about a graph reload: the host handles the `graph-reloaded` event only for its own data (`refreshAllData`), and `ctx.subscribe` fires on route, viewed-ref and template changes only. The Graph page fetches `/api/graph`, `/api/kinds` and lineage keyed on `ctx.viewingRef` alone, so after a reload it keeps showing stale data until remounted or the branch changes. (A page that depends on the whole `ctx` object, such as the `ok` fixture, refetches only incidentally, because a reload produces a new `templates` array.) Host screens update but plugin screens go stale.
- **Intended outcome:** The context exposes a "graph data changed" signal (for example a revision counter included in the `subscribe` change check) usable by non-React plugins, and `useApi(path, params)` in `corum:ui/react` returns `{ data, error, loading, refresh }`, refetching when its inputs, the viewed ref or the data revision change. The Graph plugin uses it. This is a notification that data changed, not a streaming API.
- **Acceptance:** Unit test for the hook logic; Playwright spec: trigger a reload (`POST /api/reload` or a graph file change with the watcher on) while the Graph or fixture page is open and assert the page shows the new data without navigation.
- **Constraints:** No change to `/api/*`; the signal must not remount pages (ADR-010 remount rule). Plugin discovery stays unaffected: node-data changes do not re-resolve plugins.
- **Approach (non-binding):** The host bumps a revision on `graph-reloaded`.
- **Depends on:** core Stage 3.

## 16. Theming and styling epic (handover notes, not started)
- **See:** `project/superpowers/plans/2026-11-21-theming-and-styling-epic-notes.md` for intent, known findings (tokens, hard-coded colours, duplicated edge styles, no theme switcher), the fixes that are needed, and open questions. Pack-defined edge-type, kind and template colours are intended and stay; hard-coded colours move into tokens. Needs ADR-011 first. A theme switcher in the UI is part of this epic.
- **Depends on:** core Stage 3.

## 17. Connections panel (EdgePanel) as an SDK component (optional)
- **Problem:** The Connections panel (`EdgePanel` and its rows in `web/app.jsx`) can only be rendered by the host node page.
- **Intended outcome:** `EdgePanel` is exported from `corum:ui/react` and usable by plugin pages, built on `NodeLinks` and the shared edge-type styling from the theming epic (issue 16). Only do this when a plugin needs it.
- **Acceptance:** Existing connection-row Playwright specs pass unchanged; a plugin page can render the panel; documented.
- **Constraints:** Keep the `edge-row` test id and the `corum:edgePanelOpen` persistence.
- **Depends on:** issue 16.

## 18. Later / not yet issues (decide when needed)
- Plugging into search results without changing the core search (for example a search-provider contribution type), custom node renderers, plugin-defined extension points, shadow-DOM isolation, pinned default openers for ambiguous nodes, server-side extension hooks, a mock-host test harness, `corum plugin update`, per-user plugin overrides, standalone plugin install via the pack registry, a node search/picker component only if a plugin demonstrates a need (search is a host feature).
