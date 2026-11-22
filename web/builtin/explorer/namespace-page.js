/* Generic namespace overview: owned nodes plus inbound and outbound edges. Knows nothing about specific kinds. */
import { html, getDisplayName, kindColour, edgeTypeStyle, hrefForExplorerView } from 'corum:ui'
import { useApi, useCtx } from 'corum:ui/react'
import { namespaceEdges } from './nav.js'

const templateLabel = template => template?.ui?.displayName ?? template?.name ?? ''

function NodeLink({ id, nodeMap, templateMap, onOpen }) {
  const node = nodeMap.get(id)
  const template = node ? templateMap.get(node.template) : null
  return html`
    <span
      role="link" tabIndex=${0}
      style=${{ cursor: 'pointer' }}
      title=${id}
      onClick=${() => onOpen(id)}
      onKeyDown=${event => { if (event.key === 'Enter') onOpen(id) }}
    >
      <span className="weight-medium">${getDisplayName(id)}</span>
      ${template && html`<span className="label-sm"> · ${templateLabel(template)}</span>`}
      <span className="label-sm mono"> ${id}</span>
    </span>
  `
}

function EdgeList({ title, edges, endpoint, graph, error, linkProps }) {
  return html`
    <div className="card" style=${{ marginBottom: 16 }} data-testid=${`namespace-${title.toLowerCase()}`}>
      <div className="card-head">${title} (${edges.length})</div>
      <div className="card-body" style=${{ padding: '12px 16px' }}>
        ${graph === null && !error && html`<div className="label-sm">Loading…</div>`}
        ${error && html`<div className="text-warning">Error loading edges: ${error}</div>`}
        ${graph !== null && edges.length === 0 && html`<div className="label-sm">None.</div>`}
        ${edges.map(edge => html`
          <div key=${edge.id} style=${{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0' }}>
            <span className="tag edge-type-tag edge-coloured" style=${edgeTypeStyle(edge.type)}>${edge.type}</span>
            <${NodeLink} id=${edge[endpoint]} ...${linkProps} />
          </div>
        `)}
      </div>
    </div>
  `
}

export function NamespacePage() {
  const ctx = useCtx()
  const namespace = ctx.params.get('name')
  const { data: nodes } = useApi('/api/nodes')
  const { data: kindsData } = useApi('/api/kinds')
  const { data: graph, error: graphError } = useApi('/api/graph')

  // Namespace navigation stays in the Explorer view, as does every node opened from here.
  const onOpen = id => ctx.navigate(hrefForExplorerView(id, { branch: ctx.viewingRef }))

  if (nodes === null) return html`<div className="content"><p className="label-sm">Loading…</p></div>`
  const owned = nodes.filter(node => node.namespace === namespace)
  if (owned.length === 0) {
    return html`<div className="content"><p className="label-sm">Namespace not found: ${namespace}</p></div>`
  }
  const kind = owned[0].kind ?? 'component'
  const kindLabel = (kindsData?.kinds ?? []).find(item => item.id === kind)?.label ?? kind
  const templateMap = new Map(ctx.templates.map(template => [template.name, template]))

  const byTemplate = new Map()
  for (const node of owned) {
    if (!byTemplate.has(node.template)) byTemplate.set(node.template, [])
    byTemplate.get(node.template).push(node)
  }

  const nodeMap = new Map((graph?.nodes ?? []).map(node => [node.id, node]))
  const { inbound, outbound } = namespaceEdges(graph?.edges ?? [], namespace)
  const linkProps = { nodeMap, templateMap, onOpen }
  const error = graphError ? graphError.message : null

  return html`
    <div className="content">
      <div style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
        <h1 style=${{ margin: 0 }}>${namespace}</h1>
        <span className="explorer-kind-pill node-coloured" style=${{ '--node-colour': kindColour(kind) }}>${kindLabel}</span>
      </div>
      <div className="label-sm" style=${{ marginBottom: 16 }}>Namespace · ${owned.length} ${owned.length === 1 ? 'node' : 'nodes'}</div>

      <div className="card" style=${{ marginBottom: 16 }}>
        <div className="card-head">Owned nodes</div>
        <div className="card-body" style=${{ padding: '12px 16px' }}>
          ${[...byTemplate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([templateName, list]) => html`
            <div key=${templateName} style=${{ marginBottom: 10 }}>
              <div className="label-xs" style=${{ marginBottom: 4 }}>${templateLabel(templateMap.get(templateName)) || templateName}</div>
              ${[...list].sort((a, b) => a.id.localeCompare(b.id)).map(node => html`
                <div key=${node.id} style=${{ padding: '3px 0' }}><${NodeLink} id=${node.id} ...${linkProps} /></div>
              `)}
            </div>
          `)}
        </div>
      </div>

      <${EdgeList} title="Inbound" edges=${inbound} endpoint="from" graph=${graph} error=${error} linkProps=${linkProps} />
      <${EdgeList} title="Outbound" edges=${outbound} endpoint="to" graph=${graph} error=${error} linkProps=${linkProps} />
    </div>
  `
}
