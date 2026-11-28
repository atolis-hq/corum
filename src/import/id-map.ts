import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'
import type { Diagnostic } from '../schema/index.js'

/**
 * ID maps link source-native IDs (e.g. `clr:Orders.Contracts.Foo`) to other IDs
 * through exact entries and naming rules. No code runs: patterns are literal
 * text with named captures and a fixed set of string transforms.
 */

export type Transform = 'lower' | 'camel' | 'kebab' | 'pascal'

const TRANSFORMS: Record<Transform, (s: string) => string> = {
  lower: s => s.toLowerCase(),
  camel: s => (s.length === 0 ? s : s[0].toLowerCase() + s.slice(1)),
  pascal: s => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1)),
  kebab: s => s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase(),
}

export function isTransform(name: string): name is Transform {
  return Object.prototype.hasOwnProperty.call(TRANSFORMS, name)
}

// A capture is one or more characters other than `.`, `#`, `/` and whitespace.
const CAPTURE_CLASS = '[^.#/\\s]+'

type Part = { literal: string } | { capture: string; transform?: Transform }

function parsePattern(pattern: string, allowTransforms: boolean, where: string): Part[] {
  const parts: Part[] = []
  let rest = pattern
  while (rest.length > 0) {
    const open = rest.indexOf('{')
    if (open === -1) {
      if (rest.includes('}')) throw new Error(`${where}: unbalanced '}' in pattern '${pattern}'`)
      parts.push({ literal: rest })
      break
    }
    const literal = rest.slice(0, open)
    if (literal.includes('}')) throw new Error(`${where}: unbalanced '}' in pattern '${pattern}'`)
    if (literal) parts.push({ literal })
    const close = rest.indexOf('}', open)
    if (close === -1) throw new Error(`${where}: unclosed '{' in pattern '${pattern}'`)
    const body = rest.slice(open + 1, close)
    const [name, transform, ...extra] = body.split('|')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || extra.length > 0) {
      throw new Error(`${where}: invalid capture '{${body}}' in pattern '${pattern}'`)
    }
    if (transform !== undefined) {
      if (!allowTransforms) throw new Error(`${where}: transforms are only allowed in "to" patterns ('{${body}}')`)
      if (!isTransform(transform)) {
        throw new Error(`${where}: unknown transform '${transform}' (allowed: lower, camel, kebab, pascal)`)
      }
      parts.push({ capture: name, transform })
    } else {
      parts.push({ capture: name })
    }
    rest = rest.slice(close + 1)
  }
  return parts
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export interface IdMapRule {
  file: string
  index: number
  from: string
  to: string
  fromRegex: RegExp
  captures: string[]
  toParts: Part[]
}

export interface IdMapFile {
  path: string
  exact: Map<string, string>
  rules: IdMapRule[]
}

function compileRule(file: string, index: number, raw: unknown): IdMapRule {
  const where = `${file}: rules[${index}]`
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${where} must be an object`)
  const rec = raw as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key !== 'from' && key !== 'to') throw new Error(`${where}: unknown key '${key}'`)
  }
  if (typeof rec.from !== 'string' || rec.from === '') throw new Error(`${where}: missing non-empty "from"`)
  if (typeof rec.to !== 'string' || rec.to === '') throw new Error(`${where}: missing non-empty "to"`)
  const fromParts = parsePattern(rec.from, false, where)
  const toParts = parsePattern(rec.to, true, where)
  const captures: string[] = []
  for (const p of fromParts) if ('capture' in p) {
    if (captures.includes(p.capture)) throw new Error(`${where}: capture '${p.capture}' used twice in "from"`)
    captures.push(p.capture)
  }
  for (const p of toParts) if ('capture' in p && !captures.includes(p.capture)) {
    throw new Error(`${where}: "to" uses capture '${p.capture}' which "from" does not define`)
  }
  const source = fromParts.map(p => 'literal' in p ? escapeRegex(p.literal) : `(${CAPTURE_CLASS})`).join('')
  return { file, index, from: rec.from, to: rec.to, fromRegex: new RegExp(`^${source}$`), captures, toParts }
}

export function parseIdMap(path: string, text: string): IdMapFile {
  let raw: unknown
  try {
    raw = parseYaml(text)
  } catch (err) {
    throw new Error(`Failed to parse ID map ${path}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (raw === null || raw === undefined) return { path, exact: new Map(), rules: [] }
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`Invalid ID map ${path}: must be an object`)
  const rec = raw as Record<string, unknown>
  for (const key of Object.keys(rec)) {
    if (key !== 'exact' && key !== 'rules') throw new Error(`Invalid ID map ${path}: unknown key '${key}'`)
  }
  const exact = new Map<string, string>()
  if (rec.exact !== undefined) {
    if (typeof rec.exact !== 'object' || rec.exact === null || Array.isArray(rec.exact)) {
      throw new Error(`Invalid ID map ${path}: "exact" must be a mapping of ID to ID`)
    }
    for (const [from, to] of Object.entries(rec.exact)) {
      if (typeof to !== 'string' || to === '') throw new Error(`Invalid ID map ${path}: exact['${from}'] must be a non-empty string`)
      exact.set(from, to)
    }
  }
  const rules: IdMapRule[] = []
  if (rec.rules !== undefined) {
    if (!Array.isArray(rec.rules)) throw new Error(`Invalid ID map ${path}: "rules" must be a list`)
    rec.rules.forEach((r, i) => rules.push(compileRule(path, i, r)))
  }
  return { path, exact, rules }
}

