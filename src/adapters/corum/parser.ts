import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic } from '../../schema/index.js'

const SUPPORTED_VERSION = '1.0'

export interface CorumInterchangeProvenance {
  derivation?: 'resolved' | 'inferred'
  confidence?: number
  by?: string
}

export interface CorumInterchangeNode {
  id: string
  template: string
  properties: Record<string, unknown>
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeEdge {
  from: string
  to: string
  type: string
  provenance?: CorumInterchangeProvenance
}

export interface CorumInterchangeGap {
  kind: string
  nodeId?: string
  reason?: string
}

export interface CorumInterchangeDocument {
  corumInterchange: string
  targets?: Array<{ pack: string; version: string }>
  source?: {
    analyser?: string
    version?: string
    language?: string
    repo?: string
  }
  nodes: CorumInterchangeNode[]
  edges?: CorumInterchangeEdge[]
  gaps?: CorumInterchangeGap[]
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
      message: 'Invalid corum interchange file: missing required "corumInterchange" key or "nodes" array',
    })
    return { document: null, diagnostics }
  }

  const doc = raw as CorumInterchangeDocument

  if (doc.corumInterchange !== SUPPORTED_VERSION) {
    diagnostics.push({
      severity: 'warning',
      file: specPath,
      message: `Unknown corumInterchange version "${doc.corumInterchange}" — expected "${SUPPORTED_VERSION}", continuing`,
    })
  }

  return { document: doc, diagnostics }
}

function isCorumInterchangeDocument(value: unknown): value is CorumInterchangeDocument {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.corumInterchange === 'string' && Array.isArray(v.nodes)
}
