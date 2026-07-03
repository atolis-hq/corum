export type ContentMap = Map<string, string>

export interface CommitOptions {
  replaceGraphContent?: boolean
  /** Create the target branch from the default branch head if it does not exist. */
  createBranchIfMissing?: boolean
}

export interface GraphSource {
  defaultBranch(): Promise<string>
  listBranches(): Promise<string[]>
  loadPackContent(ref: string): Promise<ContentMap>
  loadGraphContent(ref: string): Promise<ContentMap>
  commit(branch: string, changes: ContentMap, message: string, options?: CommitOptions): Promise<void>
}

export class SourceError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = 'SourceError'
  }
}
