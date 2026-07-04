import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { parse as parseYaml } from 'yaml'
import { isPackRef } from '../loader/fs-utils.js'
import type { CommitOptions, ContentMap, GraphSource } from './index.js'
import { SourceError } from './index.js'
import { resolveContentPath } from './safe-path.js'

export interface FileGraphSourceOptions {
  graphDir?: string
  defaultBranch?: string
  packsPath?: string
}

const DEFAULT_GRAPH_DIR = '.corum/graph'
const DEFAULT_PACKS_PATH = '.corum/packs'

export class FileGraphSource implements GraphSource {
  private readonly graphDir: string
  private readonly defaultBranchOverride?: string
  private readonly packsPath?: string

  constructor(options: FileGraphSourceOptions = {}) {
    this.graphDir = options.graphDir ?? DEFAULT_GRAPH_DIR
    this.defaultBranchOverride = options.defaultBranch
    this.packsPath = options.packsPath
  }

  async defaultBranch(): Promise<string> {
    if (this.defaultBranchOverride) return this.defaultBranchOverride
    try {
      const repoRoot = await git.findRoot({ fs, filepath: this.graphDir })
      const branch = await git.currentBranch({ fs, dir: repoRoot })
      if (branch) return branch
    } catch {
      // Not a git repo, or detached HEAD.
    }
    return 'main'
  }

  async listBranches(): Promise<string[]> {
    return [await this.defaultBranch()]
  }

  async loadPackContent(_ref: string): Promise<ContentMap> {
    const map: ContentMap = new Map()
    const graphYamlPath = path.join(this.graphDir, 'graph.yaml')
    if (!existsSync(graphYamlPath)) {
      const packDir = path.resolve(this.graphDir, this.packsPath ?? DEFAULT_PACKS_PATH)
      readPackTemplatesIntoMap(packDir, map)
      return map
    }

    const doc = parseYaml(readFileSync(graphYamlPath, 'utf-8')) as Record<string, unknown>
    const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []

    for (const pack of packs) {
      if (!isPackRef(pack)) continue
      const packDir = path.resolve(this.graphDir, pack.path)
      readPackTemplatesIntoMap(packDir, map)
    }

    return map
  }

  async loadGraphContent(_ref: string): Promise<ContentMap> {
    const map: ContentMap = new Map()
    if (!existsSync(this.graphDir)) return map
    const excludeDirs = new Set(this.resolvePackDirs().map(d => path.resolve(d)))
    walkYamlFilesIntoMap(this.graphDir, this.graphDir, map, excludeDirs)
    return map
  }

  private resolvePackDirs(): string[] {
    const graphYamlPath = path.join(this.graphDir, 'graph.yaml')
    if (!existsSync(graphYamlPath)) {
      return [path.resolve(this.graphDir, this.packsPath ?? DEFAULT_PACKS_PATH)]
    }
    try {
      const doc = parseYaml(readFileSync(graphYamlPath, 'utf-8')) as Record<string, unknown>
      const packs = Array.isArray(doc.templatePacks) ? doc.templatePacks : []
      return packs.filter(isPackRef).map(p => path.resolve(this.graphDir, p.path))
    } catch {
      return []
    }
  }

  /**
   * Content hash of the graph directory's YAML files — a head marker for the
   * moved-head check (design §10/§14e). Not a commit SHA: file sources keep
   * no history.
   */
  async head(branch: string): Promise<string> {
    const content = await this.loadGraphContent(branch)
    const hash = createHash('sha256')
    for (const key of [...content.keys()].sort((a, b) => a.localeCompare(b))) {
      hash.update(key)
      hash.update('\0')
      hash.update(content.get(key)!)
      hash.update('\0')
    }
    return hash.digest('hex')
  }

  /** File sources keep no history: `[head]` when the content moved since `sinceSha`, else `[]`. */
  async log(branch: string, sinceSha: string): Promise<string[]> {
    const current = await this.head(branch)
    return current === sinceSha ? [] : [current]
  }

  async commit(branch: string, changes: ContentMap, message: string, options: CommitOptions = {}): Promise<void> {
    const defaultBranch = await this.defaultBranch()
    if (branch !== defaultBranch) {
      throw new SourceError(`FileGraphSource only supports its local branch '${defaultBranch}', got '${branch}'`)
    }

    if (options.replaceGraphContent) {
      this.replaceGraphContent(changes)
    } else {
      writeContentMap(this.graphDir, changes)
    }

    await commitToGitIfRepo(this.graphDir, message)
  }

