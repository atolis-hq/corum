import path from 'node:path'

/**
 * Stable provenance key for an import entry's spec: the path as written in the
 * config, with forward slashes, no leading `./` and no redundant separators.
 * Depends only on the config string, never on the working directory.
 */
export function specKey(spec: string): string {
  const normalized = path.posix.normalize(spec.replace(/\\/g, '/'))
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized
}
