import path from 'node:path'
import { FileGraphSource } from './file-source.js'
import { GitGraphSource } from './git-source.js'
import type { GraphSource } from './index.js'
import { SourceError } from './index.js'
import { loadProjectConfig } from './config-file.js'

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
  const fileConfig = loadProjectConfig(cwd)
  const e: Env = {
    ...env,
    CORUM_SOURCE: env.CORUM_SOURCE ?? fileConfig.source,
    CORUM_GRAPH_PATH: env.CORUM_GRAPH_PATH ?? fileConfig.graph,
    CORUM_GIT_LOCAL_PATH: env.CORUM_GIT_LOCAL_PATH ?? fileConfig.git_local_path,
    CORUM_GIT_REMOTE_URL: env.CORUM_GIT_REMOTE_URL ?? fileConfig.git_remote_url,
    CORUM_GIT_BRANCH: env.CORUM_GIT_BRANCH ?? fileConfig.git_branch,
    CORUM_GIT_POLL_SECONDS: env.CORUM_GIT_POLL_SECONDS ?? (fileConfig.git_poll_seconds !== undefined ? String(fileConfig.git_poll_seconds) : undefined),
    CORUM_GIT_TOKEN: env.CORUM_GIT_TOKEN ?? fileConfig.git_token,
    CORUM_GIT_USERNAME: env.CORUM_GIT_USERNAME ?? fileConfig.git_username,
  }

  const sourceKind = (e.CORUM_SOURCE ?? 'filesystem').toLowerCase()
  if (sourceKind === 'filesystem' || sourceKind === 'file' || sourceKind === 'fs') {
    const graphPath = e.CORUM_GRAPH_PATH ?? path.join(cwd, '.corum/graph')
    return {
      kind: 'filesystem',
      source: new FileGraphSource({ graphDir: graphPath }),
      graphPath,
      fileWatcherGraphPath: graphPath,
    }
  }

  if (sourceKind !== 'git') {
    throw new SourceError(`unsupported CORUM_SOURCE: ${e.CORUM_SOURCE}`)
  }

  const localPath = emptyToUndefined(e.CORUM_GIT_LOCAL_PATH)
  const remoteUrl = emptyToUndefined(e.CORUM_GIT_REMOTE_URL)
  if (!localPath && !remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }
  if (localPath && remoteUrl) {
    throw new SourceError('CORUM_SOURCE=git requires only one of CORUM_GIT_LOCAL_PATH or CORUM_GIT_REMOTE_URL')
  }

  const graphDir = '.corum/graph'
  const token = emptyToUndefined(e.CORUM_GIT_TOKEN)
  const auth = token
    ? { username: e.CORUM_GIT_USERNAME ?? 'x-access-token', token }
    : undefined
  const repoLabel = localPath ?? remoteUrl!
  const gitPollSeconds = parseOptionalSeconds(e.CORUM_GIT_POLL_SECONDS)

  return {
    kind: 'git',
    source: new GitGraphSource({
      localPath,
      remoteUrl,
      graphDir,
      defaultBranch: emptyToUndefined(e.CORUM_GIT_BRANCH),
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
