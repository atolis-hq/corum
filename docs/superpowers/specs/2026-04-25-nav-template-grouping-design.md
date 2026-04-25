# Nav Template Grouping

**Date:** 2026-04-25
**Branch:** BuildGraphExamples

## Problem

Domain Event and Integration Event appear as separate top-level sections in the nav tree. They should be visually grouped under an "Event" heading since they are both subtypes of the abstract Event template.

## Solution Overview

Concrete templates declare which template they group under via `ui.nav.navGroup`. The nav builder collects templates sharing the same `navGroup` into a group entry. Colour inheritance is resolved once at template load time in the client, so renderers receive pre-resolved values with no fallback logic.

## Template Config

Two concrete templates gain a `navGroup` field. DomainEvent's redundant `icon` and `colour` (which duplicate Event's) are removed — they will be inherited at load time.

```yaml
# DomainEvent.yaml
ui:
  displayName: Domain Event
  displayProperties: []
  nav:
    navGroup: Event

# IntegrationEvent.yaml
ui:
  icon: share-nodes
  colour: "#D96C4A"
  displayName: Integration Event
  displayProperties: []
  nav:
    navGroup: Event
```

The `Event` template is unchanged. It remains the source of the group heading's icon (`bolt`), colour (`#E8A838`), and display name (`Event`).

## TypeScript Schema

`src/schema/index.ts` — add `navGroup` to `ui.nav`:

```ts
nav?: {
  nestOwned?: Array<{ section: string; label?: string }>
  navGroup?: string
}
```

## Colour Resolution (`app.jsx`)

After fetching templates from `/api/templates`, a `resolveTemplates(templates)` pass runs before `setTemplates`. For each template where `ui.nav.navGroup` is set and `ui.colour` is absent, it copies the colour from the referenced group template. The resolved colour is written back onto the template object so all downstream consumers (nav builder, renderers) read a concrete value with no conditional logic.

```js
function resolveTemplates(templates) {
  const map = new Map(templates.map(t => [t.name, t]));
  for (const t of templates) {
    const groupName = t.ui?.nav?.navGroup;
    if (!groupName) continue;
    if (!t.ui?.colour) {
      const groupTemplate = map.get(groupName);
      if (groupTemplate?.ui?.colour) {
        t.ui = { ...t.ui, colour: groupTemplate.ui.colour };
      }
    }
  }
  return templates;
}
```

## Nav Builder (`nav.js`)

### Return type change

```
// before
Map<component, Map<templateName, node[]>>

// after
Map<component, Array<NavEntry>>
```

where `NavEntry` is:

```js
{ kind: 'template', templateName, nodes }
// or
{ kind: 'group', groupTemplateName, label, icon, colour, children: Array<{ templateName, label, icon, colour, nodes }> }
```

### Builder logic

1. For each template, check `ui.nav.navGroup`.
2. Templates with no `navGroup` produce `kind: 'template'` entries as before.
3. Templates sharing the same `navGroup` value are collected into a single `kind: 'group'` entry. The group header's `label`, `icon`, and `colour` come from the named group template.
4. Each child entry within a group carries the concrete template's resolved `colour` and `icon` (may be absent).
5. Within a group, children are sorted alphabetically by `templateName`. Plain template entries sort the same as today.

## NavTree Rendering (`app.jsx`)

`NavTree` maps over the array of `NavEntry` per component:

- `kind: 'template'` — renders exactly as today (template heading + node items)
- `kind: 'group'`:
  - **Group heading row** (`nav-template-head`): group template's icon + display name + colour. Not clickable.
  - **Subtype heading row** (`nav-subtype-head`, new style): per child entry, indented one level. Shows the child template's `icon` only if one is present; uses resolved `colour`. Not clickable.
  - **Node items** under each subtype heading: `nav-node-item nav-node-child`, same as existing child node items.

### Visual structure

```
▸ orders
    ⚡ Event                    ← nav-template-head (Event icon + colour)
        Domain Event            ← nav-subtype-head (no icon, Event colour)
            order-placed        ← nav-node-item
        ↗ Integration Event    ← nav-subtype-head (share-nodes icon, #D96C4A)
            order-shipped       ← nav-node-item
```

## CSS

One new rule — `nav-subtype-head`: same pattern as `nav-template-head` but indented (e.g. `padding-left: 28px`) and slightly smaller font weight or size to visually subordinate it.

## Out of Scope

- Clicking group or subtype headings to navigate (Event is abstract with no nodes)
- Server-side colour resolution
- Changes to node page rendering or API
