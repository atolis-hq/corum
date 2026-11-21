/* Graph breadcrumb, scope popover and toolbar. */
import React, { useState, useEffect, useMemo, useRef } from 'react'
import { html, getDisplayName } from 'corum:ui'
import { EDGE_PILL_STYLES, DEPTH_STEPS } from './constants.js'


export function GraphBreadcrumb({ level, selectedComponent, focalNodeId, onNavigateToRoot, onNavigateToComponent }) {
  return html`
    <div className="graph-breadcrumb">
      <button className="graph-breadcrumb-item" onClick=${onNavigateToRoot}>Graph</button>
      ${(level === 'interior' || level === 'focus') && selectedComponent && html`
        <${React.Fragment}>
          <span className="graph-breadcrumb-sep">/</span>
          ${level === 'interior'
            ? html`<span className="graph-breadcrumb-current">${selectedComponent}</span>`
            : html`<button className="graph-breadcrumb-item" onClick=${() => onNavigateToComponent(selectedComponent)}>${selectedComponent}</button>`}
        <//>
      `}
      ${level === 'focus' && focalNodeId && html`
        <${React.Fragment}>
          <span className="graph-breadcrumb-sep">/</span>
          <span className="graph-breadcrumb-current">${getDisplayName(focalNodeId)}</span>
        <//>
      `}
    </div>
  `
}

function ScopePopover({ scope, onScope, scopeOptions, onClose }) {
  const [edgeType, setEdgeType] = useState(scope?.edgeType ?? '')
  const [fromTemplate, setFromTemplate] = useState(scope?.fromTemplate ?? '')
  const [toTemplate, setToTemplate] = useState(scope?.toTemplate ?? '')
  const [owner, setOwner] = useState(scope?.owner ?? '')

  function apply() {
    if (!edgeType && !owner) { onScope(null); onClose(); return }
    onScope({
      edgeType: edgeType || null,
      fromTemplate: edgeType ? (fromTemplate || null) : null,
      toTemplate: edgeType ? (toTemplate || null) : null,
      owner: owner || null,
    })
    onClose()
  }

  return html`
    <div className="graph-scope-popover">
      <div className="graph-scope-row">
        <label className="graph-scope-label">Interaction</label>
        <select className="graph-scope-select" value=${edgeType} onChange=${e => setEdgeType(e.target.value)}>
          <option value="">any</option>
          ${scopeOptions.edgeTypes.map(t => html`<option key=${t} value=${t}>${t}</option>`)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">From</label>
        <select className="graph-scope-select" value=${fromTemplate} onChange=${e => setFromTemplate(e.target.value)} disabled=${!edgeType}>
          <option value="">any template</option>
          ${scopeOptions.templates.map(t => html`<option key=${t.name} value=${t.name}>${t.label}</option>`)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">To</label>
        <select className="graph-scope-select" value=${toTemplate} onChange=${e => setToTemplate(e.target.value)} disabled=${!edgeType}>
          <option value="">any template</option>
          ${scopeOptions.templates.map(t => html`<option key=${t.name} value=${t.name}>${t.label}</option>`)}
        </select>
      </div>
      <div className="graph-scope-row">
        <label className="graph-scope-label">Owner</label>
        <select className="graph-scope-select" value=${owner} onChange=${e => setOwner(e.target.value)}>
          <option value="">any</option>
          ${scopeOptions.owners.map(o => html`<option key=${o.id} value=${o.id}>${o.label}</option>`)}
        </select>
      </div>
      <div className="graph-scope-actions">
        <button className="graph-toolbar-btn" onClick=${() => { onScope(null); onClose() }}>Clear</button>
        <button className="graph-toolbar-btn active" onClick=${apply}>Apply</button>
      </div>
    </div>
  `
}

function describeScope(scope, scopeOptions) {
  const parts = []
  if (scope.edgeType) {
    const from = scope.fromTemplate
      ? (scopeOptions.templates.find(t => t.name === scope.fromTemplate)?.label ?? scope.fromTemplate)
      : 'any'
    const to = scope.toTemplate
      ? (scopeOptions.templates.find(t => t.name === scope.toTemplate)?.label ?? scope.toTemplate)
      : 'any'
    parts.push(`${scope.edgeType} · ${from} → ${to}`)
  }
  if (scope.owner) parts.push(getDisplayName(scope.owner))
  return parts.join(' · ')
}

function useDismissOnOutsideClick(open, ref, close) {
  useEffect(() => {
    if (!open) return
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) close()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])
}

function FocusSearch({ allNodes, focalNodeId, onFocalNode }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef(null)
  useDismissOnOutsideClick(searchOpen, searchRef, () => setSearchOpen(false))

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return allNodes
      .filter(n => n.id.toLowerCase().includes(q))
      .slice(0, 8)
  }, [searchQuery, allNodes])

  return html`
    <div className="graph-focus-search" ref=${searchRef}>
      <input
        className="graph-focus-search-input"
        placeholder="Focus node..."
        value=${searchQuery}
        onChange=${e => { setSearchQuery(e.target.value); setSearchOpen(true) }}
        onFocus=${() => setSearchOpen(true)}
      />
      ${searchOpen && searchResults.length > 0 && html`
        <div className="graph-focus-search-dropdown">
          ${searchResults.map(n => html`
            <div
              key=${n.id}
              className=${`graph-focus-search-item${n.id === focalNodeId ? ' selected' : ''}`}
              onClick=${() => { onFocalNode(n.id); setSearchQuery(''); setSearchOpen(false) }}
            >
              <span style=${{ fontWeight: 500 }}>${getDisplayName(n.id)}</span>
              <span style=${{ color: 'var(--ink-3)', fontSize: 10, marginLeft: 4 }}>${n.namespace}</span>
            </div>
          `)}
        </div>
      `}
    </div>
  `
}

