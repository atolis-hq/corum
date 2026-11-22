/* Theme selection: resolves the stored choice to a theme id, applies it as data-theme on <html>, persists it per browser.
   web/index.html carries a minimal inline copy of resolveTheme for first paint; test/theme.test.ts keeps the two in agreement. */

export const THEME_KEY = 'corum:theme'
export const SYSTEM = 'system'

/* Built-in themes. Plugin-contributed themes will register here later. */
export const THEMES = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
]

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function readChoice(storage) {
  try {
    const value = storage.getItem(THEME_KEY)
    return THEMES.some(theme => theme.id === value) ? value : SYSTEM
  } catch {
    return SYSTEM
  }
}

export function writeChoice(storage, choice) {
  try { storage.setItem(THEME_KEY, choice) } catch {}
}

/* choice (`system` or a theme id) -> effective theme id */
export function resolveTheme(choice, prefersDark) {
  if (THEMES.some(theme => theme.id === choice)) return choice
  return prefersDark ? 'dark' : 'light'
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
  const next = THEMES.some(theme => theme.id === choice) ? choice : SYSTEM
  try { writeChoice(win.localStorage, next) } catch {}
  applyTheme(next, win)
  return next
}

/* Keep `system` live: re-applies on OS changes. Explicit themes ignore them. Returns an unsubscribe function. */
export function watchSystem(win = window) {
  let query
  try { query = win.matchMedia(DARK_QUERY) } catch { return () => {} }
  const onChange = () => {
    if (getChoice(win) === SYSTEM) applyTheme(SYSTEM, win)
  }
  query.addEventListener?.('change', onChange)
  return () => query.removeEventListener?.('change', onChange)
}
