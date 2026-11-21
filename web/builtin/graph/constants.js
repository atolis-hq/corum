/* Graph view constants and persisted UI preferences. */

export const EDGE_STYLES = {
  'triggers':     { stroke: '#b45309', strokeWidth: 1.5 },
  'produces':     { stroke: '#0f766e', strokeWidth: 1.5 },
  'calls':        { stroke: '#6d28d9', strokeWidth: 1.5 },
  'implements':   { stroke: '#475569', strokeWidth: 1.5 },
  'reads':        { stroke: '#1d4ed8', strokeWidth: 1.5 },
  'uses-type':    { stroke: '#0891b2', strokeWidth: 1.5 },
  'maps-to':      { stroke: '#be185d', strokeWidth: 1.5 },
  'derived-from': { stroke: '#6b7280', strokeWidth: 1.5, strokeDasharray: '5,5' },
}

export const EDGE_PILL_STYLES = {
  'triggers':     { background: '#fef3c7', color: '#b45309' },
  'produces':     { background: '#ccfbf1', color: '#0f766e' },
  'calls':        { background: '#ede9fe', color: '#6d28d9' },
  'implements':   { background: '#f1f5f9', color: '#475569' },
  'reads':        { background: '#dbeafe', color: '#1d4ed8' },
  'uses-type':    { background: '#cffafe', color: '#0891b2' },
  'maps-to':      { background: '#fce7f3', color: '#be185d' },
  'derived-from': { background: '#f3f4f6', color: '#6b7280' },
}

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
