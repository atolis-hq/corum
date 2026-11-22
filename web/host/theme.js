/* Theme selection: resolves the stored choice to a theme id, applies it as data-theme on <html>, persists it per browser.
   Themes are contributed by plugins (`contributes.themes`, ADR-011 section 3); the host registers the ones the server
   reports for enabled plugins and names none of them. web/index.html carries a minimal inline copy of the resolution for
   first paint; test/theme.test.ts keeps the two in agreement. */

export const THEME_KEY = 'corum:theme'
export const SYSTEM = 'system'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/* Registered themes in registration order: [{ id, label, colorScheme }]. */
let registry = []
let loaded = false

/* Registers the themes of the enabled plugins, in plugin order. The first theme with an id wins; `system` is reserved. */
export function registerThemes(statuses) {
  const next = []
  for (const status of Array.isArray(statuses) ? statuses : []) {
    if (status?.status !== 'enabled') continue
    for (const theme of status.manifest?.contributes?.themes ?? []) {
      if (!theme || theme.id === SYSTEM || next.some(entry => entry.id === theme.id)) continue
      next.push({ id: theme.id, label: theme.label, colorScheme: theme.colorScheme === 'dark' ? 'dark' : 'light' })
    }
  }
  registry = next
  loaded = true
  return registry
}

export function getThemes() {
  return registry
}

const isRegistered = id => registry.some(theme => theme.id === id)

export function readChoice(storage) {
  try {
    const value = storage.getItem(THEME_KEY)
    return isRegistered(value) ? value : SYSTEM
  } catch {
    return SYSTEM
  }
}

export function writeChoice(storage, choice) {
  try { storage.setItem(THEME_KEY, choice) } catch {}
}

/* choice (`system` or a theme id) -> effective theme id. A choice that is not registered (for example the theme of a
   disabled plugin) behaves as `system`: the first registered theme of the matching colour scheme, else the host's
   built-in light defaults. */
export function resolveTheme(choice, prefersDark) {
  if (isRegistered(choice)) return choice
  const scheme = prefersDark ? 'dark' : 'light'
  return registry.find(theme => theme.colorScheme === scheme)?.id ?? 'light'
}

function prefersDark(win) {
  try { return Boolean(win.matchMedia(DARK_QUERY).matches) } catch { return false }
}

export function applyTheme(choice, win = window) {
  win.document.documentElement.setAttribute('data-theme', resolveTheme(choice, prefersDark(win)))
}

export function getChoice(win = window) {
  return readChoice(win.localStorage ?? { getItem() { throw new Error('no storage') } })
}

export function setChoice(choice, win = window) {
  const next = isRegistered(choice) ? choice : SYSTEM
  try { writeChoice(win.localStorage, next) } catch {}
  applyTheme(next, win)
  return next
}

/* Keep `system` live: re-applies on OS changes. Explicit themes ignore them. Returns an unsubscribe function. */
export function watchSystem(win = window) {
  let query
  try { query = win.matchMedia(DARK_QUERY) } catch { return () => {} }
  const onChange = () => {
    if (loaded && getChoice(win) === SYSTEM) applyTheme(SYSTEM, win)
  }
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}
