# Styling

The styling contract is [ADR-011](../project/adrs/ADR-011-design-tokens-themes-and-layouts.md). It is a
documented, versioned, tested surface that plugin and pack authors can rely on:

| Artifact | Role |
|----------|------|
| `web/sdk/tokens.json` | Every public token in [W3C DTCG](https://www.designtokens.org/) format, and the contract version. The source of truth. |
| `web/sdk/classes.json` | The standard CSS classes (markup) a plugin may use. |
| `web/tokens.css` | The host's default (light) token values, generated from `tokens.json` by `npm run tokens`. Committed; a test fails when it is stale. |
| `web/builtin/themes/` | The built-in `themes` plugin: `light.css` (generated), `dark.css` and `high-contrast.css`. |
| `web/style.css` | The standard classes and the host styles. |
| `test/fixtures/styling-contract.snapshot.json` | Snapshot of the version, token names and class names with their `since`. |

The contract version is `$extensions.corum.version` in `tokens.json` (currently **2**), exposed at runtime as
`--corum-tokens-version`. Removing or renaming a token or class is a breaking change and needs a version bump. There
are no aliases or compatibility shims. Adding one is not breaking, but it needs `since` set to the current version.

## Rules

- No hard-coded colours. Never write a hex, `rgb()` or `hsl()` literal in CSS, JSX or JS. Use a semantic token
  (`var(--background)`, `var(--foreground)`, `var(--border)`, `var(--accent)`, `var(--destructive)`, ...).
- Scripts set no visual inline properties (colour, background, border, font, shadow, opacity). Use a class from
  `web/style.css` or assign a custom property (`--*`). Layout-dynamic values such as `width`, `transform` or `gap` may
  stay inline.
- Public tokens only. Use the tokens documented below. Never use primitive palette variables (`--c-*`) outside a theme
  file, and never invent a new `--` token without adding it to `tokens.json` (with `since`).
- No legacy names: `--paper*`, `--ink*`, `--rule*`, `--accent-2`, `--accent-ink`, `--ok`, `--warn` were replaced by the
  names below, with no aliases.
- Every change must work in every theme. Check light and dark at minimum; never assume a white or dark page. Do not
  use `color-scheme`-specific literals or `@media (prefers-color-scheme)` in component styles; themes own that.
- Pack colours are data: they come from `ui.colour`, kinds and edge types through `--node-colour` / `--edge-colour`
  and the derived tint, border and text tokens. Never hard-code a kind or edge-type colour.
- Reuse the standard classes below rather than writing one-off styles. Plugin-specific styling uses a class namespaced
  with the plugin id (`graph-*`, `explorer-*` for the built-in plugins).
- Layouts are CSS-only: do not hide or reorder host regions; structure is controlled by `--nav-width`,
  `--content-max`, `--density` and `data-layout`.
- Accessibility is part of styling: adequate text contrast in every theme, a visible focus ring (`--ring`), and
  keyboard operability for menus and popovers (follow the Open in menu pattern).

`test/architecture.test.ts` and `test/styling-contract.test.ts` enforce these. `corum plugin validate` reports colour
literals and visual inline styles in a plugin's own sources as advisory warnings (the exit code is unchanged).

## Tokens

Defined in `web/sdk/tokens.json`. The CSS custom property is `--` plus the token name. Origin is the design system the
name follows (`shadcn`, `material`) or `corum`. Every token with scope *theme* is set by every theme (light in
`tokens.css`, dark in `style.css`).

### Colour

| Token | Origin | Since | Use |
|-------|--------|-------|-----|
| `--background` | shadcn | 1 | Page and canvas background. |
| `--card` | shadcn | 1 | Raised surface: cards, panels, the nav rail. |
| `--muted` | shadcn | 1 | Subdued fill for chips, code and hover states. |
| `--foreground` | shadcn | 1 | Primary text. |
| `--secondary-foreground` | shadcn | 1 | Secondary text. |
| `--muted-foreground` | shadcn | 1 | Labels, captions, de-emphasised text. |
| `--subtle-foreground` | corum | 1 | Placeholder and disabled text; the colour of a node with no pack colour. |
| `--border` | shadcn | 1 | Default hairline border. |
| `--border-strong` | corum | 1 | Border for controls and dividers that must stay visible. |
| `--accent` | corum | 1 | Brand accent: primary actions, the active nav item, links. |
| `--accent-soft` | corum | 1 | Tinted background for accent badges. |
| `--accent-text` | corum | 1 | Accent text readable on `--accent-soft`. |
| `--success` | corum | 1 | Positive status. |
| `--warning` | corum | 1 | Warning status (an alias of `--accent` in the shipped themes). |
| `--ring` | shadcn | 1 | Focus ring (an alias of `--accent` in the shipped themes). |
| `--destructive` | shadcn | 1 | Errors and destructive actions. |
| `--info` | corum | 1 | Informational status. |
| `--on-accent` | material | 1 | Text and icons on an accent fill. |
| `--on-solid` | material | 1 | Text and icons on a solid status or pack-colour fill. |
| `--scrim` | corum | 1 | Backdrop behind modal overlays. |
| `--overlay-secondary` | corum | 1 | Second series in comparison overlays (the first is accent). |
| `--edge-default` | corum | 2 | Colour of an edge type that declares no colour. |
| `--kind-1` to `--kind-8` | corum | 2 | Kind colours. `--kind-1` is the default kind (component). |

### Shadow, radius and font

| Token | Origin | Since | Use |
|-------|--------|-------|-----|
| `--shadow-sm` | shadcn | 1 | Small elevation: cards and chips. |
| `--shadow-md` | shadcn | 1 | Medium elevation: popovers and menus. |
| `--shadow-lg` | shadcn | 1 | Large elevation: floating panels. |
| `--shadow-xl` | shadcn | 1 | Extra-large elevation: modal dialogs. |
| `--radius-sm` | shadcn | 1 | Small corner radius (4px): chips, tags, inputs. |
| `--radius` | shadcn | 1 | Default corner radius (6px). |
| `--radius-lg` | shadcn | 1 | Large corner radius (10px): dialogs. |
| `--font-mono` | corum | 1 | Optional. Not set by default (the stylesheet falls back to JetBrains Mono); a theme may set it. |

Shadows are DTCG `shadow` composites (`color`, `offsetX`, `offsetY`, `blur`, `spread`); an array is a layered shadow.
`--shadow-xl` has two layers.

### Input and derived tokens

These are documented because plugins read them, but a theme never sets them.

| Token | Scope | Since | Set by |
|-------|-------|-------|--------|
| `--node-colour` | input | 2 | `templateColourStyle()` or `kindColour()` |
| `--edge-colour` | input | 2 | `edgeTypeStyle()` |
| `--edge-dash` | input | 2 | `edgeTypeStyle()` |
| `--node-tint`, `--node-border`, `--node-on-tint` | derived | 2 | the `node-coloured` class |
| `--edge-tint`, `--edge-border`, `--edge-on-tint` | derived | 2 | the `edge-coloured` class |

A component may also use its own custom properties; a `var(--x)` is allowed when `--x` is documented here or declared
in the same file. The SDK components use `--icon-size`, `--prop-depth` and `--field-depth` as inputs.

## Standard classes and markup

Defined in `web/sdk/classes.json` and styled by `web/style.css` in every theme. Built-in plugins (`web/builtin/**`)
may use only these and their own namespace; a template-literal class name must start with `graph-`, `explorer-` or
the Font Awesome `fa-` prefix.

### Layout and text

| Class | Since | Use |
|-------|-------|-----|
| `content` | 1 | Page body wrapper. |
| `card` | 1 | Bordered, raised surface. |
| `card-head` | 1 | Card title bar (inside `card`). |
| `card-body` | 1 | Card content area (inside `card`). |
| `label-xs` | 1 | Small uppercase caption. |
| `label-sm` | 1 | Small muted text. |
| `mono` | 1 | Monospace text. |
| `mono-meta` | 1 | Small monospace metadata. |
| `meta-strip` | 1 | Wrapping row of node metadata. |
| `empty-state` | 1 | Placeholder instead of an empty list. |
| `text-warning` | 1 | Text in the warning colour. |
| `weight-medium` | 1 | Medium font weight. |
| `node-owner-meta` | 1 | Small muted owner name beside a node name. |
| `table-scroll` | 1 | Horizontal scroll wrapper for wide tables. |
| `icon-sized` | 1 | Font Awesome icon sized by `--icon-size`. |
| `icon-fixed` | 1 | Fixed-width icon box. |

```html
<div class="card">
  <div class="card-head">Owned nodes</div>
  <div class="card-body"><span class="label-xs">Kind</span> ...</div>
</div>
```

### Tags, chips and pack colours

| Class | Since | Use |
|-------|-------|-----|
| `tag` | 1 | Small bordered label. |
| `edge-type-tag` | 1 | Tag modifier for an edge type (with `edge-coloured`). |
| `state-draft`, `state-proposed`, `state-agreed`, `state-implemented`, `state-future`, `state-removed` | 1 | Tag modifiers for a node or edge state. |
| `stability-stable`, `stability-unstable`, `stability-deprecated` | 1 | Tag modifiers for stability. |
| `chip` | 1 | Rounded inline label. |
| `template-badge` | 1 | Template name badge (with `node-coloured`). |
| `node-coloured` | 2 | Derives the node tint, border and text tokens from `--node-colour`. |
| `edge-coloured` | 2 | Derives the edge tint, border and text tokens from `--edge-colour`. |

```js
html`<span className="tag edge-type-tag edge-coloured" style=${edgeTypeStyle(edge.type)}>${edge.type}</span>`
```

### Properties, links and menus

| Class | Since | Use |
|-------|-------|-----|
| `prop-table` | 1 | Key/value table (`PropertiesTable`). |
| `prop-key-cell`, `prop-key-label` | 1 | Key cell and label of a `prop-table` row. |
| `prop-empty` | 1 | Placeholder for an unset value. |
| `node-ref-link` | 1 | Link to another node. |
| `quick-links` | 1 | Row of quick links (`QuickLinks`). |
| `quick-link` | 1 | One quick link. |
| `open-in` | 1 | Open in menu container (`OpenInMenu`). |
| `open-in-trigger` | 1 | Open in menu button. |
| `open-in-menu` | 1 | Open in popover list. |
| `open-in-item` | 1 | One Open in entry. |
| `open-in-sep` | 1 | Separator between Open in groups. |

### State modifiers

| Class | Since | Use |
|-------|-------|-----|
| `active` | 1 | The current item of a list, tab or button group. |
| `selected` | 1 | The chosen row of a list or menu. |

## Themes

A theme is a plugin contribution (`contributes.themes` in `plugin.yaml`, see [plugins](plugins.md#themes)) and sets
tokens and nothing else. Light, dark and `high-contrast` ship the same way, in the built-in `themes` plugin
(`web/builtin/themes`). The theme file holds a single `:root { ... }` block (or bare declarations) of documented tokens
(scope *theme* or *optional*). The server serves a sanitised copy scoped to `html[data-theme="<id>"]`, with
`color-scheme` taken from the manifest's `colorScheme`.

- **Public namespace.** Any custom property that is not a documented token and does not start with `--c-` is reported and
  ignored (the rest of the theme still applies). `--c-*` primitives are a theme file's private palette: use them to
  name colours and reference them from tokens with `var(--c-name)`. `--corum-tokens-version`, `input` and `derived`
  tokens, and anything that is not a custom property (`color-scheme` included) are ignored too.
- **No selectors, imports or URLs.** A file with any other selector, an at-rule such as `@import`, `url()` or an escape
  is rejected whole. There is no JavaScript in themes, and no per-graph theme default.
- **Partial themes** are allowed: tokens a theme leaves out inherit the host's default (light) values, and validation
  warns. Give every scope-*theme* token a value, so no page falls back to a value from another scheme.
- **Contrast.** `test/pack-colour-contrast.test.ts` checks pack-colour derivations (text 4.5:1, borders 3:1) in every
  registered theme, each in its own `colorScheme`.
- **Fallback.** The host keeps the default (light) token values in `web/tokens.css`, so the UI is styled even if no
  theme loads. A stored theme whose plugin is disabled or removed behaves as **System**.

The default values are generated:

1. Edit `web/sdk/tokens.json` (`$value` is the default value, written as a DTCG value; `{color.accent}` is an alias).
2. Run `npm run tokens` to regenerate `web/tokens.css` and the built-in `light.css`, and commit both.
3. Give `dark.css` and `high-contrast.css` in `web/builtin/themes` the same token (a test fails if one is missing).
4. Add the token to this page, set `since` to the current version, and run `npm run styling:snapshot`.

## Pack colours

Packs define colours as data: `ui.colour` on templates and `colour` on edge types. A colour is a `#rrggbb` string,
or `{ light: "#rrggbb", dark: "#rrggbb" }` which is chosen by the active theme's colour scheme (CSS `light-dark()`).

The host writes one custom property per pack colour (`--pack-node-<template>`, `--pack-edge-<type>`,
`--pack-edge-dash-<type>`) into a single `<style id="corum-pack-colours">` element. Components do not read them
directly. They use the SDK helpers, which return custom-property bags for `style`:

| Helper | Returns | Pair with class |
|--------|---------|-----------------|
| `templateColourStyle(...templates)` | `--node-colour` | `node-coloured` |
| `edgeTypeStyle(type)` | `--edge-colour`, `--edge-dash` | `edge-coloured` |
| `kindColour(kind)` | a `var(--kind-N)` reference for `--node-colour` | `node-coloured` |

`edgeTypeStyle` is the single edge-type styling definition: tags, pills and Graph strokes all use it.

### Derived tokens

Given `--node-colour` and a `node-coloured` element (or `--edge-colour` and `edge-coloured`), the stylesheet derives,
with `color-mix(in srgb, ...)` against surface tokens:

| Token | Derivation | Use |
|-------|------------|-----|
| `--node-tint` / `--edge-tint` | colour 14% over `--card` | background |
| `--node-border` / `--edge-border` | colour 70% with `--foreground` | border |
| `--node-on-tint` / `--edge-on-tint` | colour 45% with `--foreground` | text on the tint |

`test/pack-colour-contrast.test.ts` evaluates these exact expressions for every pack colour in the repo's packs,
in the light and dark themes: text on the tint must reach 4.5:1 and borders 3:1 (WCAG 1.4.11). If one colour cannot
meet both, give it a `{ light, dark }` pair.

### Kind colours

Kinds map to `--kind-1` to `--kind-8` (defined by every theme). `component` is always `--kind-1`; any other kind is
`--kind-(2 + hash(kind) % 7)`. `--edge-default` colours edge types that declare no colour.

## Changing the contract

The snapshot test (`test/styling-contract.test.ts`) compares the contract with the committed snapshot:

- Removing or renaming a token or class fails unless the version in `tokens.json` and `classes.json` is higher than in
  the snapshot. Bump it, note the change below, and migrate every in-tree use in the same change.
- Adding a token or class fails unless it has `since` equal to the current version.
- Changing the `since` of an existing name fails.
- Then regenerate the snapshot with `npm run styling:snapshot`.

The static checks also fail on: a `var(--x)` in `web/` that is neither documented nor declared in the same file; a
theme setting an undocumented token; a built-in plugin class that is not a standard class or `graph-*`/`explorer-*`;
and a template-literal class name with another prefix. A PR that changes how the UI looks embeds before/after
screenshots in its body (see `DEVELOPMENT.md`).

## Token changes in contract version 2

Documented since version 2 (`--corum-tokens-version: 2`):

- Added: `--edge-default`, `--kind-1` to `--kind-8` (theme tokens); `--node-colour`, `--edge-colour`, `--node-tint`,
  `--node-border`, `--node-on-tint`, `--edge-tint`, `--edge-border`, `--edge-on-tint` (host-derived, per element).
- Removed (breaking): `--edge-triggers`, `--edge-triggers-soft`, `--edge-produces`, `--edge-produces-soft`,
  `--edge-calls`, `--edge-calls-soft`, `--edge-implements`, `--edge-implements-soft`, `--edge-reads`,
  `--edge-reads-soft`. Migration: edge-type colours now come from pack data. Replace
  `var(--edge-<type>)` / `var(--edge-<type>-soft)` with `var(--edge-on-tint)` / `var(--edge-tint)` on an element that
  has the `edge-coloured` class and `style={edgeTypeStyle(type)}`.
- SDK: `edgeTypeStyle` and `templateColourStyle` added; `TemplateBadge` takes `template` instead of `colour`.
- Plugin-specific built-in classes were renamed into the plugin namespaces: `nav-*` (Explorer tree) to
  `explorer-nav-*`, `ns-kind-pill` to `explorer-kind-pill`, `signal-dot*` to `explorer-signal-dot*`, and the Graph
  state classes `faded`, `focal`, `inactive` to `graph-faded`, `graph-focal`, `graph-inactive`. They were never part of
  the documented contract.
