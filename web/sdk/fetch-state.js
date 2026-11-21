/* Fetch-state controller behind useApi: stale-response guard and keep-data-while-refreshing, with no React or browser APIs. */

/* Stable string identity of a request: path, params (order-insensitive across keys) and the viewed ref. */
export function identityOf(path, params, viewingRef) {
  const entries = params instanceof URLSearchParams || Array.isArray(params)
    ? [...new URLSearchParams(params)]
    : Object.entries(params ?? {}).filter(([, value]) => value != null).map(([key, value]) => [key, String(value)])
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
  return JSON.stringify([path, entries, viewingRef ?? null])
}

/*
 * One controller per useApi call. load(identity, fetcher) starts a request; only the latest request may
 * write state. The same identity keeps its previous data while refetching (a refresh); a new identity clears it.
 */
export function createFetchController(onChange) {
  let state = { identity: null, data: null, error: null, loading: true }
  let latest = 0
  let disposed = false
  let last = null

  function set(next) {
    state = next
    if (!disposed) onChange(state)
  }

  function load(identity, fetcher) {
    last = { identity, fetcher }
    const id = ++latest
    const keep = state.identity === identity
    set({ identity, data: keep ? state.data : null, error: null, loading: true })
    let promise
    try {
      promise = Promise.resolve(fetcher())
    } catch (error) {
      promise = Promise.reject(error)
    }
    promise.then(
      data => { if (id === latest && !disposed) set({ identity, data, error: null, loading: false }) },
      error => { if (id === latest && !disposed) set({ identity, data: null, error, loading: false }) },
    )
  }

  return {
    state: () => state,
    load,
    refresh() { if (last) load(last.identity, last.fetcher) },
    dispose() { disposed = true },
  }
}
