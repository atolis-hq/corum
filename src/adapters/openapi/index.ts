import type { OpenAPIImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class OpenAPIAdapter implements SpecAdapter<OpenAPIImportEntry> {
  readonly adapterId = 'openapi' as const

  async import(entry: OpenAPIImportEntry, context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = await parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }

    const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry, context.packConfig)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics] }
  }
}
