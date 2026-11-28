import type { AsyncAPIImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class AsyncAPIAdapter implements SpecAdapter<AsyncAPIImportEntry> {
  readonly adapterId = 'asyncapi' as const

  async import(entry: AsyncAPIImportEntry, context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = await parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }

    const { nodes, edges, diagnostics: mapDiagnostics, sourceIds } = mapDocument(document, entry, context.packConfig, context.componentNameReplacements, context.existingSchemas, context.ownedSchemaIds)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics], sourceIds }
  }
}