export function loadIdMaps(paths: string[]): IdMapFile[] {
  return paths.map(p => {
    let text: string
    try {
      text = readFileSync(p, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read ID map ${p}: ${err instanceof Error ? err.message : String(err)}`)
    }
    return parseIdMap(p, text)
  })
}

/** Applies a rule to an ID; returns the rewritten ID or undefined if the pattern does not match. */
export function applyRule(rule: IdMapRule, id: string): string | undefined {
  const m = rule.fromRegex.exec(id)
  if (!m) return undefined
  const values = new Map(rule.captures.map((name, i) => [name, m[i + 1]] as const))
  return rule.toParts.map(p => {
    if ('literal' in p) return p.literal
    const v = values.get(p.capture)!
    return p.transform ? TRANSFORMS[p.transform](v) : v
  }).join('')
}

export interface RuleStats {
  file: string
  index: number
  from: string
  to: string
  /** Distinct references the "from" pattern matched (including ones whose target did not resolve). */
  matched: number
  /** References this rule resolved (rule produced the winning target). */
  resolved: number
  /** References where this rule's candidate was overridden by an exact entry. */
  overridden: number
  /** References where this rule's candidate contributed to an ambiguity. */
  ambiguous: number
}

export interface ExactStats {
  file: string
  from: string
  to: string
  resolved: number
}

export interface IdMapSummary {
  rules: RuleStats[]
  exact: ExactStats[]
}

export type Resolution =
  | { kind: 'resolved'; target: string; via: 'node' | 'source-id' | 'exact' | 'rule' }
  | { kind: 'ambiguous'; candidates: string[]; message: string }
  | { kind: 'unresolved' }

export interface IdResolverOptions {
  /** Merged non-removed node IDs. */
  hasNode: (id: string) => boolean
  /** Retired ID -> current ID. */
  aliases: ReadonlyMap<string, string>
  /** Source-native/declared ID -> Corum node IDs it was registered against. */
  sourceIds: ReadonlyMap<string, ReadonlySet<string>>
  maps: IdMapFile[]
}

export class IdResolver {
  private readonly exactEntries = new Map<string, { file: string; to: string; resolved: Set<string> }>()
  // Distinct references per outcome, so resolving the same reference more than once never double counts.
  private readonly tallies = new Map<IdMapRule, Record<'matched' | 'resolved' | 'overridden' | 'ambiguous', Set<string>>>()
  private readonly rules: IdMapRule[] = []
  private readonly diagnostics: Diagnostic[] = []
  private readonly exactWarned = new Set<string>()

  constructor(private readonly opts: IdResolverOptions) {
    for (const file of opts.maps) {
      for (const [from, to] of file.exact) {
        const prior = this.exactEntries.get(from)
        if (prior) {
          if (prior.to !== to) {
            this.diagnostics.push({
              severity: 'warning',
              file: file.path,
              message: `ID map exact entry '${from}' → '${to}' conflicts with '${prior.to}' from ${prior.file}; the earlier file wins`,
            })
          }
          continue
        }
        this.exactEntries.set(from, { file: file.path, to, resolved: new Set() })
      }
      for (const rule of file.rules) {
        this.rules.push(rule)
        this.tallies.set(rule, { matched: new Set(), resolved: new Set(), overridden: new Set(), ambiguous: new Set() })
      }
    }
  }

  get hasMaps(): boolean {
    return this.opts.maps.length > 0
  }

  /** Steps 1-2: exact Corum node ID / alias, then registered source-native or declared ID. */
  private direct(id: string): Resolution {
    if (this.opts.hasNode(id)) return { kind: 'resolved', target: id, via: 'node' }
    const aliased = this.opts.aliases.get(id)
    if (aliased !== undefined && this.opts.hasNode(aliased)) return { kind: 'resolved', target: aliased, via: 'node' }
    const registered = this.opts.sourceIds.get(id)
    if (registered) {
      const live = [...new Set([...registered].map(t => this.opts.hasNode(t) ? t : this.opts.aliases.get(t) ?? t))]
        .filter(t => this.opts.hasNode(t)).sort()
      if (live.length === 1) return { kind: 'resolved', target: live[0], via: 'source-id' }
      if (live.length > 1) {
        return { kind: 'ambiguous', candidates: live, message: `'${id}' is registered against more than one node: ${live.join(', ')}` }
      }
    }
    return { kind: 'unresolved' }
  }

  /**
   * @param mappedOnly skip steps 1-2 for `ref` itself and consult only the maps.
   *   Used to pair a declared ID with a node from another source, where the
   *   declared ID would otherwise resolve to its own node.
   */
  resolve(ref: string, mappedOnly = false): Resolution {
    if (!mappedOnly) {
      const direct = this.direct(ref)
      if (direct.kind !== 'unresolved') return direct
    }
    return this.resolveMapped(ref)
  }

  private resolveMapped(ref: string): Resolution {

    // Candidates every rule would produce, so exact overrides can be counted.
    const ruleHits: Array<{ rule: IdMapRule; candidate: string; target?: string }> = []
    for (const rule of this.rules) {
      const candidate = applyRule(rule, ref)
      if (candidate === undefined) continue
      this.tallies.get(rule)!.matched.add(ref)
      const r = this.direct(candidate)
      ruleHits.push({ rule, candidate, target: r.kind === 'resolved' ? r.target : undefined })
    }

    const exact = this.exactEntries.get(ref)
    if (exact) {
      for (const hit of ruleHits) if (hit.target !== undefined) this.tallies.get(hit.rule)!.overridden.add(ref)
      const r = this.direct(exact.to)
      if (r.kind === 'resolved') {
        exact.resolved.add(ref)
        return { kind: 'resolved', target: r.target, via: 'exact' }
      }
      if (!this.exactWarned.has(ref)) {
        this.exactWarned.add(ref)
        this.diagnostics.push({
          severity: 'warning',
          file: exact.file,
          message: `ID map exact entry '${ref}' → '${exact.to}': target does not resolve to any node`,
        })
      }
      return { kind: 'unresolved' }
    }

    const resolving = ruleHits.filter(h => h.target !== undefined)
    const targets = [...new Set(resolving.map(h => h.target!))].sort()
    if (targets.length === 1) {
      for (const h of resolving) this.tallies.get(h.rule)!.resolved.add(ref)
      return { kind: 'resolved', target: targets[0], via: 'rule' }
    }
    if (targets.length > 1) {
      for (const h of resolving) this.tallies.get(h.rule)!.ambiguous.add(ref)
      const detail = resolving.map(h => `${h.target} (rule ${h.rule.file}#${h.rule.index}: ${h.rule.from} → ${h.rule.to})`).join('; ')
      return { kind: 'ambiguous', candidates: targets, message: `'${ref}' matches more than one target: ${detail}` }
    }
    return { kind: 'unresolved' }
  }

  /** Rules that match `ref` and the IDs they produce (for explaining an unresolved reference). */
  candidatesFor(ref: string): Array<{ rule: IdMapRule; candidate: string }> {
    const hits: Array<{ rule: IdMapRule; candidate: string }> = []
    for (const rule of this.rules) {
      const candidate = applyRule(rule, ref)
      if (candidate !== undefined) hits.push({ rule, candidate })
    }
    return hits
  }

  /** Diagnostics collected so far plus warnings for rules that matched nothing. */
  finish(): { diagnostics: Diagnostic[]; summary: IdMapSummary } {
    const diagnostics = [...this.diagnostics]
    const rules: RuleStats[] = this.rules.map(r => {
      const t = this.tallies.get(r)!
      return {
        file: r.file, index: r.index, from: r.from, to: r.to,
        matched: t.matched.size, resolved: t.resolved.size, overridden: t.overridden.size, ambiguous: t.ambiguous.size,
      }
    })
    for (const s of rules) {
      if (s.matched === 0) {
        diagnostics.push({
          severity: 'warning',
          file: s.file,
          message: `ID map rule ${s.index} ('${s.from}' → '${s.to}') matched no reference or declared ID in this run`,
        })
      }
    }
    return { diagnostics, summary: { rules, exact: [...this.exactEntries].map(([from, e]) => ({ file: e.file, from, to: e.to, resolved: e.resolved.size })) } }
  }
}
