import type { Diagnostic } from '../../schema/index.js'

export function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const value of a) if (!b.has(value)) return false
  return true
}

/**
 * ADR-009b rule 2: when an adapter reuses an existing standalone schema
 * instead of inlining a duplicate, warn if the incoming field set differs
 * from the existing node's — this is the signal for cross-source contract
 * drift that reuse-before-inline would otherwise merge silently.
 */
export function shapeDriftDiagnostic(
  schemaName: string,
  standaloneId: string,
  incomingFields: Set<string>,
  existingFields: Set<string>,
  specPath: string,
): Diagnostic | undefined {
  if (setsEqual(incomingFields, existingFields)) return undefined
  return {
    severity: 'warning',
    file: specPath,
    message: `Schema "${schemaName}" reused from existing standalone schema ${standaloneId}, but its field set differs (shape drift): incoming [${[...incomingFields].sort().join(', ')}] vs existing [${[...existingFields].sort().join(', ')}]`,
  }
}
