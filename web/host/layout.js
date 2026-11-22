/* Layout selection (ADR-011 section 6): resolves the stored choice to a layout id, applies it as data-layout on <html>,
   persists it per browser. Layouts are contributed by plugins (`contributes.layouts`) and are CSS-only: they set the
   layout tokens and nothing else. `default` is the host's own layout and is always available. web/index.html carries a
   minimal inline copy of the resolution for first paint; test/layout.test.ts keeps the two in agreement. */

export const LAYOUT_KEY = 'corum:layout'
export const DEFAULT = 'default'

/* Registered (contributed) layouts in registration order: [{ id, label }]. `default` is not stored here. */
let registry = []
let loaded = false

/* Registers the layouts of the enabled plugins, in plugin order. The first layout with an id wins; `default` is reserved. */
export function registerLayouts(statuses) {
  const next = []
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (status?.status !== 'enabled') continue
    for (const layout of status.manifest?.contributes?.layouts ?? []) {
      if (!layout || layout.id === DEFAULT || next.some(entry => entry.id === layout.id)) continue
      next.push({ id: layout.id, label: layout.label })
    }
  }
  registry = next
  loaded = true
  for (const listener of [...listeners]) listener()
  return registry
}

const listeners = new Set()
export function subscribeLayouts(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/* Every layout a user can pick: the host's `default` first. */
export function getLayouts() {
  return [{ id: DEFAULT, label: 'Default' }, ...registry]
}

const isRegistered = id => id === DEFAULT || registry.some(layout => layout.id === id)

/* The stored choice, or `default`. Until the plugin list has loaded a stored id is reported as is (so it is not lost);
   afterwards an unregistered id behaves as `default`. Storage is never rewritten by reading. */
export function readChoice(storage) {
  try {
    const value = storage.getItem(LAYOUT_KEY)
    if (typeof value !== 'string' || value === '') return DEFAULT
    if (!loaded) return value
    return isRegistered(value) ? value : DEFAULT
  } catch {
    return DEFAULT
  }
}

export function writeChoice(storage, choice) {
  try { storage.setItem(LAYOUT_KEY, choice) } catch {}
}

export function resolveLayout(choice) {
  return isRegistered(choice) ? choice : DEFAULT
}

export function applyLayout(choice, win = window) {
  win.document.documentElement.setAttribute('data-layout', resolveLayout(choice))
}

export function getChoice(win = window) {
  return readChoice(win.localStorage ?? { getItem() { throw new Error('no storage') } })
}

export function setChoice(choice, win = window) {
  const next = isRegistered(choice) ? choice : DEFAULT
  try { writeChoice(win.localStorage, next) } catch {}
  applyLayout(next, win)
  return next
}
