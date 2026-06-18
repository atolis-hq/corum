import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export type CorumConfig = {
  source?: string
  graph?: string
  git_local_path?: string
  git_remote_url?: string
  git_branch?: string
  git_poll_seconds?: number
  git_token?: string
  git_username?: string
}

export function loadProjectConfig(cwd: string): CorumConfig {
  const configPath = findConfigFile(cwd)
  if (!configPath) return {}
  const content = readFileSync(configPath, 'utf8')
  return (parseYaml(content) as CorumConfig | null) ?? {}
}

function findConfigFile(cwd: string): string | undefined {
  let dir = cwd
  while (true) {
    const candidate = path.join(dir, '.corum', 'config.yaml')
    if (existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}
