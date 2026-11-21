/* useApi: fetch through ctx.api.get and refetch when the request, viewed ref or data revision changes. */
import React from 'react'
import { useCtx } from './ctx-context.js'
import { createFetchController, identityOf } from './fetch-state.js'

/* Returns { data, error, loading, refresh }. Errors are reported, never thrown; stale responses are dropped. */
export function useApi(path, params) {
  const ctx = useCtx()
  const identity = identityOf(path, params, ctx.viewingRef)
  const controllerRef = React.useRef(null)
  const [state, setState] = React.useState(null)
  const latest = React.useRef(null)
  latest.current = { ctx, path, params }

  React.useEffect(() => {
    const controller = createFetchController(setState)
    controllerRef.current = controller
    return () => controller.dispose()
  }, [])

  React.useEffect(() => {
    const controller = controllerRef.current
    controller.load(identity, () => latest.current.ctx.api.get(latest.current.path, latest.current.params))
  }, [identity, ctx.revision])

  const refresh = React.useCallback(() => controllerRef.current?.refresh(), [])
  // Until the effect has run for the current request, report loading rather than a previous request's data.
  const current = state && state.identity === identity ? state : { data: null, error: null, loading: true }
  return { data: current.data, error: current.error, loading: current.loading, refresh }
}
