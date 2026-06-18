import { parse } from 'yaml'
import { toRegistryFetchUrl, toTagsApiUrl } from './github-urls.js'

export interface RegistryPack {
  name: string
  description: string
  repo: string
  path: string
}

export interface Registry {
  version: string
  packs: RegistryPack[]
}

export async function fetchRegistry(configUrl: string, fetchFn: typeof fetch = fetch): Promise<Registry> {
  const rawUrl = toRegistryFetchUrl(configUrl)
  const res = await fetchFn(rawUrl)
  if (!res.ok) throw new Error(`Failed to fetch registry: ${res.status} ${res.statusText}`)
  return parse(await res.text()) as Registry
}

export function findPack(registry: Registry, name: string): RegistryPack {
  const pack = registry.packs.find(p => p.name === name)
  if (!pack) {
    const available = registry.packs.map(p => p.name).join(', ')
    throw new Error(`Pack "${name}" not found in registry. Available: ${available}`)
  }
  return pack
}

export async function resolveRef(
  owner: string,
  repo: string,
  specifiedRef: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  if (specifiedRef) return specifiedRef
  const url = toTagsApiUrl(owner, repo)
  const res = await fetchFn(url)
  if (!res.ok) throw new Error(`Failed to resolve latest tag: ${res.status} ${res.statusText}`)
  const data = await res.json() as Array<{ name: string }>
  if (data.length === 0 || !data[0].name) throw new Error(`Failed to resolve latest tag: no tags found for ${owner}/${repo}`)
  return data[0].name
}

