import type { CorumImportEntry } from '../../import/config.js'
import type { AdapterContext, AdapterResult, SpecAdapter } from '../index.js'
import { parseSpec } from './parser.js'
import { mapDocument } from './mapper.js'

export class CorumAdapter implements SpecAdapter<CorumImportEntry> {
  readonly adapterId = 'corum' as const

  async import(entry: CorumImportEntry, _context: AdapterContext): Promise<AdapterResult> {
    const { document, diagnostics } = parseSpec(entry.spec)
    if (!document) return { nodes: [], edges: [], diagnostics }

    const { nodes, edges, diagnostics: mapDiagnostics } = mapDocument(document, entry.spec)
    return { nodes, edges, diagnostics: [...diagnostics, ...mapDiagnostics] }
  }
}
