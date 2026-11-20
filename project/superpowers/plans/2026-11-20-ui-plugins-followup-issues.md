# UI Plugins: Follow-up Issues (to file after the core lands)

Source: `project/adrs/ADR-010-ui-plugin-architecture.md` and `project/superpowers/plans/2026-11-20-ui-plugin-architecture.md`.

Filing rules (AGENTS.md): before creating each issue, ask the user how it is dispatched (no assignment / assign `atolis-hq-agent` / assign + `dark-factory` / `dark-factory` only), and add the type label (`enhancement`, `documentation`). Use `.github/ISSUE_TEMPLATE/dark-factory-task.md` for unattended dispatch. Each issue below is written to that template shape: intended outcome stated separately from the non-binding approach. All depend on the core PR stack (Stages 1-3) being merged.

Status: none filed yet.

---

## 1. Port Models/Explorer to a built-in plugin
- **Problem:** The Models/Explorer (`NavTree`, `NamespacePage`, `NamespacesPage`, node tree in `web/app.jsx`) is still hardcoded host code; only Graph proves the plugin path.
- **Intended outcome:** Models/Explorer is a built-in plugin (`web/builtin/explorer/`) using the same manifest/loader/SDK as Graph. The host keeps only the Dashboard, generic node page, shell and search. Deep links to namespaces and nodes keep working.
- **Acceptance:** `npm test`, `npm run test:web`; `#/p/explorer/…` routes work; `#/node?id=…` generic page unchanged; existing mobile-navigation and table-scroll specs pass.
- **Constraints:** Do not change `/api/*` contracts or the manifest schema; ADR-010 section 5a resolution rules unchanged.
- **Approach (non-binding):** Mechanical JSX → htm port as done for Graph; move `nav.js` helpers under the plugin.
- **Depends on:** core Stage 3.

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
- **Intended outcome:** Beyond the core tests, add coverage for: duplicate plugin ids across origins, `graph.yaml` `enabled: false` override of a built-in, `engines` prerelease handling, reload re-resolving the plugin list, and a branch named `p` (documented unreachable).
- **Acceptance:** tests present and passing in `npm test` / `npm run test:web`.

## 8. Flaky Playwright specs (mobile navigation, table scroll)
- **Problem:** Two existing browser specs fail intermittently, unrelated to the plugin work. Observed on 2026-11-20: `test/browser/mobile-navigation.spec.cjs` (the `toBeFocused` assertion near line 66) failed 1 of 8 runs on the pre-plugin `index.html` and 2 of 6 (agent saw 3 of 5) on the vendored-libraries `index.html`; `test/browser/table-scroll.spec.cjs` (393px viewport) failed about 4 of 6 baseline runs. Both appear timing-dependent (focus assertion racing with in-browser Babel compile and render).
- **Intended outcome:** Both specs pass reliably (no failures in at least 20 consecutive local runs and in CI) without weakening what they verify.
- **Acceptance:** `npx playwright test test/browser/mobile-navigation.spec.cjs test/browser/table-scroll.spec.cjs --repeat-each=20` passes; assertions still check focus behaviour and scrollability.
- **Constraints:** Fix test synchronisation (wait on a real readiness signal such as app-rendered state or an explicit focus condition), not by adding fixed sleeps or raising timeouts alone; do not change user-visible behaviour unless the flake reveals a real bug.
- **Approach (non-binding):** Investigate whether focus is stolen by a later re-render; add a deterministic "app ready" marker (for example a `data-ready` attribute set once the first render completes) and wait on it. Re-check after the plugin core lands, since Babel is no longer the only startup cost.
- **Labels:** `bug`. **Depends on:** none (can run any time; more useful after core Stage 3).

## 9. Later / not yet issues (decide when needed)
- Custom node renderers, plugin-defined extension points, shadow-DOM isolation, pinned default openers for ambiguous nodes, server-side extension hooks, a mock-host test harness, `corum plugin update`, per-user plugin overrides, standalone plugin install via the pack registry.
