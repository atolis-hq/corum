/**
 * Graph mutation engine (design: node identity and MCP write tools, §7).
 * All graph mutations live here; MCP write tools and the web edit mode are
 * thin wrappers over this module.
 */
export { MutationError } from './errors.js'
export { buildAliasMap, resolveAlias, rewriteIdPrefix } from './alias.js'
export { renameNode, replaceLastSegment, shouldRecordTrail } from './rename.js'
export type { RenameResult } from './rename.js'
export { deleteEdge, deleteNode } from './delete.js'
export type { DeleteNodeOptions, DeleteNodeResult } from './delete.js'
export { applyClusterToGraph, materialiseRootDocument } from './apply-cluster.js'
export type { ApplyClusterMode, ApplyClusterOutcome } from './apply-cluster.js'
export { WorkingSession, discardSession, getActiveSession, startSession } from './session.js'
export type {
  ApplyClusterResult,
  ChangeCounts,
  CommitResult,
  CreateEdgeInput,
  CreateEdgeResult,
  CreateNodeInput,
  CreateNodeResult,
  DeleteEdgeResult,
  JournalEntry,
  OperationResult,
  PendingChanges,
  StartSessionOptions,
  UpdateEdgePatch,
  UpdateEdgeResult,
  UpdateNodePatch,
  UpdateNodeResult,
} from './session.js'
export type {
  DeleteNodeResult as SessionDeleteNodeResult,
  RenameNodeResult as SessionRenameNodeResult,
} from './session.js'
