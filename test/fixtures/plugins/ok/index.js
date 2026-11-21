import { html, SchemaCard } from 'corum:ui'
import { mountReact, useCtx, NodeLinks } from 'corum:ui/react'
import React from 'react'

const anchorIdForNode = nodeId => `ok-anchor-${encodeURIComponent(nodeId)}`

function NodeDemo({ nodeId }) {
  const ctx = useCtx()
  const [cluster, setCluster] = React.useState(null)
  React.useEffect(() => {
    let cancelled = false
    setCluster(null)
    ctx.api.get('cluster', { nodeId, includeEdges: 'uses-type' })
      .then(data => { if (!cancelled) setCluster(data) })
      .catch(() => { if (!cancelled) setCluster(null) })
    return () => { cancelled = true }
  }, [ctx, nodeId])

  const schemas = cluster ? [cluster.root, ...cluster.descendants].filter(node => node.template === 'Schema') : []
  const allNodes = cluster ? [cluster.root, ...cluster.descendants, ...cluster.includedNodes] : []
  return html`
    <div data-testid="ok-node">
      <div data-testid="ok-node-heading" style=${{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h2 style=${{ margin: 0 }}>${nodeId.split('.').pop()}</h2>
        <${NodeLinks} nodeId=${nodeId} surface="header" />
      </div>
      ${schemas.length > 0 && html`
        <div data-testid="ok-schema">
          <${SchemaCard}
            title="Schema"
            nodes=${schemas}
            allNodes=${allNodes}
            edges=${cluster.edges}
            anchorIdForNode=${anchorIdForNode}
            compact=${true}
          />
        </div>
      `}
    </div>
  `
}

function Page() {
  const ctx = useCtx()
  const id = ctx.params.get('id')
  return html`
    <div className="content">
      <h1 data-testid="plugin-ok">OK plugin page</h1>
      <p data-testid="plugin-ok-id">${id ?? ''}</p>
      ${id
        ? html`<${NodeDemo} nodeId=${id} />`
        : html`<p className="label-sm" data-testid="plugin-ok-hint">Open this page with an id query parameter to see node links and a schema card.</p>`}
    </div>
  `
}

export const mount = mountReact(Page)
