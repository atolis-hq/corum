/**
 * Node ID grammar — defined once, enforced in the loader and adapters.
 *
 * IDs are dot-separated segments encoding the ownership hierarchy:
 *   {component}.{Template}.{name}(.{section}.{localName})*
 *
 * Reserved:
 * - `.` separates segments (never appears inside one).
 * - `__` separates edge ID parts ({from}__{type}__{to}), so it must never
 *   appear inside a node ID segment.
 *
 * Segments are non-empty runs of ASCII letters, digits, `_`, and `-`
 * (`__` remains reserved — see the explicit check). Leading `_` marks
 * generated quarantine components such as `_unresolved`.
 */
export const ID_SEGMENT_RE = /^[A-Za-z0-9_-]+$/

/** Minimum segments for a cluster root: component.Template.name */
export const MIN_ROOT_SEGMENTS = 3

/** Returns an error message, or null when the id is well-formed. */
export function validateNodeId(id: string): string | null {
  const segments = id.split('.')
  for (const segment of segments) {
    if (segment === '') {
      return `invalid node id '${id}': empty segment ('.' is the hierarchy separator)`
    }
    if (segment.includes('__')) {
      return `invalid node id '${id}': '__' is reserved for edge ids`
    }
    if (!ID_SEGMENT_RE.test(segment)) {
      return `invalid node id '${id}': segment '${segment}' must match ${ID_SEGMENT_RE}`
    }
  }
  return null
}

/** Returns an error message, or null when the id is a well-formed cluster root id. */
export function validateRootId(id: string): string | null {
  const base = validateNodeId(id)
  if (base) return base
  if (id.split('.').length < MIN_ROOT_SEGMENTS) {
    return `invalid cluster root id '${id}': expected at least ${MIN_ROOT_SEGMENTS} segments (component.Template.name)`
  }
  return null
}

/** Returns an error message, or null when the value is a valid single segment. */
export function validateSegment(segment: string): string | null {
  if (segment === '') return `invalid id segment: empty`
  if (segment.includes('__')) return `invalid id segment '${segment}': '__' is reserved for edge ids`
  if (!ID_SEGMENT_RE.test(segment)) {
    return `invalid id segment '${segment}': must match ${ID_SEGMENT_RE}`
  }
  return null
}

/**
 * Make an externally-sourced name (operationId, message name, schema name…)
 * safe to use as a single ID segment. Deterministic: reserved characters
 * become `-`, runs are collapsed, and leading/trailing `-` are trimmed.
 */
export function sanitizeIdSegment(name: string): string {
  const cleaned = name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/_{2,}/g, '_')
    .replace(/-{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
  return cleaned === '' ? 'unnamed' : cleaned
}
