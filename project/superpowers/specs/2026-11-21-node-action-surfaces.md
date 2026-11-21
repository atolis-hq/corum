# Node action menus and shortcuts

The user approved connection-row overflow menus and consolidating the OK
fixture, then clarified that menu membership must be independent of shortcuts.

## Contract

- `menu` defaults to true. `menu: false` excludes an action from Open in menus
  without affecting its shortcuts. Non-boolean values are manifest errors.
- `quick` controls only icon shortcuts on `header` and `relations` surfaces.
- Page claims through `opens` remain menu destinations independently of actions.
- Each action is rendered once per configured surface. Different actions may
  target the same page; the host must not deduplicate by destination.
- The Graph and OK actions explicitly opt into menus and both quick surfaces.
  The OK fixture has one View in OK action, using the default `id` parameter.

## Rendering

Reuse OpenInMenu in the node header and each connection row. Match a linked
child through its owning root, but target the original child ID in every link.
Preserve the viewed branch. Render no empty overflow trigger. Menu clicks must
not bubble into connection-row navigation. Existing Escape and outside-click
dismissal remain available. Connection cards must not clip menus.

## Verification

Validate parsing and registry defaults, then exercise headers, connection rows,
menu-only and shortcut-only actions, disabled plugins, owned children and branch
links in Playwright. Update ADR-010 and public guides. Rebuild and restart the
fixture server on port 3001 with test fixture plugins enabled.
