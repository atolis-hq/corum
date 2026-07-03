import path from 'node:path'
import { SourceError } from './index.js'

/**
 * Resolve a relative content key against a base directory, rejecting any key
 * that is absolute, contains backslashes or NUL bytes, or escapes the base
 * directory via `..` segments.
 */
export function resolveContentPath(baseDir: string, key: string): string {
  if (
    key.includes('\\') ||
    key.includes('\0') ||
    path.posix.isAbsolute(key) ||
    path.win32.isAbsolute(key)
  ) {
    throw new SourceError(`invalid ContentMap key: ${key}`)
  }

  const normalised = path.posix.normalize(key)
  if (normalised === '..' || normalised.startsWith('../') || normalised === '.') {
    throw new SourceError(`invalid ContentMap key: ${key}`)
  }

  const resolvedBase = path.resolve(baseDir)
  const resolvedPath = path.resolve(resolvedBase, ...normalised.split('/'))
  const relative = path.relative(resolvedBase, resolvedPath)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new SourceError(`ContentMap key escapes graphDir: ${key}`)
  }
  return resolvedPath
}
