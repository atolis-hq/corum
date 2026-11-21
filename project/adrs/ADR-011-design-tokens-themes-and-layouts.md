# ADR 011 — Design Tokens, Themes, Layouts and Style Guide

**Date:** 2026-11-21
**Status:** Proposed (pending product-owner acceptance; delivery issues are filed only after this ADR is merged)
**Relates to:** ADR-010 (UI plugin architecture), ADR-007 (web app tech stack). Resolves #180; the delivery tracker is #181.

## Decision

Styling becomes a versioned, documented contract between the host and plugins:

1. A **two-tier token system**. Themes set a public, semantic token vocabulary; the primitive palette behind it is private to each theme.
2. **Themes are contributed through plugin manifests** (`contributes.themes`). Light and dark ship as a built-in plugin that uses the same mechanism as third-party themes.
3. The **theme choice is per user** (browser), not per graph.
4. **Pack-defined colours stay as pack data.** The host derives theme-appropriate fills, borders and text from them. There is one definition of edge-type styling.
5. **Layouts are host-owned, CSS-only, and a per-user choice**, contributed the same way as themes, delivered after themes.
6. The **style guide is a built-in plugin**, which proves the contract is sufficient for plugins.
7. The nav rail's Debug button is replaced by a **Settings popover** containing a theme selector and a debug toggle.

## Context

Measured on 2026-11-21 (see `project/superpowers/plans/2026-11-21-theming-and-styling-epic-notes.md`):

- `web/style.css` defines 29 custom properties (`--paper*`, `--ink*`, `--rule*`, `--accent*`, `--ok`, `--warn`, `--radius`) for light and dark, but still hard-codes about 28 hex colours.
- Scripts hard-code about 44 hex colours (`web/builtin/graph/constants.js`, `web/app.jsx`, `web/sdk/schema-rows.js`, the kind palette in `web/graph-utils.js`). A ratchet test stops the count rising.
- Nothing in the UI sets `data-theme`, so dark mode is unreachable. Dark is scoped to `body[data-theme="dark"]` while light is scoped to bare `[data-theme="light"]`.
- Edge-type styling is duplicated (`EDGE_TYPE_STYLES` in `app.jsx`; `EDGE_STYLES` and `EDGE_PILL_STYLES` in the Graph plugin).
- Plugins already depend on host classes (`card`, `card-head`, `label-xs`, `meta-strip`, `quick-link*`, `open-in*`) by convention; nothing documents or tests them.
- Templates declare a single hex `ui.colour`; edge-type colours come from packs.
- Debug mode is a rail button persisted in `localStorage` (`corum:debugMode`).

Users will choose themes and layouts, plugins must be styled by global styles without changing, and a style guide is wanted.

## Design

### 1. Token naming and tiers

**Tier 1, primitives (private).** Raw palette values such as `--c-gray-900`. Themes may define them for their own use. They are not part of the contract; plugins must not use them.

**Tier 2, semantic tokens (public contract).** Named by role, not by appearance. Names are **adopted from shadcn/ui (and Radix Themes) and Material 3 where they apply to Corum**, because plugin authors, designers and coding agents already know them. Where both cover a concept, shadcn's name is preferred (`background`, `foreground`, `muted`, `border`, `destructive`, `radius`); Material supplies names and ideas where shadcn has none (the paired `on-` content token, for example). Where neither fits Corum's own concepts (edge types, kinds, layout), Corum defines the name. Corum does not adopt a whole third-party vocabulary (Material, Primer, Carbon); the set below is deliberately small, and each token notes its origin in `$extensions.corum.origin` in `tokens.json`.