function ScopeControl({ scope, onScope, scopeOptions, scopeInfo }) {
  const [scopeOpen, setScopeOpen] = useState(false)
  const scopeRef = useRef(null)
  useDismissOnOutsideClick(scopeOpen, scopeRef, () => setScopeOpen(false))

  return html`
    <${React.Fragment}>
      <div className="graph-scope" ref=${scopeRef}>
        <button
          className=${`graph-toolbar-btn${scope ? ' active' : ''}`}
          onClick=${() => setScopeOpen(v => !v)}
        >Scope</button>
        ${scopeOpen && html`
          <${ScopePopover}
            key=${scope ? describeScope(scope, scopeOptions) : 'empty'}
            scope=${scope}
            onScope=${onScope}
            scopeOptions=${scopeOptions}
            onClose=${() => setScopeOpen(false)}
          />
        `}
      </div>
      ${scope && html`
        <span className="graph-scope-pill">
          ${describeScope(scope, scopeOptions)}
          <span className="graph-scope-pill-clear" onClick=${() => onScope(null)}>×</span>
        </span>
      `}
      ${scope && scopeInfo && html`
        <span className="graph-scope-count">${scopeInfo.matchCount} of ${scopeInfo.threadCount} threads</span>
      `}
    <//>
  `
}

export function GraphToolbar({ edgeTypes, visibleEdgeTypes, onToggleEdgeType, showMinimap, onToggleMinimap, onResetLayout, level, kindOptions, kindFilter, onKindFilter, depth, onDepth, allNodes, focalNodeId, onFocalNode, layoutMode, onLayoutMode, scope, onScope, scopeOptions, scopeInfo }) {
  return html`
    <div className="graph-toolbar">
      ${edgeTypes.map(type => {
        const active = visibleEdgeTypes.has(type)
        const pill = EDGE_PILL_STYLES[type] || { background: '#f3f4f6', color: '#6b7280' }
        return html`
          <span
            key=${type}
            className=${`graph-edge-pill${active ? '' : ' inactive'}`}
            style=${active ? pill : {}}
            onClick=${() => onToggleEdgeType(type)}
          >
            ${type}
          </span>
        `
      })}
      <div className="graph-toolbar-sep" />
      ${level === 'focus' && html`
        <${React.Fragment}>
          <div className="graph-depth-ctrl">
            <button
              className="graph-depth-btn"
              onClick=${() => onDepth(DEPTH_STEPS[DEPTH_STEPS.indexOf(depth) - 1])}
              disabled=${depth === DEPTH_STEPS[0]}
            >−</button>
            <span className="graph-depth-val">${depth === Infinity ? '∞' : depth}</span>
            <button
              className="graph-depth-btn"
              onClick=${() => onDepth(DEPTH_STEPS[DEPTH_STEPS.indexOf(depth) + 1])}
              disabled=${depth === DEPTH_STEPS[DEPTH_STEPS.length - 1]}
            >+</button>
          </div>
          <${FocusSearch} allNodes=${allNodes} focalNodeId=${focalNodeId} onFocalNode=${onFocalNode} />
          <div className="graph-toolbar-sep" />
        <//>
      `}
      ${level === 'component' && kindOptions.length > 2 && html`
        <label className="graph-kind-filter-wrap">
          <span className="label-xs">Kind </span>
          <select
            className="graph-kind-filter"
            aria-label="Kind filter"
            value=${kindFilter}
            onChange=${e => onKindFilter(e.target.value)}
          >
            ${kindOptions.map(option => html`<option key=${option.id} value=${option.id}>${option.label}</option>`)}
          </select>
        </label>
      `}
      ${level === 'interior' && scopeOptions && html`
        <${ScopeControl} scope=${scope} onScope=${onScope} scopeOptions=${scopeOptions} scopeInfo=${scopeInfo} />
      `}
      ${level !== 'component' && html`
        <div className="graph-layout-toggle">
          <button
            className=${`graph-toolbar-btn${layoutMode === 'flat' ? ' active' : ''}`}
            onClick=${() => onLayoutMode('flat')}
          >Flat</button>
          <button
            className=${`graph-toolbar-btn${layoutMode === 'grouped' ? ' active' : ''}`}
            onClick=${() => onLayoutMode('grouped')}
          >Grouped</button>
        </div>
      `}
      <button className="graph-toolbar-btn" onClick=${onResetLayout}>Reset layout</button>
      <button className=${`graph-toolbar-btn${showMinimap ? ' active' : ''}`} onClick=${onToggleMinimap}>Minimap</button>
    </div>
  `
}
