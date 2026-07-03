import fs from 'node:fs'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { parse as parseYaml } from 'yaml'
import type { CommitOptions, ContentMap, GraphSource } from './index.js'
import { SourceError } from './index.js'
import { GitCacheManager } from './git-cache.js'

export interface BranchLoadOptions {
  maxBranches?: number
  staleDaysThreshold?: number
}

export interface GitGraphSourceOptions {
  graphDir?: string
  localPath?: string
  remoteUrl?: string
  defaultBranch?: string
  auth?: { username: string; token: string }
  branchLoad?: BranchLoadOptions
}

const DEFAULT_GRAPH_DIR = '.corum/graph'

// Module-level so two GitGraphSource instances in one process still serialise.
const commitLocks = new Map<string, Promise<void>>()

export class GitGraphSource implements GraphSource {
  private readonly graphDir: string
  private readonly localPath: string | undefined
  private readonly remoteUrl: string | undefined
  private readonly defaultBranchOverride: string | undefined
  private readonly auth: { username: string; token: string } | undefined
  private readonly branchLoad: BranchLoadOptions
  private readonly cacheManager: GitCacheManager
  private cachedDir: string | undefined

  constructor(options: GitGraphSourceOptions) {
    if (!options.localPath && !options.remoteUrl) {
      throw new SourceError('GitGraphSource requires either localPath or remoteUrl')
    }
    if (options.localPath && options.remoteUrl) {
      throw new SourceError('GitGraphSource requires either localPath or remoteUrl, not both')
    }
    this.graphDir = normalizeRepoPath('', options.graphDir ?? DEFAULT_GRAPH_DIR)
    this.localPath = options.localPath
    this.remoteUrl = options.remoteUrl
    this.defaultBranchOverride = options.defaultBranch
    this.auth = options.auth
    this.branchLoad = options.branchLoad ?? {}
    this.cacheManager = new GitCacheManager()
  }

  private onAuth(): (() => { username: string; password: string }) | undefined {
    if (!this.auth) return undefined
    return () => ({ username: this.auth!.username, password: this.auth!.token })
  }

  private async dir(): Promise<string> {
    if (this.localPath) return this.localPath
    this.cachedDir = await this.cacheManager.ensureCloned(this.remoteUrl!, this.onAuth())
    return this.cachedDir
  }

  async defaultBranch(): Promise<string> {
    if (this.defaultBranchOverride) return this.defaultBranchOverride
    try {
      const dir = await this.dir()
      if (this.remoteUrl) {
        const branches = await git.listBranches({ fs, dir, remote: 'origin' })
        if (branches.includes('main')) return 'main'
        if (branches.includes('master')) return 'master'
        if (branches.length > 0) return branches[0]
      }
      const branch = await git.currentBranch({ fs, dir })
      if (branch) return branch
    } catch {
      // Fall back below.
    }
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    const dir = await this.dir()
    let branches: string[]
    try {
      branches = this.remoteUrl
        ? await git.listBranches({ fs, dir, remote: 'origin' })
        : await git.listBranches({ fs, dir })
    } catch (err) {
      throw new SourceError('failed to list branches', err)
    }

    const defaultBranch = await this.defaultBranch()
    const { staleDaysThreshold, maxBranches } = this.branchLoad

    if (staleDaysThreshold !== undefined) {
      const cutoff = Date.now() - staleDaysThreshold * 24 * 60 * 60 * 1000
      const fresh: string[] = []
      for (const branch of branches) {
        if (branch === defaultBranch) {
          fresh.push(branch)
          continue
        }
        try {
          const sha = await this.resolveBranchOid(branch)
          const { commit } = await git.readCommit({ fs, dir, oid: sha })
          if (commit.author.timestamp * 1000 >= cutoff) fresh.push(branch)
        } catch {
          // Skip unreadable branches.
        }
      }
      branches = fresh
    }

    if (maxBranches !== undefined && branches.length > maxBranches) {
      const withDates: Array<{ branch: string; timestamp: number }> = []
      for (const branch of branches) {
        try {
          const sha = await this.resolveBranchOid(branch)
          const { commit } = await git.readCommit({ fs, dir, oid: sha })
          withDates.push({ branch, timestamp: commit.author.timestamp })
        } catch {
          withDates.push({ branch, timestamp: 0 })
        }
      }
      withDates.sort((a, b) => b.timestamp - a.timestamp)
      branches = [
        defaultBranch,
        ...withDates.filter(item => item.branch !== defaultBranch).slice(0, maxBranches - 1).map(item => item.branch),
      ]
    }

    return branches
  }

