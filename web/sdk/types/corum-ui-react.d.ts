/**
 * Type declarations for the `corum:ui/react` SDK module (hand-maintained; no build step).
 * Drift against web/sdk/react.js is guarded by test/architecture.test.ts.
 */
declare module 'corum:ui/react' {
  import type { PluginContext, PluginMount, Component, ApiParams, QuickSurface } from 'corum:ui'

  /** Wrap a component as a page mount; the component receives `{ ctx }` and `useCtx()` works beneath it. */
  export function mountReact(component: Component<{ ctx: PluginContext }>): PluginMount
  export function useCtx(): PluginContext
  export const CtxProvider: Component<{ ctx: PluginContext; children?: unknown }>
  export function useApi<T = unknown>(path: string, params?: ApiParams): {
    data: T | null
    error: Error | null
    loading: boolean
    refresh: () => void
  }
  export const QuickLinks: Component<{ nodeId: string; surface: QuickSurface }>
  export const OpenInMenu: Component<{ nodeId: string }>
  export const NodeLinks: Component<{ nodeId: string; surface: QuickSurface }>
}
