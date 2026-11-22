/*
 * The styling contract snapshot: the contract version plus every documented token and class name with its `since`.
 * `compareContract` decides whether a change from the committed snapshot is allowed (ADR-011 section 9).
 */
import { contractVersion, readTokens } from './tokens-css.mjs'

export const SNAPSHOT_PATH = 'test/fixtures/styling-contract.snapshot.json'

/** Snapshot of the current contract from the parsed tokens.json and classes.json documents. */
export function snapshotOf(tokensDoc, classesDoc) {
  const sorted = entries => Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1)))
  return {
    version: contractVersion(tokensDoc),
    tokens: sorted(readTokens(tokensDoc).map(t => [t.name, t.since])),
    classes: sorted(Object.entries(classesDoc.classes).map(([name, def]) => [name, def.since])),
  }
}

/**
 * Problems found when moving from `before` (the committed snapshot) to `after` (the current contract).
 * Removing or renaming a name needs a higher version; a new name needs `since` equal to the current version;
 * `since` of an existing name never changes. An empty list means the change is allowed.
 */
export function compareContract(before, after) {
  const problems = []
  if (after.version < before.version) problems.push(`contract version went down (${before.version} -> ${after.version})`)
  const bumped = after.version > before.version
  for (const kind of ['tokens', 'classes']) {
    const label = kind === 'tokens' ? 'token' : 'class'
    for (const [name, since] of Object.entries(before[kind])) {
      if (!(name in after[kind])) {
        if (!bumped) problems.push(`${label} ${name} was removed or renamed without a contract version bump (breaking change)`)
      } else if (after[kind][name] !== since) {
        problems.push(`${label} ${name}: since changed from ${since} to ${after[kind][name]}`)
      }
    }
    for (const [name, since] of Object.entries(after[kind])) {
      if (name in before[kind]) continue
      if (!Number.isInteger(since)) problems.push(`${label} ${name} was added without a "since"`)
      else if (since !== after.version) problems.push(`${label} ${name} was added with since ${since}; a new name needs since ${after.version} (the current contract version)`)
    }
  }
  return problems
}
