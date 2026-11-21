# UI Plugin Architecture (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Corum web UI pluggable: a host shell that loads plugins (manifest + ES module) with a framework-neutral mount contract, proven by porting the Graph screen to a built-in plugin.

**Architecture:** A static import map exposes host-provided modules (`corum:ui`, `react`, ...) to plain ES-module plugins. The server discovers plugins (built-in dir, pack-bundled, standalone), evaluates status (`enabled|disabled|unavailable`) and serves their assets; the browser host registers contributions (pages, node actions) in a registry, lazily `import()`s `main`, and resolves node links (single claimant, chooser, or generic page). The host shell and Dashboard stay in `web/app.jsx` (Babel) and consume the SDK through `window.CorumHost`.

**Tech Stack:** TypeScript (server, `node:test`), plain ES modules + `htm` + React 18 UMD-backed shims (browser), Playwright (e2e), `semver`.

**Spec:** `project/adrs/ADR-010-ui-plugin-architecture.md` (approved). Read it first; this plan only records decisions the ADR leaves to the builder.

**Scope:** Core only (ADR staging steps 1-3). Explorer port, git-source plugin assets, `--plugin-dir`, `.d.ts`, docs, extra tests are tracked in `project/superpowers/plans/2026-11-20-ui-plugins-followup-issues.md`. Interim state after this plan: Dashboard and Models/Explorer remain host code; Graph is a built-in plugin; the nav rail merges host items and plugin pages.

## Global Constraints

- No build step and no in-browser transpilation of plugin code: plugins and the SDK are plain ES modules. Only the host shell's existing `app.jsx`/`search.jsx` may stay `type="text/babel"`.
- No CDN for scripts at runtime: React, ReactDOM, reactflow, elkjs, htm and Babel are served from `/vendor/*` out of `node_modules`. (Google Fonts and Font Awesome CSS may stay on CDN.)
- Host-provided specifiers (the plugin-facing contract): `corum:ui`, `corum:ui/react`, `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, `reactflow`, `elkjs`.
- One static import map in `web/index.html`, before any module script; never extended at runtime.
- Plugin routes are `#/p/<id>/<page>?…`; `p` is a reserved first segment. Dashboard is the default route and stays host code.
- Plugin asset serving: extension allowlist `.js .mjs .css .json .svg .png .wasm`; never serve `plugin.yaml`/YAML; reject `..` and symlink escapes; `Cache-Control: no-cache` + `ETag`; no `?v=`.
- `engines.corum` checked against `package.json` version; `requires.templates` against the loaded default graph.
- No backwards compatibility: delete `window.CorumPlugins`, `window.CorumPrimitives`, the template-override hook in `app.jsx` (~line 967), the old `/api/plugins` file list and `getPluginFiles`.
- Server code style: TypeScript strict, ESM with `.js` import suffixes, no semicolons, single quotes. Tests use `node:test`; `npm test` must pass at every commit. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Work on a branch per stage (`ui-plugins/1-contract`, `ui-plugins/2-loader`, `ui-plugins/3-graph-port`), each stacked on the previous, one PR each.

## Review Focus

1. Plugin id or branch named `p`: a branch literally called `p` is unreachable and documented; a plugin id `p` must still route (Task 1 test).
2. Path traversal / symlink escape / YAML disclosure on `/plugins/<id>/*` (Task 5 tests).
3. A plugin whose `main` fails to import, or whose `mount` throws: shell and other plugins keep working (Task 7 tests).
4. Node claimed by two plugins → chooser; direct link to a disabled/missing plugin → "plugin unavailable" page, never a blank page (Tasks 3, 7, 8 tests).
5. Malformed `plugin.yaml`, duplicate plugin ids, id colliding with a built-in, `graph.yaml` `plugins:` dropped by the writers on round-trip (Tasks 4, 5 tests).

---

## STAGE 1 — Contract plumbing (`ui-plugins/1-contract`)

### Task 1: Router supports plugin routes

