import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { resolveContentPath } from '../source/safe-path.js'

interface PackMeta {
  templates: string[]
  files?: string[]
  /** UI plugin directories bundled with the pack, relative to the pack root. */
  plugins?: string[]
}

function validateTemplateName(name: string): void {
  if (!/^[^/\\]+$/.test(name) || name === '.' || name === '..') {
    throw new Error(`invalid template name in pack.yaml: ${name}`)
  }
}

export async function installPackFiles(
  baseUrl: string,
  destDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  const packYamlUrl = `${baseUrl}/pack.yaml`
  const packRes = await fetchFn(packYamlUrl)
  if (!packRes.ok) throw new Error(`Failed to fetch pack.yaml: ${packRes.status} ${packRes.statusText}`)
  const packText = await packRes.text()
  const meta = parse(packText) as PackMeta

  // Remote pack.yaml content is untrusted: validate every declared name/path
  // before any file is written so a malicious pack cannot escape destDir.
  for (const templateName of meta.templates) validateTemplateName(templateName)
  for (const pluginPath of meta.plugins ?? []) {
    if (typeof pluginPath !== 'string') throw new Error('invalid plugins entry in pack.yaml: expected a string')
    resolveContentPath(destDir, pluginPath)
  }
  const fileDests = new Map<string, string>()
  for (const filePath of meta.files ?? []) {
    fileDests.set(filePath, resolveContentPath(destDir, filePath))
  }

  await mkdir(path.join(destDir, 'templates'), { recursive: true })
  await writeFile(path.join(destDir, 'pack.yaml'), packText)

  for (const templateName of meta.templates) {
    const templateUrl = `${baseUrl}/templates/${templateName}.yaml`
    const res = await fetchFn(templateUrl)
    if (!res.ok) throw new Error(`Failed to fetch template ${templateName}: ${res.status} ${res.statusText}`)
    await writeFile(path.join(destDir, 'templates', `${templateName}.yaml`), await res.text())
  }

  for (const [filePath, dest] of fileDests) {
    const fileUrl = `${baseUrl}/${filePath}`
    const res = await fetchFn(fileUrl)
    if (!res.ok) throw new Error(`Failed to fetch file ${filePath}: ${res.status} ${res.statusText}`)
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, await res.text())
  }
}

/** Copy a local pack after validating its metadata and filesystem boundaries. */
export async function installLocalPackFiles(sourceDir: string, destDir: string): Promise<string> {
  const { cp, lstat, mkdtemp, readFile, readdir, realpath, rename, rm, stat } = await import('node:fs/promises')
  const source = await realpath(sourceDir)
  if (!(await stat(source)).isDirectory()) throw new Error('Local pack source must be a directory')
  const meta = parse(await readFile(path.join(source, 'pack.yaml'), 'utf8')) as PackMeta | null
  if (!meta || !Array.isArray(meta.templates) || !meta.templates.every(t => typeof t === 'string')) {
    throw new Error('Invalid pack.yaml: templates must be an array of strings')
  }
  for (const name of meta.templates) {
    validateTemplateName(name)
    if (!(await stat(path.join(source, 'templates', name + '.yaml'))).isFile()) {
      throw new Error(`Missing template file: ${name}`)
    }
  }
  for (const key of ['files', 'plugins'] as const) {
    const entries = meta[key]
    if (entries !== undefined && (!Array.isArray(entries) || !entries.every(p => typeof p === 'string'))) {
      throw new Error(`Invalid pack.yaml: ${key} must be an array of strings`)
    }
    for (const entry of entries ?? []) await stat(resolveContentPath(source, entry))
  }

  // Reject links rather than copying references outside the selected pack.
  async function checkTree(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Local pack contains a symbolic link: ${entry.name}`)
      if (entry.isDirectory()) await checkTree(path.join(dir, entry.name))
      else if (!entry.isFile()) throw new Error(`Unsupported local pack file: ${entry.name}`)
    }
  }
  await checkTree(source)
  await mkdir(path.dirname(destDir), { recursive: true })
  const parent = await realpath(path.dirname(destDir))
  const dest = path.join(parent, path.basename(destDir))
  const contains = (a: string, b: string) => {
    const relative = path.relative(a, b)
    return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  }
  if (contains(source, dest) || contains(dest, source)) throw new Error('Local pack source and destination must not overlap')
  try {
    if ((await lstat(dest)).isSymbolicLink()) throw new Error('Local pack destination must not be a symbolic link')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const staging = await mkdtemp(path.join(parent, '.install-'))
  try {
    await cp(source, path.join(staging, 'pack'), { recursive: true })
    await rm(dest, { recursive: true, force: true })
    await rename(path.join(staging, 'pack'), dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
  return source
}