  async loadPackContent(_ref: string): Promise<ContentMap> {
    const defaultRef = await this.defaultBranch()
    const dir = await this.dir()
    const map: ContentMap = new Map()
    const commitSha = await this.resolveBranchOid(defaultRef)
    const graphYamlRepoPath = `${this.graphDir}/graph.yaml`

    let graphYamlContent: string
    try {
      const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: graphYamlRepoPath })
      graphYamlContent = Buffer.from(blob).toString('utf-8')
    } catch {
      return map
    }

    const doc = parseYaml(graphYamlContent) as Record<string, unknown>
    const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
    const allFiles = await git.listFiles({ fs, dir, ref: commitSha })

    for (const pack of packs) {
      if (typeof (pack as Record<string, unknown>).path !== 'string') continue
      const packPath = (pack as { path: string }).path
      const absPackPath = normalizeRepoPath(this.graphDir, packPath)
      const packName = absPackPath.split('/').pop() ?? packPath
      const packPrefix = absPackPath.endsWith('/') ? absPackPath : `${absPackPath}/`

      for (const filePath of allFiles.filter(file => file.startsWith(packPrefix) && file.endsWith('.yaml'))) {
        try {
          const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: filePath })
          const relKey = filePath.slice(packPrefix.length)
          map.set(`${packName}/${relKey}`, Buffer.from(blob).toString('utf-8'))
        } catch {
          // Skip blobs that cannot be read — corrupt object store or pack not yet fetched.
        }
      }
    }

    return map
  }

  async loadGraphContent(ref: string): Promise<ContentMap> {
    const dir = await this.dir()
    const map: ContentMap = new Map()
    const commitSha = await this.resolveBranchOid(ref)
    const prefix = this.graphDir.endsWith('/') ? this.graphDir : `${this.graphDir}/`
    const allFiles = await git.listFiles({ fs, dir, ref: commitSha })

    for (const filePath of allFiles.filter(file => file.startsWith(prefix) && file.endsWith('.yaml'))) {
      try {
        const { blob } = await git.readBlob({ fs, dir, oid: commitSha, filepath: filePath })
        map.set(filePath.slice(prefix.length), Buffer.from(blob).toString('utf-8'))
      } catch {
        // Skip blobs that cannot be read — corrupt object store or ref not yet fetched.
      }
    }

    return map
  }

  async commit(branch: string, changes: ContentMap, message: string, options: CommitOptions = {}): Promise<void> {
    const dir = await this.dir()

    if (this.localPath) {
      let checkedOut: string | undefined
      try {
        checkedOut = (await git.currentBranch({ fs, dir })) ?? undefined
      } catch {
        checkedOut = undefined
      }
      if (checkedOut === branch) {
        throw new SourceError(
          `cannot commit to branch '${branch}' - it is checked out in ${dir}; ` +
          `moving the ref would silently diverge the working tree. Switch to another branch first.`,
        )
      }
    }

    const defaultBranch = await this.defaultBranch()
    if (branch === defaultBranch) {
      throw new SourceError(`cannot commit to default branch '${branch}' - it is read-only`)
    }

    // Serialise in-process writers per repo+branch so concurrent commits stack
    // instead of racing; the CAS check in commitLocked covers external writers.
    const lockKey = `${dir}|${branch}`
    const previous = commitLocks.get(lockKey) ?? Promise.resolve()
    const run = previous
      .catch(() => {})
      .then(() => this.commitLocked(dir, branch, defaultBranch, changes, message, options))
    commitLocks.set(lockKey, run.then(() => {}, () => {}))
    return run
  }

  private async commitLocked(
    dir: string,
    branch: string,
    defaultBranch: string,
    changes: ContentMap,
    message: string,
    options: CommitOptions,
  ): Promise<void> {
    const prefix = this.graphDir.endsWith('/') ? this.graphDir : `${this.graphDir}/`
    const MAX_ATTEMPTS = 3

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let parentSha: string
      let branchExisted = true
      try {
        parentSha = await this.resolveBranchOid(branch)
      } catch (err) {
        if (!options.createBranchIfMissing) {
          throw new SourceError(`cannot resolve branch '${branch}'`, err)
        }
        branchExisted = false
        try {
          parentSha = await this.resolveBranchOid(defaultBranch)
        } catch (err2) {
          throw new SourceError(`cannot resolve default branch '${defaultBranch}' to create '${branch}'`, err2)
        }
      }
      const { commit: parentCommit } = await git.readCommit({ fs, dir, oid: parentSha })

      const blobMap = new Map<string, string>()
      for (const [key, content] of changes) {
        const repoPath = `${prefix}${normalizeContentKey(key)}`
        const oid = await git.writeBlob({ fs, dir, blob: Buffer.from(content, 'utf-8') })
        blobMap.set(repoPath, oid)
      }

      const newTreeOid = options.replaceGraphContent
        ? await buildReplacedGraphTree(fs, dir, parentCommit.tree, prefix, blobMap)
        : await buildUpdatedTree(fs, dir, parentCommit.tree, blobMap)

      const now = Math.floor(Date.now() / 1000)
      const newCommitOid = await git.writeCommit({
        fs,
        dir,
        commit: {
          tree: newTreeOid,
          parent: [parentSha],
          message,
          author: { name: 'corum', email: 'corum@localhost', timestamp: now, timezoneOffset: 0 },
          committer: { name: 'corum', email: 'corum@localhost', timestamp: now, timezoneOffset: 0 },
        },
      })

      // Compare-and-swap: if the ref moved while we built the commit, rebuild
      // on the new parent instead of silently discarding the other write.
      let currentSha: string | undefined
      try {
        currentSha = await this.resolveBranchOid(branch)
      } catch {
        currentSha = undefined
      }
      if (branchExisted ? currentSha !== parentSha : currentSha !== undefined) continue

      await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: newCommitOid, force: true })

      if (this.remoteUrl) {
        try {
          await git.push({
            fs,
            http: (await import('isomorphic-git/http/node')).default,
            dir,
            remote: 'origin',
            ref: branch,
            onAuth: this.onAuth(),
          })
        } catch (err) {
          // Roll the local ref back so the cached clone does not diverge from
          // origin; otherwise the committed data becomes invisible on next read.
          if (branchExisted) {
            await git.writeRef({ fs, dir, ref: `refs/heads/${branch}`, value: parentSha, force: true })
          } else {
            await git.deleteRef({ fs, dir, ref: `refs/heads/${branch}` }).catch(() => {})
          }
          throw new SourceError(`failed to push branch '${branch}'`, err)
        }
      }
      return
    }

    throw new SourceError(`concurrent updates to branch '${branch}' - retries exhausted`)
  }

  async reloadSignature(): Promise<string> {
    const dir = await this.dir()
    const branches = await this.listBranches()
    const refs: string[] = []

    for (const branch of [...branches].sort((a, b) => a.localeCompare(b))) {
      try {
        refs.push(`${branch}:${await this.resolveBranchOid(branch)}`)
      } catch {
        refs.push(`${branch}:unresolved`)
      }
    }

    return refs.join('|')
  }

  private async resolveBranchOid(branch: string): Promise<string> {
    const dir = await this.dir()
    if (this.remoteUrl) {
      try {
        return await git.resolveRef({ fs, dir, ref: `refs/remotes/origin/${branch}` })
      } catch {
        // Newly-created branch may only exist locally before push.
      }
    }
    return git.resolveRef({ fs, dir, ref: branch })
  }
}

