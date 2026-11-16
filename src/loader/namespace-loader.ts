import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Namespace, Node } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import { NODE_ROOT_DIR } from '../source/graph-paths.js'

/** Single registry construction point; packs can extend this in the next layer. */
export function loadKinds(): Map<string, { label: string }> {
  return new Map([['component', { label: 'Component' }]])
}

export function isNamespaceDeclaration(key: string): boolean {
  return new RegExp(`^${NODE_ROOT_DIR}/[^/]+/namespace\\.yaml$`).test(key)
}

export function loadNamespaces(
  content: ContentMap,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
): Map<string, Namespace> {
  const namespaces = new Map<string, Namespace>()
  for (const node of nodes.values()) {
    const name = node.id.split('.')[0]
    namespaces.set(name, { kind: 'component' })
  }
  const kinds = loadKinds()
  for (const [file, text] of content) {
    if (!isNamespaceDeclaration(file)) continue
    const name = file.split('/')[1]
    try {
      const doc: unknown = parseYaml(text)
      if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('expected a mapping')
      const record = doc as Record<string, unknown>
      if (Object.keys(record).some(key => key !== 'kind' && key !== 'description')) throw new Error('unknown declaration key')
      if (typeof record.kind !== 'string') throw new Error('kind must be a string')
      if (record.description !== undefined && typeof record.description !== 'string') throw new Error('description must be a string')
      if (!namespaces.has(name)) diagnostics.push({ severity: 'warning', file, message: 'namespace declaration contains no nodes' })
      namespaces.set(name, { kind: record.kind, ...(record.description !== undefined ? { description: record.description as string } : {}) })
      if (!kinds.has(record.kind)) diagnostics.push({ severity: 'warning', file, message: `unrecognised kind '${record.kind}', falling back to generic display` })
    } catch (err) {
      diagnostics.push({ severity: 'error', file, message: `invalid namespace declaration: ${err}` })
    }
  }
  return namespaces
}
