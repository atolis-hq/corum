import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic } from '../../schema/index.js'

const SUPPORTED_VERSION = '1.0'

export interface CorumInterchangeProvenance {
  derivation?: 'determined' | 'inferred'
  derivedBy?: string
  extractedFrom?: string
}

export interface CorumInterchangeNodeEntry {
  type: string
  title?: string
  schema?: { $ref: string }
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeEdge {
  type: string
  from: string
  to: string
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeDocument {
  corum: string
  info?: {
    title?: string
    version?: string
    source?: { analyser?: string; language?: string }
    packs?: Array<{ name: string; version: string }>
  }
  nodes: Record<string, CorumInterchangeNodeEntry>
  components?: {
    schemas?: Record<string, unknown>
  }
  edges?: CorumInterchangeEdge[]
  gaps?: Array<{ kind: string; nodeId?: string; reason?: string; file?: string }>
}

export interface ParseResult {
  document: CorumInterchangeDocument | null
  diagnostics: Diagnostic[]
}

export function parseSpec(specPath: string): ParseResult {
  const diagnostics: Diagnostic[] = []
  let raw: unknown

  try {
    raw = parseYaml(readFileSync(specPath, 'utf-8'))
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to read or parse file: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }

  if (!isCorumInterchangeDocument(raw)) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: 'Invalid corum interchange file: missing required "corum" key or "nodes" object',
    })
    return { document: null, diagnostics }
  }

  const doc = raw as CorumInterchangeDocument

  if (doc.corum !== SUPPORTED_VERSION) {
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      message: `Unknown corum version "${doc.corum}" — expected "${SUPPORTED_VERSION}", continuing`,
    })
  }

  return { document: doc, diagnostics }
}

function isCorumInterchangeDocument(value: unknown): value is CorumInterchangeDocument {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.corum === 'string' &&
    typeof v.nodes === 'object' &&
    v.nodes !== null &&
    !Array.isArray(v.nodes)
  )
}
