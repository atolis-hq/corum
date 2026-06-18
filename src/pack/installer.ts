import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'

interface PackMeta {
  templates: string[]
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

  await mkdir(path.join(destDir, 'templates'), { recursive: true })
  await writeFile(path.join(destDir, 'pack.yaml'), packText)

  for (const templateName of meta.templates) {
    const templateUrl = `${baseUrl}/templates/${templateName}.yaml`
    const res = await fetchFn(templateUrl)
    if (!res.ok) throw new Error(`Failed to fetch template ${templateName}: ${res.status} ${res.statusText}`)
    await writeFile(path.join(destDir, 'templates', `${templateName}.yaml`), await res.text())
  }
}
