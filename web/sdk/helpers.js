/* Generic display helpers shared by the host and plugins. */

export function getDisplayName(nodeId) {
  return nodeId.split('.').pop();
}

const KIND_TOKEN_COUNT = 8;

// Stable colour token per kind id (`var(--kind-N)`, defined by every theme). The default kind has a fixed slot;
// others hash into the remaining ones. Use it as a `--node-colour` value: `style={{ '--node-colour': kindColour(kind) }}`.
export function kindColour(kind) {
  const id = kind ?? 'component';
  if (id === 'component') return 'var(--kind-1)';
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(--kind-${2 + (hash % (KIND_TOKEN_COUNT - 1))})`;
}
