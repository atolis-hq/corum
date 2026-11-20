import { realpathSync, statSync } from 'node:fs'
import path from 'node:path'

export type PluginAsset = { file: string; contentType: string; etag: string }

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
}

/**
 * Resolve a request path inside a plugin directory to a servable file.
 * Returns null for traversal, symlink escape, disallowed extension (YAML is
 * never served) or anything that is not a regular file.
 */
export function resolvePluginAsset(pluginDir: string, requestPath: string): PluginAsset | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(requestPath)
  } catch {
    return null
  }
  if (decoded === '' || decoded.includes('\0') || decoded.includes('\\')) return null
  if (decoded.startsWith('/')) return null
  const segments = decoded.split('/')
  if (segments.some(segment => segment === '..' || segment === '')) return null

  const contentType = CONTENT_TYPES[path.extname(decoded).toLowerCase()]
  if (!contentType) return null

  try {
    const root = realpathSync(pluginDir)
    const file = realpathSync(path.join(root, ...segments))
    const relative = path.relative(root, file)
    if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return null
    }
    // The resolved file must still carry an allowed extension (a symlink could point at YAML).
    if (!CONTENT_TYPES[path.extname(file).toLowerCase()]) return null
    const stat = statSync(file)
    if (!stat.isFile()) return null
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    return { file, contentType, etag }
  } catch {
    return null
  }
}

/** RFC 9110 weak comparison of an If-None-Match header against the current entity tag. */
export function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (typeof header !== 'string') return false
  const strip = (tag: string) => tag.trim().replace(/^W\//, '')
  return header.split(',').some(tag => {
    const trimmed = tag.trim()
    return trimmed === '*' || strip(trimmed) === strip(etag)
  })
}
