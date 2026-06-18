import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import fs from 'node:fs'
import path from 'node:path'
import * as git from 'isomorphic-git'
import { parse as parseYaml } from 'yaml'
import { isPackRef } from '../loader/fs-utils.js'
import type { CommitOptions, ContentMap, GraphSource } from './index.js'
import { SourceError } from './index.js'

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

  async commit(branch: string, changes: ContentMap, _message: string, options: CommitOptions = {}): Promise<void> {
    const defaultBranch = await this.defaultBranch()
    if (branch !== defaultBranch) {
      throw new SourceError(`FileGraphSource only supports its local branch '${defaultBranch}', got '${branch}'`)
    }

    if (options.replaceGraphContent && existsSync(this.graphDir)) {
      rmSync(this.graphDir, { recursive: true, force: true })
    }

    for (const [key, content] of changes) {
      const filePath = resolveContentPath(this.graphDir, key)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, content)
    }
    // TODO: create a git commit for these changes via git.add() + git.commit().
    // Currently _message is unused — file writes are persisted but not committed to git history.
  }
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

function resolveContentPath(baseDir: string, key: string): string {
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