  /**
   * Replace the full graph directory contents with `changes`, closing the
   * crash window that a naive `rmSync` + rewrite leaves open (a crash between
   * delete and rewrite used to lose the graph entirely) and never deleting
   * non-YAML files a user kept alongside the graph.
   *
   * Approach: stage the new content in a sibling temp directory (copying over
   * the old directory first so untouched non-YAML files survive, then
   * overlaying the new files and dropping stale YAML that's no longer in the
   * ContentMap), then atomically swap it in via two renames. The original
   * directory is never observably empty or partially written.
   *
   * Exception: if `graphDir` is itself a git repository root (contains a
   * `.git` entry), renaming it away would move `.git` too, so we fall back to
   * an in-place selective delete — write new content first, then remove only
   * the stale `.yaml` files no longer present in `changes`.
   */
  private replaceGraphContent(changes: ContentMap): void {
    if (!existsSync(this.graphDir)) {
      writeContentMap(this.graphDir, changes)
      return
    }

    if (existsSync(path.join(this.graphDir, '.git'))) {
      writeContentMap(this.graphDir, changes)
      deleteStaleYamlFiles(this.graphDir, changes)
      return
    }

    const parent = path.dirname(this.graphDir)
    const base = path.basename(this.graphDir)
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
    const tmpDir = path.join(parent, `${base}.corum-tmp-${suffix}`)
    const oldDir = path.join(parent, `${base}.corum-old-${suffix}`)

    rmSync(tmpDir, { recursive: true, force: true })
    cpSync(this.graphDir, tmpDir, { recursive: true })
    writeContentMap(tmpDir, changes)
    deleteStaleYamlFiles(tmpDir, changes)

    renameSync(this.graphDir, oldDir)
    try {
      renameSync(tmpDir, this.graphDir)
    } catch (err) {
      renameSync(oldDir, this.graphDir)
      throw err
    }
    rmSync(oldDir, { recursive: true, force: true })
  }
}

function writeContentMap(baseDir: string, changes: ContentMap): void {
  for (const [key, content] of changes) {
    const filePath = resolveContentPath(baseDir, key)
    mkdirSync(path.dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }
}

function deleteStaleYamlFiles(baseDir: string, changes: ContentMap): void {
  const existingYaml: ContentMap = new Map()
  walkYamlFilesIntoMap(baseDir, baseDir, existingYaml)
  for (const key of existingYaml.keys()) {
    if (!changes.has(key)) {
      rmSync(resolveContentPath(baseDir, key), { force: true })
    }
  }
}

async function commitToGitIfRepo(graphDir: string, message: string): Promise<void> {
  let repoRoot: string
  try {
    repoRoot = await git.findRoot({ fs, filepath: path.resolve(graphDir) })
  } catch {
    return // Not inside a git repo — plain directory writes only.
  }

  const rel = path.relative(repoRoot, path.resolve(graphDir)).split(path.sep).join('/')
  const matrix = await git.statusMatrix({
    fs,
    dir: repoRoot,
    filepaths: rel === '' ? undefined : [rel],
  })

  let staged = false
  for (const [filepath, head, workdir] of matrix) {
    if (head === 1 && workdir === 0) {
      await git.remove({ fs, dir: repoRoot, filepath })
      staged = true
    } else if (workdir === 2) {
      await git.add({ fs, dir: repoRoot, filepath })
      staged = true
    }
  }
  if (!staged) return

  await git.commit({
    fs,
    dir: repoRoot,
    message,
    author: { name: 'corum', email: 'corum@localhost' },
  })
}

function readPackTemplatesIntoMap(packDir: string, map: ContentMap): void {
  if (!existsSync(packDir)) return
  const packName = path.basename(packDir)
  const packContent: ContentMap = new Map()
  walkYamlFilesIntoMap(packDir, packDir, packContent)
  for (const [relKey, content] of packContent) {
    map.set(`${packName}/${relKey}`, content)
  }
}

function walkYamlFilesIntoMap(
  baseDir: string,
  currentDir: string,
  map: ContentMap,
  excludeDirs: Set<string> = new Set(),
): void {
  for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
    const fullPath = path.join(currentDir, entry.name)
    if (entry.isDirectory()) {
      if (!excludeDirs.has(path.resolve(fullPath))) {
        walkYamlFilesIntoMap(baseDir, fullPath, map, excludeDirs)
      }
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      const key = path.relative(baseDir, fullPath).split(path.sep).join('/')
      map.set(key, readFileSync(fullPath, 'utf-8'))
    }
  }
}
