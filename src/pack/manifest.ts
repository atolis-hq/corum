import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse, stringify } from 'yaml'

export interface InstalledPack {
  name: string
  repo: string
  path: string
  ref: string
  installedAt: string
}

export interface PackManifest {
  packs: InstalledPack[]
}

export async function readManifest(manifestPath: string): Promise<PackManifest> {
  try {
    const text = await readFile(manifestPath, 'utf8')
    return (parse(text) as PackManifest | null) ?? { packs: [] }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { packs: [] }
    throw err
  }
}

export async function upsertPack(manifestPath: string, entry: InstalledPack): Promise<void> {
  const manifest = await readManifest(manifestPath)
  const idx = manifest.packs.findIndex(p => p.name === entry.name)
  if (idx >= 0) {
    manifest.packs[idx] = entry
  } else {
    manifest.packs.push(entry)
  }
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, stringify(manifest))
}
