/* Explorer tree: namespaces grouped by kind, then node types, then nodes. Mounted in the host's list pane. */
import { useState, useEffect, useMemo, useRef } from 'react'
import { html, Icon, getDisplayName, hrefForExplorerView } from 'corum:ui'
import { useApi, useCtx } from 'corum:ui/react'
import { buildNavTree, buildOverlayIndicatorIds, groupNamespacesByKind } from './nav.js'

const entryKey = entry => (entry.kind === 'group' ? entry.groupTemplateName : entry.templateName)
const templateLabel = template => template?.ui?.displayName ?? template?.name ?? ''

const toggled = (set, key) => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

function OverlayDot() {
  return html`<span className="signal-dots"><span className="signal-dot signal-dot-0" /></span>`
}

function NodeItem({ node, activeNodeId, colour, child, onNode, overlayIds }) {
  const isActive = node.id === activeNodeId
  return html`
    <div
      className=${`nav-node-item${child ? ' nav-node-child' : ''}${isActive ? ' active' : ''}`}
      role="button" tabIndex=${0} aria-current=${isActive ? 'true' : undefined}
      onClick=${() => onNode(node.id)}
      title=${node.id}
      style=${isActive ? { '--nav-node-active-bg': colour } : undefined}
    >
      ${getDisplayName(node.id)}
      ${overlayIds.has(node.id) && html`<${OverlayDot} />`}
    </div>
  `
}

function GroupEntry({ entry, open, onToggle, ...rest }) {
  return html`
    <div>
      <div className="nav-template-head" role="button" tabIndex=${0} aria-expanded=${open} onClick=${onToggle} style=${{ cursor: 'pointer' }}>
        ${entry.icon && html`<i className=${`fa-solid fa-${entry.icon}`} style=${{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }} />`}
        <span>${entry.label}</span>
        <${Icon} name=${open ? 'chevron-down' : 'chevron-right'} size=${10} />
      </div>
      ${open && entry.children.map(child => html`
        <div key=${child.templateName}>
          <div className="nav-subtype-head">
            ${child.icon && html`<i className=${`fa-solid fa-${child.icon}`} style=${{ fontSize: 11, width: 14, textAlign: 'center', flexShrink: 0 }} />`}
            <span>${child.label}</span>
          </div>
          ${child.nodes.map(node => html`<${NodeItem} key=${node.id} node=${node} colour=${child.colour} ...${rest} />`)}
        </div>
      `)}
    </div>
  `
}

function TemplateEntry({ entry, template, templateMap, open, onToggle, openGroupKeys, setOpenGroupKeys, ...rest }) {
  const colour = template?.ui?.colour ?? 'var(--ink-4)'
  return html`
    <div>
      <div className="nav-template-head" role="button" tabIndex=${0} aria-expanded=${open} onClick=${onToggle} style=${{ cursor: 'pointer' }}>
        <i className=${`fa-solid fa-${template?.ui?.icon ?? 'circle'}`} style=${{ fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }} />
        <span>${templateLabel(template)}</span>
        <${Icon} name=${open ? 'chevron-down' : 'chevron-right'} size=${10} />
      </div>
      ${open && entry.nodes.map(node => html`
        <div key=${node.id}>
          <${NodeItem} node=${node} colour=${colour} ...${rest} />
          ${(node.navChildren ?? []).map(group => {
            const groupKey = `${node.id}:${group.label}`
            const groupOpen = openGroupKeys.has(groupKey)
            return html`
              <div className="nav-child-group" key=${group.label}>
                <div
                  className="nav-child-head"
                  role="button" tabIndex=${0} aria-expanded=${groupOpen}
                  style=${{ cursor: 'pointer' }}
                  onClick=${() => setOpenGroupKeys(prev => toggled(prev, groupKey))}
                >
                  ${group.label}
                  <${Icon} name=${groupOpen ? 'chevron-down' : 'chevron-right'} size=${10} />
                </div>
                ${groupOpen && group.nodes.map(child => html`
                  <${NodeItem}
                    key=${child.id} node=${child} child=${true}
                    colour=${templateMap.get(child.template)?.ui?.colour ?? colour} ...${rest}
                  />
                `)}
              </div>
            `
          })}
        </div>
      `)}
    </div>
  `
}

