import SwaggerParser from '@apidevtools/swagger-parser'
import type { OpenAPIV3 } from 'openapi-types'
import type { Diagnostic } from '../../schema/index.js'

export interface ParseResult {
  document: OpenAPIV3.Document | null
  diagnostics: Diagnostic[]
}

export async function parseSpec(specPath: string): Promise<ParseResult> {
  const diagnostics: Diagnostic[] = []
  try {
    const document = await SwaggerParser.bundle(specPath) as OpenAPIV3.Document
    return { document, diagnostics }
  } catch (err) {
    diagnostics.push({
      severity: 'error',
      file: specPath,
      message: `Failed to parse OpenAPI spec: ${err instanceof Error ? err.message : String(err)}`,
    })
    return { document: null, diagnostics }
  }
}