async function buildReplacedGraphTree(
  fsImpl: typeof fs,
  dir: string,
  rootTreeOid: string,
  graphPrefix: string,
  blobMap: Map<string, string>,
): Promise<string> {
  const graphDir = graphPrefix.replace(/\/$/, '')
  const prunedRoot = await removeTreePath(fsImpl, dir, rootTreeOid, graphDir.split('/'))
  return buildUpdatedTree(fsImpl, dir, prunedRoot, blobMap)
}

async function removeTreePath(
  fsImpl: typeof fs,
  dir: string,
  treeOid: string,
  parts: string[],
): Promise<string> {
  const { tree } = await git.readTree({ fs: fsImpl, dir, oid: treeOid })
  const [head, ...tail] = parts
  if (!head) return treeOid

  if (tail.length === 0) {
    return git.writeTree({ fs: fsImpl, dir, tree: tree.filter(entry => entry.path !== head) })
  }

  const entries = [...tree]
  const idx = entries.findIndex(entry => entry.path === head && entry.type === 'tree')
  if (idx < 0) return treeOid

  const nextOid = await removeTreePath(fsImpl, dir, entries[idx].oid, tail)
  entries[idx] = { ...entries[idx], oid: nextOid }
  return git.writeTree({ fs: fsImpl, dir, tree: entries })
}

