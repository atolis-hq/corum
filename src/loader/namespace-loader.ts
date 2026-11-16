import { parse as parseYaml } from 'yaml'
import type { Diagnostic, Namespace, Node } from '../schema/index.js'
import type { ContentMap } from '../source/index.js'
import { isNamespaceDeclarationKey } from '../source/graph-layout.js'

/** Single registry construction point; pack-defined kinds can extend this next. */
export function loadKindRegistry(): Set<string> {
  return new Set(['component'])
}

export function loadNamespaces(
  content: ContentMap,
  nodes: Map<string, Node>,
  diagnostics: Diagnostic[],
): Map<string, Namespace> {
  const namespaces = new Map<string, Namespace>()
  const populated = new Set([...nodes.keys()].map(id => id.split('.')[0]))
  for (const name of populated) namespaces.set(name, { kind: 'component' })
  const kinds = loadKindRegistry()
  for (const [file, text] of content) {
    if (!isNamespaceDeclarationKey(file)) continue
    const name = file.split('/')[1]
    let raw: unknown
    try {
      raw = parseYaml(text)
    } catch (err) {
      diagnostics.push({ severity: 'error', file, message: `failed to parse namespace YAML: ${err}` })
      continue
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      diagnostics.push({ severity: 'error', file, message: 'namespace declaration must be an object' })
      continue
    }
    const record = raw as Record<string, unknown>
    if (Object.keys(record).some(key => key !== 'kind' && key !== 'description') ||
        typeof record.kind !== 'string' ||
        (record.description !== undefined && typeof record.description !== 'string')) {
      diagnostics.push({ severity: 'error', file, message: 'namespace declaration requires a string kind, optional string description, and no unknown keys' })
      continue
    }
    namespaces.set(name, {
      kind: record.kind,
      ...(typeof record.description === 'string' && { description: record.description }),
    })
    if (!populated.has(name)) {
      diagnostics.push({ severity: 'warning', file, message: 'namespace declaration contains no nodes' })
    }
    if (!kinds.has(record.kind)) {
      diagnostics.push({ severity: 'warning', file, message: `unrecognised kind, falling back to generic display: ${record.kind}` })
    }
  }
  return namespaces
}
