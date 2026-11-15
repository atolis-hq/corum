/** Root directory for graph node cluster files. */
export const NODE_ROOT_DIR = 'nodes'

/** YAML paths managed by graph sources. Other paths are ignored. */
export function isManagedGraphYamlKey(key: string): boolean {
  return key === 'graph.yaml' || key.startsWith(`${NODE_ROOT_DIR}/`) || key.startsWith('edges/')
}
