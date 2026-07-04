import type { Diagnostic } from '../schema/index.js'

/**
 * Thrown when a mutation fails validation. Mirrors QueryError but carries the
 * linter-style diagnostics so agents can self-correct. A MutationError is
 * always thrown *before* the first write — the graph is never half-mutated.
 */
export class MutationError extends Error {
  constructor(public readonly diagnostics: Diagnostic[]) {
    const errorCount = diagnostics.filter(d => d.severity === 'error').length
    super(`Mutation failed with ${errorCount} error(s): ${diagnostics.filter(d => d.severity === 'error').map(d => d.message).join('; ')}`)
    this.name = 'MutationError'
  }
}