async function buildUpdatedTree(
  fsImpl: typeof fs,
  dir: string,
  rootTreeOid: string,
  blobMap: Map<string, string>,
): Promise<string> {
  // TODO: rebuildTree iterates the full blobMap at every tree level — O(blobs × depth).
  // For Stage 1 this is acceptable (graph repos are small). A future optimisation is to
  // pre-bucket blobMap entries by their top-level path segment before recursing, reducing
  // work to O(blobs) total. The current approach is correct but redundant at deeper levels.
  async function rebuildTree(treeOid: string, prefix: string): Promise<string> {
    const { tree } = await git.readTree({ fs: fsImpl, dir, oid: treeOid })
    const entries = [...tree]

    for (const [repoPath, blobOid] of blobMap) {
      if (!repoPath.startsWith(prefix)) continue
      const remainder = repoPath.slice(prefix.length)
      const parts = remainder.split('/')
      if (parts.length === 1) {
        const fileName = parts[0]
        const entry = { mode: '100644' as const, path: fileName, oid: blobOid, type: 'blob' as const }
        const existing = entries.findIndex(item => item.path === fileName)
        if (existing >= 0) entries[existing] = entry
        else entries.push(entry)
      } else {
        const subdir = parts[0]
        const existing = entries.find(item => item.path === subdir && item.type === 'tree')
        const subTreeOid = existing?.oid ?? await git.writeTree({ fs: fsImpl, dir, tree: [] })
        const newSubTreeOid = await rebuildTree(subTreeOid, `${prefix}${subdir}/`)
        const entry = { mode: '040000' as const, path: subdir, oid: newSubTreeOid, type: 'tree' as const }
        const idx = entries.findIndex(item => item.path === subdir)
        if (idx >= 0) entries[idx] = entry
        else entries.push(entry)
      }
    }

    entries.sort((a, b) => a.path.localeCompare(b.path))
    return git.writeTree({ fs: fsImpl, dir, tree: entries })
  }

  return rebuildTree(rootTreeOid, '')
}

function normalizeRepoPath(baseDir: string, value: string): string {
  const posixValue = value.replace(/\\/g, '/')
  const normalized = posixValue.startsWith('/')
    ? path.posix.normalize(posixValue.slice(1))
    : path.posix.normalize(baseDir ? path.posix.join(baseDir, posixValue) : posixValue)
  if (normalized === '..' || normalized.startsWith('../')) {
    throw new SourceError(`path escapes repository root: ${value}`)
  }
  return normalized
}

function normalizeContentKey(key: string): string {
  if (key.includes('\\') || key.includes('\0') || path.posix.isAbsolute(key) || /^[a-zA-Z]:/.test(key)) {
    throw new SourceError(`invalid ContentMap key: ${key}`)
  }
  const normalized = path.posix.normalize(key)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new SourceError(`invalid ContentMap key: ${key}`)
  }
  return normalized
}
