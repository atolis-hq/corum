/* Generic display helpers shared by the host and plugins. */

export function getDisplayName(nodeId) {
  return nodeId.split('.').pop();
}

const KIND_PALETTE = ['#2f6fb0', '#b0562f', '#4a8a3c', '#8a3c7a', '#b08a2f', '#2f8a8a', '#7a3c3c', '#5a5ab0'];

// Stable colour per kind id. The default kind has a fixed slot; others hash into the rest.
export function kindColour(kind) {
  const id = kind ?? 'component';
  if (id === 'component') return KIND_PALETTE[0];
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return KIND_PALETTE[1 + (hash % (KIND_PALETTE.length - 1))];
}
