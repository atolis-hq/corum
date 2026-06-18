import { readFile, writeFile } from 'node:fs/promises'
import { parse, stringify } from 'yaml'

interface GraphYaml {
  'schema-version'?: string
  name?: string
  templatePacks?: Array<{ name: string; path: string }>
  components?: unknown[]
}

export async function registerPackInGraph(
  graphYamlPath: string,
  packName: string,
  relativePath: string,
): Promise<void> {
  const text = await readFile(graphYamlPath, 'utf8')
  const graph = parse(text) as GraphYaml
  if (!Array.isArray(graph.templatePacks)) graph.templatePacks = []
  if (graph.templatePacks.some(p => p.name === packName)) return
  graph.templatePacks.push({ name: packName, path: relativePath })
  await writeFile(graphYamlPath, stringify(graph))
}
