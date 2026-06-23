import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Parser } from '@asyncapi/parser'
import type { AsyncAPIDocumentInterface } from '@asyncapi/parser'
import type { Diagnostic } from '../../schema/index.js'

export interface ParseResult {
  document: AsyncAPIDocumentInterface | null
  diagnostics: Diagnostic[]
}

const parser = new Parser()

export async function parseSpec(specPath: string): Promise<ParseResult> {
  const diagnostics: Diagnostic[] = []
  try {
    const content = readFileSync(specPath, 'utf-8')
    const source = `file://${path.resolve(specPath)}`
    const result = await parser.parse(content, { source })

    for (const d of result.diagnostics) {
      if (d.severity === 0) {
        diagnostics.push({ severity: 'error', file: specPath, message: d.message })
      } else if (d.severity === 1) {
        diagnostics.push({ severity: 'warning', file: specPath, message: d.message })
      }
    }

    if (!result.document) {
      if (!diagnostics.some(d => d.severity === 'error')) {
        diagnostics.push({ severity: 'error', file: specPath, message: 'AsyncAPI parser returned no document' })
      }
      return { document: null, diagnostics }
    }

    return { document: result.document, diagnostics }
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to parse AsyncAPI spec: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }
}
