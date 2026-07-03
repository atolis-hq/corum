import { encode as encodeToon } from '@toon-format/toon'
import { stringify as stringifyYaml } from 'yaml'
import { QueryError } from '../schema/index.js'

export type OutputFormat = 'yaml' | 'json' | 'toon'

export interface Serializer {
  readonly format: OutputFormat
  serialize(value: unknown): string
}

export class JsonSerializer implements Serializer {
  readonly format = 'json'

  serialize(value: unknown): string {
    return JSON.stringify(value, null, 2)
  }
}

export class YamlSerializer implements Serializer {
  readonly format = 'yaml'

  serialize(value: unknown): string {
    return stringifyYaml(value)
  }
}

export class ToonSerializer implements Serializer {
  readonly format = 'toon'

  serialize(value: unknown): string {
    return encodeToon(value)
  }
}

export function getSerializer(format: unknown): Serializer {
  switch (format ?? 'yaml') {
    case 'json':
      return new JsonSerializer()
    case 'yaml':
      return new YamlSerializer()
    case 'toon':
      return new ToonSerializer()
    default:
      throw new QueryError(`Invalid output format: ${String(format)}. Expected yaml, json, or toon.`)
  }
}

const COMPACT_KEY_MAP: Record<string, string> = {
  id: 'i',
  template: 't',
  component: 'cp',
  state: 's',
  stability: 'st',
  schemaVersion: 'sv',
  lastModifiedAt: 'lm',
  extractedFrom: 'xf',
  properties: 'p',
  origin_id: 'oi',
  depth: 'd',
  via_edge_type: 'vet',
  via_node_id: 'vni',
  derivation: 'dv',
  derivedBy: 'db',
  root: 'r',
  children: 'ch',
  edges: 'e',
  nodes: 'n',
  from: 'fr',
  to: 'to',
  type: 'ty',
  notes: 'nt',
  version: 'v',
  core: 'c',
  abstract: 'a',
  extends: 'ex',
}

export function compactKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => compactKeys(item))
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      COMPACT_KEY_MAP[key] ?? key,
      // `properties` values are user-authored data; compact envelope keys only.
      key === 'properties' ? child : compactKeys(child),
    ]),
  )
}
