import path from 'node:path'
import { FileGraphSource } from './file-source.js'
import { GitGraphSource } from './git-source.js'
import type { GraphSource } from './index.js'
import { SourceError } from './index.js'

export type GraphRuntimeConfig = {
  kind: 'filesystem' | 'git'
  source: GraphSource
  graphPath: string
  fileWatcherGraphPath?: string
  gitPollSeconds?: number
}

type Env = Record<string, string | undefined>

export function createGraphRuntimeConfig(
  env: Env = process.env,
  cwd = process.cwd(),
): GraphRuntimeConfig {
  const sourceKind = (env.CORUM_SOURCE ?? 'filesystem').toLowerCase()
  if (sourceKind === 'filesystem' || sourceKind === 'file' || sourceKind === 'fs') {
    const graphPath = env.CORUM_GRAPH_PATH ?? path.join(cwd, '.corum/graph')
    return {
      kind: 'filesystem',
      source: new FileGraphSource({ graphDir: graphPath }),
      graphPath,
      fileWatcherGraphPath: graphPath,
    }
  }

  if (sourceKind !== 'git') {
    throw new SourceError(`unsupported CORUM_SOURCE: ${env.CORUM_SOURCE}`)
  }

  const localPath = emptyToUndefined(env.CORUM_GIT_LOCAL_PATH)
  const remoteUrl = emptyToUndefined(env.CORUM_GIT_REMOTE_URL)
  if (!localPath && !remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }
  if (localPath && remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires only one of CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }

  const graphDir = '.corum/graph'
  const token = emptyToUndefined(env.CORUM_GIT_TOKEN)
  const auth = token
    ? { username: env.CORUM_GIT_USERNAME ?? 'x-access-token', token }
    : undefined
  const repoLabel = localPath ?? remoteUrl!
  const gitPollSeconds = parseOptionalSeconds(env.CORUM_GIT_POLL_SECONDS)

  return {
    kind: 'git',
    source: new GitGraphSource({
      localPath,
      remoteUrl,
      graphDir,
      defaultBranch: emptyToUndefined(env.CORUM_GIT_BRANCH),
      auth,
    }),
    graphPath: `git:${repoLabel}/${graphDir.replace(/\\/g, '/')}`,
    gitPollSeconds,
  }
}

function emptyToUndefined(value: string | undefined): string | undefined {
  return value && value.trim() !== '' ? value : undefined
}

function parseOptionalSeconds(value: string | undefined): number | undefined {
  if (!value || value.trim() === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new SourceError('CORUM_GIT_POLL_SECONDS must be a positive number of seconds')
  }
  return parsed
}
