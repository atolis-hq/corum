import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { resolveContentPath } from '../source/safe-path.js'

interface PackMeta {
  templates: string[]
  files?: string[]
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
