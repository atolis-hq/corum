import type { ContentMap } from './index.js'

export function listYamlKeys(content: ContentMap, prefix: string): string[] {
  const normalised = prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix
  return [...content.keys()].filter(
    key => key.endsWith('.yaml') && (normalised === '' || key.startsWith(normalised)),
  )
}

export function readYaml(content: ContentMap, key: string): string {
  const value = content.get(key)
  if (value === undefined) throw new Error(`${key} not found in ContentMap`)
  return value
}

export function hasKey(content: ContentMap, key: string): boolean {
  return content.has(key)
}