**Files:** Modify `web/router.js`; Test `test/router.test.ts` (extend; it loads `web/router.js` via `vm`).

**Interfaces:**
- Produces: `parseRoute(hash)` returns `{ branch, pathname, params, plugin }` where `plugin` is `{ id, page } | null`. `pathname` keeps the full `/p/<id>/<page>`. `buildRoute({pathname, params, branch})` is unchanged in signature.

- [ ] **Step 1: Write failing tests** in `test/router.test.ts`:
  - `parseRoute('#/p/journeys/map?id=a')` → `branch null`, `pathname '/p/journeys/map'`, `plugin {id:'journeys', page:'map'}`, `params.get('id')==='a'`.
  - `parseRoute('#/main/p/journeys/map')` → `branch 'main'`, same plugin.
  - `parseRoute('#/p/journeys')` → `plugin {id:'journeys', page:null}`.
  - `parseRoute('#/dashboard').plugin === null`; `parseRoute('#/main/node?id=x').plugin === null`.
  - `buildRoute({pathname:'/p/journeys/map', params:{id:'x'}, branch:'main'}) === '#/main/p/journeys/map?id=x'` and without branch `'#/p/journeys/map?id=x'`.
- [ ] **Step 2:** Run `npm test` (or `npm run build && node --test dist/test/router.test.js`); expect the new tests FAIL.
- [ ] **Step 3:** In `parseRoute`: handle first segment `p` before the branch rule; otherwise keep branch rule but build `pathname` from all remaining segments (`'/' + rest.join('/')`, each decoded). Set `plugin` from segments after an optional branch when the first non-branch segment is `p`.
- [ ] **Step 4:** Run tests; expect PASS (existing router tests included).
- [ ] **Step 5:** Commit `feat(web): route parsing for plugin pages`.

### Task 2: Vendor host libraries and serve the import map modules

**Files:** Modify `package.json` (deps: `react@18.3.1`, `react-dom@18.3.1`, `reactflow@11.11.4`, `elkjs`, `htm`, `@babel/standalone@7.29.0`, `semver`; dev: `@types/semver`); Create `src/web/vendor.ts`; Modify `src/web/server.ts` (mount routes), `web/index.html`; Test `test/web.test.ts` (extend).

**Interfaces:**
- Produces: `src/web/vendor.ts` exports `registerVendorRoutes(app: express.Express): void` serving `GET /vendor/<name>` from a fixed allowlist map (name → file resolved with `createRequire(...).resolve`), and `GET /vendor/shims/<spec>.js` generated ES shims for `react`, `react-dom`, `react-dom/client` (`react-dom-client.js`), `react-jsx-runtime.js`, `reactflow`, `elkjs`. Shims re-export the UMD globals (`window.React`, `window.ReactDOM`, `window.ReactFlow`, `window.ELK`) with an explicit named-export list (derive `react`/`react-dom` names from `Object.keys(require(...))`; list reactflow names used in `web/graph.jsx` plus `default`). `react/jsx-runtime` shim implements `jsx`, `jsxs`, `Fragment` over `createElement`.
- `web/index.html` gains `<script type="importmap">` (placed before every script) mapping the host specifiers to `/vendor/shims/*` and `/sdk/*` (Task 3), and the UMD/Babel/ELK `<script>` tags switch from `unpkg.com` to `/vendor/*`.

- [ ] **Step 1: Failing tests** in `test/web.test.ts`: `GET /vendor/react.umd.js` → 200, `text/javascript`; `GET /vendor/shims/react.js` → 200 and body contains `export const useState`; `GET /vendor/shims/react-jsx-runtime.js` body contains `export function jsx`; `GET /vendor/../package.json` and `GET /vendor/nope.js` → 404.
- [ ] **Step 2:** Run `npm install` then `npm test`; expect FAIL.
- [ ] **Step 3:** Implement `registerVendorRoutes`; call it from `createApp` before `express.static`. Keep `.jsx` served as `text/babel` for the host files.
- [ ] **Step 4:** Edit `index.html`: import map first; load vendored UMD scripts; keep `nav.js`, `router.js`, `graph-utils.js`, Babel scripts unchanged otherwise.
- [ ] **Step 5:** Run `npm test` and `npm run test:web`; app must still render identically (existing Playwright specs pass).
- [ ] **Step 6:** Commit `feat(web): serve vendored libraries and host import map`.

