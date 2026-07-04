export type ContentMap = Map<string, string>

export interface CommitOptions {
  replaceGraphContent?: boolean
  /** Create the target branch from the default branch head if it does not exist. */
  createBranchIfMissing?: boolean
  /**
   * Commit whose parent is this SHA instead of the current branch head — the
   * working-session squash path (design §14e). The caller is responsible for
   * the squash guard; sources skip their compare-and-swap retry when set.
   * File sources ignore it (writes are already content-replacing).
   */
  parentSha?: string
  /** Permit a non-fast-forward push (remote git squash only). Ignored elsewhere. */
  force?: boolean
}

export interface GraphSource {
  defaultBranch(): Promise<string>
  listBranches(): Promise<string[]>
  loadPackContent(ref: string): Promise<ContentMap>
  loadGraphContent(ref: string): Promise<ContentMap>
  commit(branch: string, changes: ContentMap, message: string, options?: CommitOptions): Promise<void>
  /**
   * Current head marker for a branch: the commit SHA for git sources; a
   * content hash for file sources — sufficient for the moved-head check
   * (design §10/§14e).
   */
  head(branch: string): Promise<string>
  /**
   * Head markers from `head(branch)` back to (and excluding) `sinceSha`,
   * newest first — the squash-guard walk (design §14e). Git sources follow
   * first parents; if `sinceSha` is not an ancestor the walk stops at the
   * root commit and returns everything seen. Sources without history return
   * `[head]` when the head moved, `[]` otherwise.
   */
  log(branch: string, sinceSha: string): Promise<string[]>
}

export class SourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'SourceError'
  }
}
