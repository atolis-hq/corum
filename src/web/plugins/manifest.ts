import path from 'node:path'
import { parse as parseYaml } from 'yaml'

export type PluginPage = {
  id: string
  title: string
  icon?: string
  order?: number
  mount: string
  opens?: string[]
}

export type PluginNodeAction = {
  id: string
  label: string
  appliesTo: string[]
  page: string
  icon?: string
  param?: string
  menu?: boolean
  quick?: QuickSurface[]
}

export const QUICK_SURFACES = ['header', 'relations'] as const
export type QuickSurface = (typeof QUICK_SURFACES)[number]

export type PluginManifest = {
  id: string
  version: string
  engines: { corum: string }
  requires: { templates: string[] }
  main: string
  contributes: { pages: PluginPage[]; nodeActions: PluginNodeAction[] }
}

const PLUGIN_ID = /^[a-z0-9-]+$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function stringList(value: unknown, label: string, errors: string[]): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    errors.push(`${label} must be a list of non-empty strings`)
    return []
  }
  return value as string[]
}

function quickSurfaces(value: unknown, label: string, errors: string[]): QuickSurface[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) {
    errors.push(`${label} must be a list of surfaces (${QUICK_SURFACES.join(', ')})`)
    return []
  }
  const known = new Set<string>(QUICK_SURFACES)
  const unknown = value.filter(surface => !known.has(surface))
  for (const surface of unknown) errors.push(`${label} has unknown surface "${surface}" (expected ${QUICK_SURFACES.join(', ')})`)
  return unknown.length > 0 ? [] : (value as QuickSurface[])
}

/** True when the value is a relative POSIX path that stays inside its base directory. */
export function isSafeRelativePath(value: string): boolean {
  if (value.includes('\\') || value.includes('\0')) return false
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) return false
  const normalised = path.posix.normalize(value)
  return normalised !== '.' && normalised !== '..' && !normalised.startsWith('../')
}

export function parsePluginManifest(yamlText: string): { manifest: PluginManifest | null; errors: string[] } {
  let doc: unknown
  try {
    doc = parseYaml(yamlText)
  } catch (err) {
    return { manifest: null, errors: [`plugin.yaml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`] }
  }
  if (!isRecord(doc)) return { manifest: null, errors: ['plugin.yaml must be a mapping'] }

  const errors: string[] = []

  const id = doc.id
  if (!isNonEmptyString(id)) errors.push('id is required')
  else if (!PLUGIN_ID.test(id)) errors.push(`id "${id}" must match ^[a-z0-9-]+$`)

  const version = doc.version
  if (!isNonEmptyString(version)) errors.push('version is required and must be a string')

  const engines = doc.engines
  const corumRange = isRecord(engines) ? engines.corum : undefined
  if (!isNonEmptyString(corumRange)) errors.push('engines.corum is required')

  const main = doc.main
  if (!isNonEmptyString(main)) errors.push('main is required')
  else if (!isSafeRelativePath(main)) errors.push(`main "${main}" must be a relative path inside the plugin directory`)
  else if (!/\.m?js$/.test(main)) errors.push(`main "${main}" must be a .js or .mjs file`)

  const requires = doc.requires
  if (requires !== undefined && !isRecord(requires)) errors.push('requires must be a mapping')
  const templates = stringList(isRecord(requires) ? requires.templates : undefined, 'requires.templates', errors)

  const contributes = doc.contributes
  if (contributes !== undefined && !isRecord(contributes)) errors.push('contributes must be a mapping')
  const contributesRec = isRecord(contributes) ? contributes : {}

  const pages: PluginPage[] = []
  const rawPages = contributesRec.pages ?? []
  if (!Array.isArray(rawPages)) {
    errors.push('contributes.pages must be a list')
  } else {
    const seen = new Set<string>()
    rawPages.forEach((raw, index) => {
      const label = `contributes.pages[${index}]`
      if (!isRecord(raw)) {
        errors.push(`${label} must be a mapping`)
        return
      }
      if (!isNonEmptyString(raw.id)) errors.push(`${label}.id is required`)
      else if (seen.has(raw.id)) errors.push(`${label}.id "${raw.id}" is duplicated`)
      else seen.add(raw.id)
      if (!isNonEmptyString(raw.title)) errors.push(`${label}.title is required`)
      if (!isNonEmptyString(raw.mount)) errors.push(`${label}.mount is required`)
      if (raw.icon !== undefined && typeof raw.icon !== 'string') errors.push(`${label}.icon must be a string`)
      if (raw.order !== undefined && (typeof raw.order !== 'number' || !Number.isFinite(raw.order))) {
        errors.push(`${label}.order must be a number`)
      }
      const opens = stringList(raw.opens, `${label}.opens`, errors)
      if (isNonEmptyString(raw.id) && isNonEmptyString(raw.title) && isNonEmptyString(raw.mount)) {
        const page: PluginPage = { id: raw.id, title: raw.title, mount: raw.mount, opens }
        if (typeof raw.icon === 'string') page.icon = raw.icon
        if (typeof raw.order === 'number') page.order = raw.order
        pages.push(page)
      }
    })
  }

  const nodeActions: PluginNodeAction[] = []
  const rawActions = contributesRec.nodeActions ?? []
  if (!Array.isArray(rawActions)) {
    errors.push('contributes.nodeActions must be a list')
  } else {
    const pageIds = new Set(pages.map(page => page.id))
    rawActions.forEach((raw, index) => {
      const label = `contributes.nodeActions[${index}]`
      if (!isRecord(raw)) {
        errors.push(`${label} must be a mapping`)
        return
      }
      if (!isNonEmptyString(raw.id)) errors.push(`${label}.id is required`)
      if (!isNonEmptyString(raw.label)) errors.push(`${label}.label is required`)
      const appliesTo = stringList(raw.appliesTo, `${label}.appliesTo`, errors)
      if (raw.icon !== undefined && typeof raw.icon !== 'string') errors.push(`${label}.icon must be a string`)
      if (raw.param !== undefined && !isNonEmptyString(raw.param)) errors.push(`${label}.param must be a non-empty string`)
      if (raw.menu !== undefined && typeof raw.menu !== 'boolean') errors.push(`${label}.menu must be a boolean`)
      const quick = quickSurfaces(raw.quick, `${label}.quick`, errors)
      if (!isNonEmptyString(raw.page)) errors.push(`${label}.page is required`)
      else if (!pageIds.has(raw.page)) errors.push(`${label}.page "${raw.page}" does not reference a declared page`)
      if (isNonEmptyString(raw.id) && isNonEmptyString(raw.label) && isNonEmptyString(raw.page) && pageIds.has(raw.page)) {
        const action: PluginNodeAction = { id: raw.id, label: raw.label, appliesTo, page: raw.page }
        if (typeof raw.icon === 'string') action.icon = raw.icon
        if (isNonEmptyString(raw.param)) action.param = raw.param
        if (typeof raw.menu === 'boolean') action.menu = raw.menu
        if (quick.length > 0) action.quick = quick
        nodeActions.push(action)
      }
    })
  }

  if (errors.length > 0) return { manifest: null, errors }
  return {
    manifest: {
      id: id as string,
      version: version as string,
      engines: { corum: corumRange as string },
      requires: { templates },
      main: main as string,
      contributes: { pages, nodeActions },
    },
    errors: [],
  }
}
