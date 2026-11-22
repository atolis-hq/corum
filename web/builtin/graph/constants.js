/* Graph view constants and persisted UI preferences. */

const LEGACY_EDGE_TYPES = ['triggers', 'produces', 'reads', 'uses-type', 'calls', 'implements', 'maps-to', 'derived-from']
export const DEPTH_STEPS = [1, 2, 3, 4, 5, Infinity]

export const NODE_W = 210
export const NODE_H = 100
export const COMP_W = 180
export const COMP_H = 72

export function loadHiddenEdgeTypes() {
  try {
    const stored = localStorage.getItem('corum:graphEdgeTypes')
    if (!stored) return new Set()
    const parsed = JSON.parse(stored)
    if (Array.isArray(parsed)) {
      return new Set(LEGACY_EDGE_TYPES.filter(type => !parsed.includes(type)))
    }
    if (Array.isArray(parsed?.hiddenTypes)) return new Set(parsed.hiddenTypes)
  } catch {}
  return new Set()
}

export function saveHiddenEdgeTypes(types) {
  try { localStorage.setItem('corum:graphEdgeTypes', JSON.stringify({ version: 2, hiddenTypes: [...types].sort() })) } catch {}
}

export function loadLayoutMode() {
  try {
    const stored = localStorage.getItem('corum:graphLayoutMode')
    if (stored === 'flat' || stored === 'grouped') return stored
  } catch {}
  return 'flat'
}

export function saveLayoutMode(mode) {
  try { localStorage.setItem('corum:graphLayoutMode', mode) } catch {}
}
