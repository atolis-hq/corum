# Node action surfaces implementation plan

> Execute inline in the existing `ui-plugins/3-graph-port` worktree, preserving
> the documentation changes already present. Design: ../specs/2026-11-21-node-action-surfaces.md.

**Goal:** Make menu membership explicit and give connection rows the same
destination choices as node headers, without duplicate OK fixture actions.

**Architecture:** Keep all matching and URL construction in the registry and
existing SDK helpers. Add a boolean to the manifest and registry, filter actions
for menus at the host call sites, and reuse OpenInMenu for connection rows.

**Tech stack:** TypeScript manifest parser, React host, plain-JS SDK, Node tests,
Playwright browser tests.

## Tasks

- [ ] Add failing parser tests for boolean `menu`, rejection of invalid values,
  and registry tests proving omission is true independently of `quick`.
  Run `npm run build` and `node --test dist/test/plugin-manifest.test.js dist/test/sdk-registry.test.js`.
- [ ] Add browser regressions for a single OK action, connection-row claimants,
  original child IDs, branch preservation, click propagation, clipping, disabled
  plugins, and independent menu/quick configuration. Run focused tests and
  confirm the missing shortcut/menu failures before implementation.
- [ ] Add `menu?: boolean` validation and preservation to
  `src/web/plugins/manifest.ts`, and `menu: action.menu ?? true` to
  `web/sdk/registry.js` (defaulting to true). Filter menu actions without filtering quick links.
- [ ] Reuse OpenInMenu in `web/app.jsx` connection rows, stop click propagation
  at the menu wrapper, hide empty menus, and allow connection-card overflow in
  `web/style.css`. Preserve existing SDK matching and link helpers.
- [ ] Include owning-root metadata on external nodes in `/api/cluster`
  (`src/web/server.ts`), so connection rows can match child nodes against roots
  that are not otherwise included in the current cluster response.
- [ ] Consolidate `test/fixtures/plugins/ok/plugin.yaml` to one action with
  `menu: true`, star icon and both quick surfaces; add `menu: true` to Graph.
- [ ] Update `docs/plugins.md`, `docs/web-ui.md`, ADR-010 and API round-trip
  coverage for the independent settings.
- [ ] Run the focused unit tests and plugin browser tests, then the full browser
  suite and unit suite. Review the final diff and resolve change-related issues.
- [ ] Rebuild and restart the port-3001 fixture server with
  `CORUM_GRAPH_PATH=fixtures/sample-graph` and
  `CORUM_BUILTIN_PLUGIN_DIRS=test/fixtures/plugins`; verify health and menus.
