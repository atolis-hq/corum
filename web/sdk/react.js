/* React adapter: mount a React component under the framework-neutral mount contract. */
import React from 'react'
import { createRoot } from 'react-dom/client'

const CtxContext = React.createContext(null)

// ctx fields are getters over the host's live state; a spread freezes them into a plain snapshot.
const snapshotOf = ctx => ({ ...ctx })

const sameView = (a, b) => a.route === b.route && a.viewingRef === b.viewingRef && a.templates === b.templates

/* The current ctx; the calling component re-renders when route, params, viewingRef or templates change. */
export function useCtx() {
  return React.useContext(CtxContext)
}

function CtxHost({ ctx, Component }) {
  const [snapshot, setSnapshot] = React.useState(() => snapshotOf(ctx))
  React.useEffect(() => {
    const refresh = () => setSnapshot(prev => (sameView(prev, ctx) ? prev : snapshotOf(ctx)))
    const unsubscribe = ctx.subscribe(refresh)
    refresh() // pick up a change that landed between the first render and this subscription
    return unsubscribe
  }, [ctx])
  return React.createElement(CtxContext.Provider, { value: snapshot }, React.createElement(Component, { ctx: snapshot }))
}

export function mountReact(Component) {
  return function mount(el, ctx) {
    const root = createRoot(el)
    root.render(React.createElement(CtxHost, { ctx, Component }))
    return () => root.unmount()
  }
}
