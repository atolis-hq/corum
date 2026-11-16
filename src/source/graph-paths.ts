/** Root directory for graph node cluster files. */
export const NODE_ROOT_DIR = 'nodes'

/** Graph YAML owned by loaders and graph replacement. */
export function isManagedGraphYamlKey(key: string): boolean {
  return key === 'graph.yaml' || key.startsWith(`${NODE_ROOT_DIR}/`) || key.startsWith('edges/')
}