### Task 3: SDK modules, registry and node resolution

**Files:** Create `web/sdk/package.json` (`{"type":"module"}`), `web/sdk/registry.js`, `web/sdk/resolve-node.js`, `web/sdk/react.js`, `web/sdk/index.js`, `web/sdk/primitives.js` (ES-module port of `web/primitives.jsx` using `html`), `web/host/boot.js`; Modify `web/index.html` (importmap entries `corum:ui` → `/sdk/index.js`, `corum:ui/react` → `/sdk/react.js`; `<script type="module" src="host/boot.js">`), `web/app.jsx`, `web/search.jsx`, `web/graph.jsx` (read from `window.CorumHost.sdk` instead of `window.CorumPrimitives`); Delete `web/primitives.jsx`; Test `test/sdk-registry.test.ts` (imports the `.js` modules from `web/sdk/` with dynamic `import(pathToFileURL(...))`).

**Interfaces:**
- `registry.js`: `createRegistry()` → `{ registerPlugin(entry: PluginEntry): void, pages(): PageEntry[], findPage(pluginId, pageId): PageEntry|null, claimants(matchKeys: string[]): PageEntry[], nodeActionsFor(matchKeys: string[]): ActionEntry[], plugins(): PluginEntry[] }`. `PluginEntry = { id, status: 'enabled'|'disabled'|'unavailable', reason?, manifest, load(): Promise<Module> }`. Only `enabled` entries contribute pages, claimants and actions. `PageEntry = { pluginId, id, title, icon, order, opens: string[], mount(el, ctx): () => void }` where `mount` lazily calls `load()` and the named export. `pages()` sorts by `order` then `title`.
- `resolve-node.js`: `resolveNodeTarget(registry, matchKeys: string[], opts?: { via?: string }): { kind: 'page', pluginId, pageId } | { kind: 'chooser', claimants: PageEntry[] } | { kind: 'generic' }`; `hrefForNode(registry, nodeId, matchKeys, { branch, via }): string` using `buildRoute` semantics (generic `#/node?id=…`, page `#/p/<id>/<page>?id=…`, with optional branch prefix; a `via` that is missing/disabled yields the generic href).
- `react.js`: `mountReact(Component): (el, ctx) => () => void` (creates a root with `react-dom/client`, renders `<Component ctx={ctx}/>`, returns unmount).
- `index.js`: exports `html` (htm bound to `React.createElement`), the primitives from `primitives.js` (same names as today's `window.CorumPrimitives`), `createRegistry`, `resolveNodeTarget`, `hrefForNode`.
- `host/boot.js`: sets `window.CorumHost = { sdk, registry }` (module scripts run before Babel's DOMContentLoaded transforms).

- [ ] **Step 1: Failing tests** `test/sdk-registry.test.ts`: disabled/unavailable plugins contribute nothing; `pages()` order; `claimants(['Journey'])` returns only matching enabled pages; `resolveNodeTarget` → `generic` for none, `page` for one, `chooser` for two; `via` for a missing plugin → generic; `hrefForNode` outputs `#/node?id=a.b`, `#/p/journeys/map?id=a.b`, and with branch `#/main/p/journeys/map?id=a.b`; `nodeActionsFor` filters by `appliesTo`.
- [ ] **Step 2:** Run `npm test`; expect FAIL.
- [ ] **Step 3:** Implement `registry.js` and `resolve-node.js` (pure, no DOM).
- [ ] **Step 4:** Port `primitives.jsx` → `primitives.js` using `html` (JSX → htm: `className=${…}`, `<${Comp} …/>`, `<//>`); keep behaviour identical. Implement `react.js`, `index.js`, `boot.js`; switch `app.jsx`, `search.jsx`, `graph.jsx` to `window.CorumHost.sdk`; delete `primitives.jsx` and its script tag.
- [ ] **Step 5:** Run `npm test` and `npm run test:web` (existing specs: mobile navigation, table scroll); expect PASS with no visual change.
- [ ] **Step 6:** Commit `feat(web): SDK module with registry, node resolution and React adapter`. Open PR 1.

---

## STAGE 2 — Server plugins and host loader (`ui-plugins/2-loader`)

### Task 4: Manifest parsing and discovery

**Files:** Create `src/web/plugins/manifest.ts`, `src/web/plugins/discover.ts`; Modify pack manifest schema (find via `grep -rn "requires" src/pack`) to allow `plugins: string[]`, and `graph.yaml` read/write (`src/pack/graph-yaml.ts`, `src/writer/graph-writer.ts`) to round-trip `plugins:`; Test `test/plugin-manifest.test.ts`, `test/plugin-discover.test.ts`, extend `test/pack-graph-yaml.test.ts`.

**Interfaces:**
- `export type PluginManifest = { id: string; version: string; engines: { corum: string }; requires: { templates: string[] }; main: string; contributes: { pages: PluginPage[]; nodeActions: PluginNodeAction[] } }` with `PluginPage = { id; title; icon?; order?: number; mount: string; opens?: string[] }`, `PluginNodeAction = { id; label; appliesTo: string[]; page: string }`.
- `parsePluginManifest(yamlText: string): { manifest: PluginManifest | null; errors: string[] }` — validates: `id` matches `^[a-z0-9-]+$`, required fields, `main` relative and not escaping, node action `page` references a declared page, page ids unique.
- `discoverPlugins(opts: { builtinDir: string; graphDir: string | null; graphYaml: unknown; packPluginDirs: string[] }): { plugins: DiscoveredPlugin[]; errors: string[] }` with `DiscoveredPlugin = { manifest; dir: string; origin: 'builtin'|'pack'|'standalone' }`. Standalone paths come from `graph.yaml` `plugins:` entries with `path` (relative to graph dir). Duplicate ids: built-in wins, others reported in `errors`. Git sources pass `graphDir: null, packPluginDirs: []` (built-ins only; see follow-ups).

- [ ] **Step 1: Failing tests:** manifest valid/invalid cases (bad id, missing `main`, `main: ../x.js`, action → unknown page, duplicate page ids); discovery of built-in + standalone, duplicate id reports an error and keeps the built-in; `graph.yaml` with `plugins: [{path: ...}, {id: x, enabled: false}]` round-trips unchanged through the writer.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Run; expect PASS. **Step 5:** Commit `feat(plugins): manifest parsing and discovery`.

### Task 5: Status evaluation, asset serving, API

**Files:** Create `src/web/plugins/status.ts`, `src/web/plugins/assets.ts`; Modify `src/web/server.ts` (replace `/api/plugins` and `getPluginFiles`; add `/plugins/:id/*`); Test `test/plugin-status.test.ts`, `test/plugin-assets.test.ts`, extend `test/web.test.ts`.

**Interfaces:**
- `resolvePluginStatuses(plugins: DiscoveredPlugin[], ctx: { graphTemplates: Set<string>; corumVersion: string; overrides: { id: string; enabled: boolean }[] }): PluginStatus[]`; `PluginStatus = { id; origin; version; status: 'enabled'|'disabled'|'unavailable'; reason?: string; manifest: PluginManifest }`. Order of checks: override disabled → `disabled`; `engines.corum` not satisfied (use `semver.satisfies`, prerelease-inclusive) → `unavailable` with reason; any `requires.templates` missing → `unavailable` listing them.
- `resolvePluginAsset(pluginDir: string, requestPath: string): { file: string; contentType: string; etag: string } | null` — null for traversal, symlink escape (use `realpath` prefix check), disallowed extension, non-file.
- `GET /api/plugins` → `PluginStatus[]` (no filesystem paths in the payload). `GET /plugins/:id/*` serves only for `enabled` plugins, `Cache-Control: no-cache`, honours `If-None-Match` (304).
- Server computes plugin statuses at start and after each graph reload; built-in dir is `web/builtin`.

- [ ] **Step 1: Failing tests:** status cases (disabled, engines mismatch `>=99`, missing template named in reason, enabled); asset cases (`../plugin.yaml`, `%2e%2e/`, `plugin.yaml`, `foo.yaml`, symlink out of dir → null/404; `index.js` → `text/javascript`; second request with `If-None-Match` → 304); web test: `/api/plugins` returns statuses for a fixture built-in plugin and `/plugins/<disabled>/index.js` → 404.
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement and wire into `createApp`; remove `getPluginFiles`. **Step 4:** PASS. **Step 5:** Commit `feat(plugins): status evaluation, asset serving and /api/plugins`.

### Task 6: Host loader (browser)

**Files:** Create `web/host/plugin-loader.js`; Modify `web/host/boot.js`; Test `test/plugin-loader.test.ts`.

**Interfaces:**
- `loadPlugins({ fetchPlugins: () => Promise<PluginStatus[]>, importModule: (url: string) => Promise<Module>, registry }): Promise<void>` — registers every status entry; `load()` lazily calls `importModule('/plugins/<id>/<main>')` once and caches the promise; a rejection marks the entry `unavailable` with the error message and rethrows to the caller of `load()`.
- `boot.js` calls it with `fetch('/api/plugins')` and `(u) => import(u)`; exposes `window.CorumHost.ready` (Promise) resolved after registration.

- [ ] **Step 1: Failing tests** with fakes: lazy import (not called until `load()`), single import for repeated `load()`, rejected import → entry becomes `unavailable` and other plugins unaffected; `/api/plugins` fetch failure → empty registry, no throw.
- [ ] **Step 2-4:** FAIL → implement → PASS. **Step 5:** Commit `feat(web): plugin loader`.

### Task 7: Host shell integration

**Files:** Modify `web/app.jsx` (nav rail, route dispatch, NodePage chooser/actions, error boundary, plugin-unavailable page, default route), `web/search.jsx` and other node links (use `hrefForNode`/`openNode`); Create fixture plugins under `test/fixtures/plugins/` (`ok`, `broken-import`, `throws-on-mount`, `needs-missing-template`, two plugins both `opens: [DomainModel]`); Create `test/browser/plugins.spec.cjs`.

**Interfaces:**
- Consumes: `window.CorumHost.{registry, sdk}`, `parseRoute().plugin`, `hrefForNode`.
- Nav rail: Dashboard first, host Models item, then `registry.pages()` (title/icon), plus Debug toggle as today. `/p/<id>/<page>` renders the page via `page.mount` inside a per-mount React error boundary and a div the host owns; unknown/disabled/unavailable → "Plugin unavailable" page showing the reason and a link to `#/node?id=…` when an `id` param exists.
- NodePage: for a root node, `resolveNodeTarget` decides redirect (single claimant → `location.replace`), chooser bar ("Open in…" links, plus nodeActions), or generic. Node links elsewhere use `hrefForNode`.
- `CORUM_GRAPH_PATH`-driven test server must load `test/fixtures/plugins` as extra built-in dir via env `CORUM_BUILTIN_PLUGIN_DIRS` (test-only, comma-separated; add to `src/web/server.ts` discovery).

- [ ] **Step 1: Failing Playwright spec** `plugins.spec.cjs` (desktop viewport): `ok` plugin page mounts at `#/p/ok/home` and has a nav entry; `broken-import` and `throws-on-mount` show an error/unavailable message while Dashboard still loads; `needs-missing-template` has no nav entry and its direct URL shows "Plugin unavailable" with the reason; node claimed by two plugins shows the "Open in…" bar listing both; node claimed by one redirects to `#/p/<id>/<page>?id=…`; unclaimed node shows the generic page.
- [ ] **Step 2:** `npm run test:web`; expect FAIL. **Step 3:** Implement. **Step 4:** PASS, plus existing specs. **Step 5:** Commit `feat(web): plugin-driven nav, routing and node resolution`. Open PR 2.

---

## STAGE 3 — Graph as the first built-in plugin (`ui-plugins/3-graph-port`)

### Task 8: Rewrite SDK primitives in htm

**Files:** Modify `web/sdk/ui.js`, `properties.js`, `schema-model.js`, `schema-card.js` (rewrite markup only); Test: existing `test/web.test.ts` SDK assertions (update to match source), `npm run test:web`.

**Interfaces:** Unchanged exports (same names and props as today's `corum:ui`). Task 3 committed Babel-compiled `React.createElement` output; this task replaces it with readable `html` tagged-template source so the SDK is the reference style for plugin authors and matches the Graph/Explorer ports.

- [ ] **Step 1:** Port from the original JSX (`git show c05c4b0:web/primitives.jsx`) to `html` (htm bound to `React.createElement`): `className=${x}`, components as `<${Comp} prop=${v}/>` with `<//>` closers, no behaviour change. Keep modules focused (split if a file exceeds ~300 lines).
- [ ] **Step 2:** `npm run build`, `node scripts/run-tests.mjs`, `npm run test:web`; manually check Dashboard, a DomainModel node page (SchemaCard, overlay ghost rows) and the Graph page render identically with no console errors.
- [ ] **Step 3:** Commit `refactor(web): write SDK primitives in htm`.

---

### Task 9: Port Graph

**Files:** Create `web/builtin/graph/plugin.yaml`, `web/builtin/graph/index.js` (+ split helpers `web/builtin/graph/*.js` as needed; keep files focused); Delete `web/graph.jsx` and its script tag; Modify `web/app.jsx` (remove the hardcoded Graph nav item and `/graph` route; route `#/graph…` redirect is not kept); Test: extend `test/browser/plugins.spec.cjs`; existing `web/graph-utils.test.js` stays.

**Interfaces:**
- Manifest: `id: graph`, `engines.corum` matching the current version range, `main: ./index.js`, one page `{ id: view, title: Graph, icon: diagram-project, order: 20, mount: mountGraph }`. `index.js` exports `mountGraph = mountReact(GraphView)`; `GraphView` takes `ctx` (branch via `ctx.viewingRef`, `ctx.templates`, route params) instead of the old `{route, viewingRef, templates}` props; imports `reactflow` and `elkjs` through the import map and shared components from `corum:ui`; markup via `html`.
- `ctx` must expose: `viewingRef`, `templates`, `route` (parsed, with `params`), `navigate`, `hrefForNode`, `api` (`get(path, params)` returning parsed JSON with the branch applied). Add these to `window.CorumHost` context creation in `app.jsx`.

- [ ] **Step 1: Failing e2e:** `#/p/graph/view` renders a React Flow canvas for the sample graph; nav rail shows "Graph" from the plugin; existing graph interactions covered by current specs (kind filter, edge toggles) remain; screenshot compare is not required.
- [ ] **Step 2:** FAIL. **Step 3:** Port `graph.jsx` mechanically (JSX → htm, same logic); delete the old file. **Step 4:** `npm test` and `npm run test:web` PASS; manually load the app, open Graph, expand a component, toggle an edge type. **Step 5:** Commit `feat(web): Graph screen becomes a built-in plugin`. Mark ADR-010 status Accepted. Open PR 3.

---

## Self-review notes

- Spec coverage: plugin unit/discovery (T4), manifest (T4), module contract + SDK (T3), data access via `ctx.api` (T9), serving/import map/security/caching (T2, T5), routing (T1, T7), resolution/chooser/direct links (T3, T7), enablement + status (T4, T5), libraries/isolation (T2, T3), error handling (T6, T7). Not in this plan, by design: git-source plugin assets, `--plugin-dir`, `.d.ts`, tooling, Explorer port, docs (see follow-ups file).
- `ctx.api` shape is the least pinned decision; the Graph port (T9) defines it and the ADR open item is closed there.
