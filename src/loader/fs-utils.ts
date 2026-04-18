import { readdirSync } from 'node:fs'
import path from 'node:path'

export function walkYamlFiles(dir: string): string[] {
  const result: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      result.push(...walkYamlFiles(fullPath))
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      result.push(fullPath)
    }
  }
  return result
}

export function isPackRef(value: unknown): value is { path: string } {
  return typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).path === 'string'
}
