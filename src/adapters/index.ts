import type { Diagnostic, Edge, Node, Template } from '../schema/index.js'
import type { ImportEntry, ComponentNameReplacement } from '../import/config.js'

export interface AdapterPackConfig {
  adapter: string
  version: string
  constructs: Record<string, ConstructMapping>
  scalarTypes: Record<string, string>
}

export interface ConstructMapping {
  template: string
  section?: string
  properties?: Record<string, string>
}

export interface AdapterContext {
  packConfig: AdapterPackConfig
  templates: Map<string, Template>
  componentNameReplacements: ComponentNameReplacement[]
}

export interface AdapterResult {
  nodes: Node[]
  edges: Edge[]
  diagnostics: Diagnostic[]
}

export interface SpecAdapter<TEntry extends ImportEntry = ImportEntry> {
  readonly adapterId: TEntry['adapter']
  import(entry: TEntry, context: AdapterContext): Promise<AdapterResult>
}

const registry = new Map<string, SpecAdapter>()

export function registerAdapter(adapter: SpecAdapter): void {
  registry.set(adapter.adapterId, adapter)
}

export function getAdapter(adapterId: string): SpecAdapter {
  const adapter = registry.get(adapterId)
  if (!adapter) throw new Error(`Unknown adapter: ${adapterId}`)
  return adapter
}

import { OpenAPIAdapter } from './openapi/index.js'
registerAdapter(new OpenAPIAdapter())

import { AsyncAPIAdapter } from './asyncapi/index.js'
registerAdapter(new AsyncAPIAdapter())

import { CorumAdapter } from './corum/index.js'
registerAdapter(new CorumAdapter())