| Group | Tokens |
|---|---|
| Surface | `--background` (page), `--card` (panels), `--muted` (recessed, hover and tinted areas) |
| Text | `--foreground`, `--secondary-foreground`, `--muted-foreground`, `--subtle-foreground` |
| Border | `--border`, `--border-strong`, `--ring` (focus) |
| Accent | `--accent`, `--accent-soft`, `--accent-text` (Corum's brand colour; unlike shadcn, `accent` is not a hover surface, which is `--muted`) |
| State | `--success`, `--warning`, `--destructive`, `--info` |
| Edge types | `--edge-<type>` (one per edge type, plus `--edge-default`) |
| Kind fallback | `--kind-1` … `--kind-N` |
| Shape | `--radius-sm`, `--radius`, `--radius-lg` |
| Layout (host-owned) | `--nav-width`, `--content-max`, `--density` |

Adopted from Material 3 (`on-*` roles): a fill token is paired with a token for readable content on it. Derived pack colours (section 5) therefore expose `--node-tint`, `--node-border` and `--node-on-tint` rather than leaving text colour to each component. Other pairings (`--accent-soft` with `--accent-text`) follow the same rule.

There is no per-component tier. Component styling is in the host stylesheet and is derived from semantic tokens. Add a third tier only if a concrete theme need cannot be met without it.

**Format.** Tokens are authored in the W3C Design Tokens Community Group (DTCG) JSON format (`$value`, `$type`, `$description`, `{group.token}` aliases) in `web/sdk/tokens.json`, with Corum-specific metadata under `$extensions.corum` (`since`, `origin`). The CSS custom properties for the default theme and the style guide's token listing are generated from this file by a small script (no build step for plugin authors; the generated CSS is committed). This keeps the contract importable from Figma, Tokens Studio and Style Dictionary. DTCG has no theming model, so a theme is a set of values for the same token names (section 3), not a DTCG feature.

**Renaming existing names (no backwards compatibility).** The current names are replaced outright. There are **no alias layer and no deprecation period**, consistent with ADR-010. Every in-tree use (stylesheet, host, built-in plugins, docs, tests) is renamed in one change, and the old names are removed. Proposed mapping, confirmed against real usage during that change: `--paper`→`--background`, `--paper-2`→`--card`, `--paper-3`→`--muted`, `--ink`→`--foreground`, `--ink-2`→`--secondary-foreground`, `--ink-3`→`--muted-foreground`, `--ink-4`→`--subtle-foreground`, `--rule`→`--border`, `--rule-2`→`--border-strong`, `--accent-2`→`--accent-soft`, `--accent-ink`→`--accent-text`, `--ok`→`--success`, `--warn`→`--warning`. The mapping is recorded in the PR description and release notes as the migration note for third-party plugin authors, whose plugins using old names will lose styling until updated. A test fails if any old name remains in `web/`.

**Versioning.** The contract version is a single integer, `--corum-tokens-version`, set by the host. A snapshot test over `tokens.json` and the documented class list fails when a documented token or class is removed or renamed without a version bump and migration note, mirroring the SDK export snapshot. Adding a token is non-breaking (recorded in `since`); removing or renaming one is breaking (version bump).

### 2. Standard markup

The documented class vocabulary (`card`, `card-head`, `label-xs`, `meta-strip`, `quick-links`, `open-in*`, and others found during the audit) is the **standard markup**. It is listed with the tokens in the contract document (`docs/styling.md`) and covered by the same snapshot test. Plugins are not required to use SDK components; SDK layout components (`Card`, `PageHeader`, …) are an optional convenience that emits this markup and are only added if still wanted once the contract exists.

### 3. Themes: where they live and how they are contributed

A plugin manifest may contribute themes:

```yaml
contributes:
  themes:
    - id: solarized-dark
      label: Solarized Dark
      colorScheme: dark        # light | dark, sets color-scheme and the "System" mapping
      css: themes/solarized-dark.css
```

- A theme's CSS sets **only documented Tier 2 tokens** (and any private primitives) under `[data-theme="<id>"]`. The loader rejects themes whose CSS declares undocumented `--` tokens that collide with the public namespace, with a diagnostic, and ignores them.
- Light and dark become a built-in `themes` plugin using this mechanism, so first-party use proves it. The default token values (light) remain in the host stylesheet so the UI is never unstyled if no theme loads.
- All theme selectors use `[data-theme="<id>"]` on `<html>`. The inconsistent `body[data-theme]` scoping is removed.
- Packs can bundle theme plugins via `pack.yaml` `plugins:` exactly as ADR-010 describes. Themes follow the plugin enable/disable rules.

### 4. Theme scope: per user

The choice is stored in the browser (`localStorage` key `corum:theme`, value a theme id or `system`). The default is `system`, which maps `prefers-color-scheme` to the first registered light or dark theme (built-in `light` / `dark`). If the stored id is not registered (for example the plugin was disabled), the UI falls back to `system`.

The host applies the theme before first paint (an inline script in `index.html` sets `data-theme` and `color-scheme`) to prevent a flash. A graph-level default theme hint in `graph.yaml` is explicitly out of scope; it can be added later without changing this decision.

### 5. Pack-defined colours

Colours for kinds, templates (`ui.colour`) and edge types **stay in packs as data**. They are single hex values and need no per-theme variants.

- **Injection.** The host exposes a pack colour as a CSS variable on the element (`--node-colour`, `--edge-colour`), never as an inline hex in component styles.
- **Derivation.** Theme-appropriate colours are derived against the active surface tokens with CSS `color-mix()` and relative colour syntax: tinted backgrounds (`color-mix(in srgb, var(--node-colour) 14%, var(--surface-1))`), borders from the colour at higher mix, and text colour mixed toward `--text-1` to meet contrast. The same derivation applies in every theme, including third-party ones.
- **Optional override.** A pack may supply `colour: { light: "#…", dark: "#…" }` in place of a single string. A string remains valid and is the common case. Themes of either `colorScheme` pick the matching key.
- **Fallback.** Kinds and edge types with no pack colour use `--kind-N` and `--edge-default` tokens, replacing the hashed hex palette (`KIND_PALETTE`). Fallback assignment stays deterministic (hash of the kind name modulo N).
- **Single edge-type styling.** Edge-type styling lives in one place: the pack's edge-type definition (colour, and dash/weight if declared), resolved by one shared SDK helper that the host and the Graph plugin both call. `EDGE_TYPE_STYLES`, `EDGE_STYLES` and `EDGE_PILL_STYLES` are deleted.
- **Acceptable rendering** is checked by a test that evaluates contrast of derived text and border colours for every pack colour in the repo's packs against every registered theme, with a minimum ratio recorded in the test.

### 6. Layouts

Layouts are **host-owned and CSS-only**. A layout is a named set of structural tokens and rules selected by `data-layout` on the shell (for example nav as a rail or top bar, density, content width). A layout may not reorder, remove or replace host regions, and may not change plugin markup. Contribution is `contributes.layouts` with the same shape as themes. The choice is per user (`corum:layout`), independent of the theme.

Layouts are delivered after themes in a separate issue. This ADR fixes only the contract above, and the token vocabulary reserves the layout group so adding layouts does not need a contract version bump.

### 7. Style guide

The style guide is a **built-in plugin** (`web/builtin/styleguide`). It is hidden from the nav by default and reachable from the Settings menu and by URL. It renders every documented token, standard class, panel, tag, table, menu and state in the active theme, using only public tokens and classes, so its being buildable proves the contract is sufficient for third-party plugins. It reads the token list from `web/sdk/tokens.json` (the DTCG file the contract test uses) so docs cannot drift from the contract. It is a visual-regression target.

### 8. Settings menu

The nav rail's Debug button is removed and replaced by a Settings (gear) button at the bottom of the rail, which opens a popover menu:

- **Theme**: a radio list of `System` plus every registered theme.
- **Debug mode**: a switch (same `corum:debugMode` storage key, same behaviour).
- **Style guide**: a link to the style guide page.

The popover follows the keyboard-accessible pattern of the Open in menu (#197): focus management, arrow-key navigation, Escape to close. The Settings menu is a host component; plugins cannot add items in this version. A `contributes.settings` point can be added later without breaking this decision.

## Consequences

- Third parties and packs can add themes without changing the host, using the mechanism ADR-010 already provides.
- Plugins are styled by the global stylesheet if they use the documented tokens and classes; the snapshot test makes that contract enforceable.
- Packs keep their one-hex colour authoring, and a new theme works with them automatically through derivation.
- Cost: a `color-mix()`-based derivation (supported by all current evergreen browsers) and a one-off breaking rename for third-party plugins using the old variable names.
- Dark mode becomes reachable from the UI for the first time.
- Theme selection is not shared between users or devices.

## Alternatives considered

- **Keep `--paper`/`--ink` as the public vocabulary.** Least churn, but names describe appearance rather than role. Rejected; the names are replaced, with no aliases.
- **Role names of our own (`--surface-1`, `--text-1`).** Equivalent in structure, but unfamiliar to plugin authors and agents; the shadcn/Radix names cost nothing extra.
- **Adopting a full third-party system (Material 3, Primer, Carbon).** Hundreds of tokens to version and test, tied to another product's components. Names and ideas are adopted selectively.
- **Ad-hoc token JSON.** Not importable by design tools; DTCG is the standard interchange format.
- **Three-tier tokens with per-component variables.** Larger contract to version and test, with no present need.
- **Themes as core CSS files only, or as pack content.** The first stops third parties adding themes; the second ties a UI preference to a graph's data model and bypasses the plugin mechanism.
- **Per-graph theme.** Light/dark is a personal preference, not a property of a graph.
- **Pack colours used as-is, or required per theme.** The first fails contrast on some themes; the second breaks when a new theme is added.
- **Layouts as component swaps.** Turns the shell into a plugin surface with accessibility and plugin-breakage risk.
- **Style guide as a host route.** Can use internals, so proves nothing about the plugin contract.
- **A full Settings page.** Over-built for two settings.

## Implementation plan

Delivered as separate issues tracked from #181, in this order:

1. Token rename: replace the old variable names with the semantic names across all in-tree CSS and JS (no aliases), unify `data-theme` on `<html>`, and add a test that fails if an old name remains.
2. Settings popover and theme switcher (replaces Debug button), with persistence and no-flash boot.
3. Token audit: stylesheet hex colours to tokens.
4. Token audit: script hex colours to tokens, pack-colour derivation, fallback palette and a single edge-type styling helper. Ratchet reaches zero.
5. Contract document (`docs/styling.md`), DTCG `tokens.json`, CSS generation script and the snapshot test. (Issue 1 introduces the new names by hand; this issue makes `tokens.json` the source of truth.)
6. `contributes.themes` in the plugin manifest and loader, built-in `themes` plugin, one additional example theme.
7. Style guide built-in plugin.
8. Layouts (`contributes.layouts`, `data-layout`, one alternative layout).
