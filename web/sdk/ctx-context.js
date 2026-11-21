/* React context carrying the current plugin ctx; shared by the adapter and the SDK components. */
import React from 'react'

export const CtxContext = React.createContext(null)

/* The current ctx; the calling component re-renders when route, params, viewingRef or templates change. */
export function useCtx() {
  return React.useContext(CtxContext)
}

/* Supplies a ctx (or a snapshot of one) to useCtx() below it. mountReact does this for plugin pages. */
export function CtxProvider({ ctx, children }) {
  return React.createElement(CtxContext.Provider, { value: ctx }, children)
}
