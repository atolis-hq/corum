/**
 * Type declarations for the `corum:ui` SDK module (hand-maintained; no build step).
 * Include this file from your jsconfig.json / tsconfig.json and add `// @ts-check` to plugin files.
 * Drift against web/sdk/index.js, the `ctx` object and docs/plugins.md is guarded by test/architecture.test.ts.
 */
declare module 'corum:ui' {
  /** Quick-link surfaces a node action can appear on. */
  export type QuickSurface = 'header' | 'relations'

  /** A page contributed by a plugin, as authored in `plugin.yaml` under `contributes.pages`. */
  export interface PluginPage {
    id: string
    title: string
    icon?: string
    order?: number
    /** Name of the export that mounts the page. */
    mount: string
    opens?: string[]
    /** false keeps the page out of the navigation rail. Default true. */
    nav?: boolean
    legacyPaths?: string[]
    sidebar?: string
    nodeSidebar?: boolean
    detail?: boolean
  }

  /** A node action contributed by a plugin, as authored under `contributes.nodeActions`. */
  export interface PluginNodeAction {
    id: string
    label: string
    appliesTo: string[]
    page: string
    icon?: string
    param?: string
    menu?: boolean
    quick?: QuickSurface[]
  }

  /** The authored shape of `plugin.yaml` (optional fields stay optional; defaults are not filled in). */
  export interface PluginManifest {
    id: string
    version: string
    engines: { corum: string }
    requires?: { templates?: string[] }
    main: string
    contributes?: { pages?: PluginPage[]; nodeActions?: PluginNodeAction[] }
  }

  /** Parsed host route. */
  export interface PluginRoute {
    pathname: string
    branch?: string | null
    params: URLSearchParams
    [key: string]: unknown
  }

  /** Query parameters accepted by `ctx.api.get` and `ctx.hrefForPage`. */
  export type ApiParams = Record<string, string | number | boolean | null | undefined> | URLSearchParams | Array<[string, string]>

  /** Options for `ctx.hrefForNode` / `ctx.openNode`. */
  export interface NodeLinkOptions {
    /** Plugin id to open the node in directly. */
    via?: string
    /** Page id within `via`. */
    page?: string
  }

  /** A quick link or "Open in" entry. */
  export interface NodeLink {
    key: string
    pluginId: string
    id: string
    label: string
    icon: string | null
    href: string
  }

  export interface NodeLinks {
    quick: { header: NodeLink[]; relations: NodeLink[] }
    menu: { explorerHref: string | null; destinations: NodeLink[]; actions: NodeLink[] }
  }

  /** The `ctx` object passed to `mount(el, ctx)`. Members read live host state. */
  export interface PluginContext {
    readonly route: PluginRoute
    /** Current query parameters. */
    readonly params: URLSearchParams
    readonly branch: string | null | undefined
    /** Viewed branch ref; null for filesystem sources. */
    readonly viewingRef: string | null
    /** Loaded template metadata. */
    readonly templates: unknown
    /** Data revision; incremented on every graph reload. */
    readonly revision: number
    /** Branch refs overlaid on the viewed branch. */
    readonly overlayRefs: string[]
    api: {
      /** Fetch parsed JSON; rejects on non-2xx responses. */
      get(path: string, params?: ApiParams): Promise<any>
    }
    navigate(hash: string): void
    hrefForNode(id: string, options?: NodeLinkOptions): string
    nodeLinks(id: string): NodeLinks
    openNode(id: string, options?: NodeLinkOptions): void
    hrefForPage(params?: ApiParams, options?: { page?: string }): string
    /** Listen for route, viewed-ref, template, overlay or revision changes. Returns an unsubscribe function. */
    subscribe(listener: () => void): () => void
    /** Report an asynchronous failure to the host's error panel for this mount. */
    onError(error: unknown): void
  }

  /** A page mount export: mount synchronously into `el` and return a cleanup function. */
  export type PluginMount = (el: HTMLElement, ctx: PluginContext) => () => void

  /** React elements are opaque here; no @types/react is required. */
  export type Element = unknown
  export type Component<P = {}> = (props: P) => Element

  /** htm bound to React.createElement (tagged template). */
  export function html(strings: TemplateStringsArray, ...values: unknown[]): any

  export function navigate(path: string): void
  export const BrandMark: Component<{ size?: number; color?: string }>
  export const Icon: Component<{ name: string; size?: number }>
  export const StateTag: Component<{ state: string }>
  export const StabilityTag: Component<{ stability: string }>
  export const Chip: Component<{ children?: unknown; title?: string }>
  export const TemplateBadge: Component<{ name: string; colour?: string }>
  /** Inline style object accepted by the shared panels. */
  type PanelStyle = Record<string, string | number>
  export const ErrorPanel: Component<{ message?: unknown; title?: string; testId?: string; className?: string; style?: PanelStyle }>
  export const LoadingPanel: Component<{ message?: string; className?: string; style?: PanelStyle; innerStyle?: PanelStyle }>
  export const EmptyState: Component<{ className?: string; children?: unknown }>
  export const PropertyValue: Component<{ value: unknown; onNavigate?: (id: string) => void }>
  export const PropertiesTable: Component<{
    properties: Record<string, unknown>
    onNavigate?: (id: string) => void
    propertyHints?: Record<string, unknown>
  }>
  export const SchemaCard: Component<{
    title: string
    nodes: any[]
    allNodes?: any[]
    edges?: any[]
    anchorIdForNode?: (node: any) => string
    overlayFields?: unknown
    overlayRefs?: string[]
    isShared?: (node: any) => boolean
    compact?: boolean
  }>

  /** Routing and registry plumbing used by the host shell; prefer the equivalent `ctx` members. */
  export function createRegistry(): any
  export function resolveNodeTarget(registry: any, matchKeys: string[], opts?: { via?: string; page?: string }): any
  export function hrefForNode(registry: any, nodeId: string, matchKeys: string[], opts?: { branch?: string | null; via?: string; page?: string }): string
  export function hrefForAction(action: any, nodeId: string, opts?: { branch?: string | null }): string
  export function hrefForExplorerView(nodeId: string, opts?: { branch?: string | null }): string
  export function owningRoot(id: string, nodesById: Map<string, any>): any
  export function isPageAvailable(registry: any, pluginId: string, pageId: string): boolean
  export function matchKeysFor(templateName: string, templatesByName: Map<string, any>): string[]

  /** The last segment of a node ID. */
  export function getDisplayName(nodeId: string): string
  /** A stable colour per node kind. */
  export function kindColour(kind: string): string
}