export function ExplorerTree() {
  const ctx = useCtx()
  const { data: nodes } = useApi('/api/nodes')
  const { data: kindsData } = useApi('/api/kinds')
  const templates = ctx.templates
  const navTree = useMemo(() => buildNavTree(nodes ?? [], templates), [nodes, templates])
  const kindSections = useMemo(() => groupNamespacesByKind(nodes ?? [], kindsData?.kinds ?? []), [nodes, kindsData])
  const templateMap = useMemo(() => new Map(templates.map(template => [template.name, template])), [templates])

  // The tree stays mounted across namespace pages, so the last opened node keeps its highlight there.
  const retainedNode = useRef(null)
  const routeNodeId = ctx.route.pathname === '/node' ? ctx.params.get('id') : null
  if (routeNodeId) retainedNode.current = routeNodeId
  const activeNodeId = routeNodeId || retainedNode.current

  const [overlayIds, setOverlayIds] = useState(() => new Set())
  const overlayRefs = ctx.overlayRefs
  useEffect(() => {
    if (!ctx.viewingRef || overlayRefs.length === 0 || !nodes) {
      setOverlayIds(new Set())
      return undefined
    }
    let cancelled = false
    ctx.api.get(`/api/overlay/${encodeURIComponent(ctx.viewingRef)}`)
      .then(data => { if (!cancelled) setOverlayIds(buildOverlayIndicatorIds(nodes, templates, data.nodes || [], overlayRefs)) })
      .catch(() => { if (!cancelled) setOverlayIds(new Set()) })
    return () => { cancelled = true }
  }, [ctx.viewingRef, overlayRefs, nodes, templates])

  const sortedComponents = [...navTree.keys()].sort((a, b) => a.localeCompare(b))
  const [openComponent, setOpenComponent] = useState()
  const [openEntryKeys, setOpenEntryKeys] = useState(() => new Set())
  const [openGroupKeys, setOpenGroupKeys] = useState(() => new Set())

  function openComponentWithEntries(component) {
    setOpenComponent(component)
    if (!component) { setOpenEntryKeys(new Set()); return }
    const entries = navTree.get(component) ?? []
    setOpenEntryKeys(entries.length === 1 ? new Set([entryKey(entries[0])]) : new Set())
  }

  // Initialise / recover openComponent when the tree first loads or the open component disappears.
  useEffect(() => {
    const autoOpen = sortedComponents.length === 1 ? sortedComponents[0] : null
    if (openComponent === undefined) { openComponentWithEntries(autoOpen); return }
    if (openComponent !== null && !navTree.has(openComponent)) openComponentWithEntries(autoOpen)
  }, [navTree, openComponent, sortedComponents.join('\n')])

  // When navigating directly to a node (e.g. via link), open its component and entry.
  useEffect(() => {
    if (!activeNodeId || !navTree.size) return
    for (const [component, entries] of navTree.entries()) {
      for (const entry of entries) {
        const found = entry.kind === 'group'
          ? entry.children.some(child => child.nodes.some(n => n.id === activeNodeId))
          : entry.nodes.some(n => n.id === activeNodeId)
            || entry.nodes.some(n => (n.navChildren ?? []).some(g => g.nodes.some(c => c.id === activeNodeId)))
        if (found) {
          setOpenComponent(component)
          setOpenEntryKeys(new Set([entryKey(entry)]))
          return
        }
      }
    }
  }, [activeNodeId, navTree])

  // Auto-expand groups for the active node; collapse all others.
  useEffect(() => {
    if (!activeNodeId || !navTree.size) return
    for (const entries of navTree.values()) {
      for (const entry of entries) {
        if (entry.kind === 'group') continue
        for (const node of entry.nodes) {
          const isOwner = node.id === activeNodeId
            || (node.navChildren ?? []).some(g => g.nodes.some(c => c.id === activeNodeId))
          if (isOwner) {
            setOpenGroupKeys(new Set((node.navChildren ?? []).map(g => `${node.id}:${g.label}`)))
            return
          }
        }
      }
    }
    setOpenGroupKeys(new Set())
  }, [activeNodeId, navTree])

  // Navigation that starts in the tree stays in the Explorer view of the node.
  const onNode = id => ctx.navigate(hrefForExplorerView(id, { branch: ctx.viewingRef }))
  const onNamespace = name => ctx.navigate(ctx.hrefForPage({ name }, { page: 'namespace' }))

  function toggleComponent(component, kind) {
    openComponentWithEntries(openComponent === component ? null : component)
    // Kinds other than the default have no dedicated view: open the generic namespace page.
    if (kind !== 'component') onNamespace(component)
  }

  if (nodes === null) return null
  if (navTree.size === 0) {
    return html`<div className="nav-tree"><div className="empty-state">No graph nodes loaded.</div></div>`
  }

  const itemProps = { activeNodeId, onNode, overlayIds }
  return html`
    <div className="nav-tree" onKeyDown=${event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.getAttribute('role') === 'button') {
        event.preventDefault()
        event.target.click()
      }
    }}>
      ${kindSections.map(section => html`
        <div key=${section.kind} className="nav-kind-section" data-kind=${section.kind}>
          ${kindSections.length > 1 && html`<div className="nav-kind-head">${section.label}</div>`}
          ${section.namespaces.map(component => html`
            <div key=${component}>
              <div className="nav-section-head" role="button" tabIndex=${0} aria-expanded=${openComponent === component} onClick=${() => toggleComponent(component, section.kind)}>
                <span>${component}</span>
                <${Icon} name=${openComponent === component ? 'chevron-down' : 'chevron-right'} size=${12} />
              </div>
              ${openComponent === component && (navTree.get(component) ?? []).map(entry => {
                const key = entryKey(entry)
                const open = openEntryKeys.has(key)
                const onToggle = () => setOpenEntryKeys(prev => toggled(prev, key))
                return entry.kind === 'group'
                  ? html`<${GroupEntry} key=${key} entry=${entry} open=${open} onToggle=${onToggle} ...${itemProps} />`
                  : html`
                    <${TemplateEntry}
                      key=${key} entry=${entry} template=${templateMap.get(entry.templateName)} templateMap=${templateMap}
                      open=${open} onToggle=${onToggle} openGroupKeys=${openGroupKeys} setOpenGroupKeys=${setOpenGroupKeys}
                      ...${itemProps}
                    />`
              })}
            </div>
          `)}
        </div>
      `)}
    </div>
  `
}
