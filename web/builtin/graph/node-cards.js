/* Custom React Flow node renderers: component card, node card, group container. */
import { Handle, Position } from 'reactflow'
import { html, Icon, TemplateBadge, StateTag, StabilityTag } from 'corum:ui'

const HIDDEN_HANDLE = { opacity: 0 }

// Level 1: component card node
function ComponentCardNode({ data }) {
  return html`
    <div className="graph-component-card" onClick=${data.onClick} data-kind=${data.kind} style=${{ borderLeft: `4px solid ${data.kindColour}` }}>
      <${Handle} type="target" position=${Position.Left} style=${HIDDEN_HANDLE} />
      <div className="graph-component-card-name">${data.label}</div>
      <div className="graph-component-card-count">${data.count} ${data.count === 1 ? 'node' : 'nodes'}</div>
      <${Handle} type="source" position=${Position.Right} style=${HIDDEN_HANDLE} />
    </div>
  `
}

// Level 2/3: node card node
function NodeCardNode({ data }) {
  const colour = data.colour ?? 'var(--subtle-foreground)'
  return html`
    <div className=${`graph-node-card${data.faded ? ' faded' : ''}${data.focal ? ' focal' : ''}`} onClick=${data.onClick}>
      ${data.parentLabel && html`<div className="graph-node-card-owner">${data.parentLabel}</div>`}
      <${Handle} type="target" position=${Position.Left} style=${HIDDEN_HANDLE} />
      <div className="graph-node-card-bar" style=${{ background: colour }} />
      <div className="graph-node-card-body">
        <div className="graph-node-card-text">
          <div className="graph-node-card-name" title=${data.nodeId}>${data.label}</div>
          <div className="graph-node-card-component" style=${{ color: data.kindColour }}>${data.component}</div>
        </div>
        <div className="graph-node-card-type">
          <${TemplateBadge} name=${data.templateLabel} colour=${colour} />
        </div>
      </div>
      <div className="graph-node-card-footer">
        <${StabilityTag} stability=${data.stability} />
        <${StateTag} state=${data.state} />
        <button
          className="graph-node-card-link"
          title="View node details"
          onClick=${e => { e.stopPropagation(); data.onOpen() }}
        >
          <${Icon} name="arrow-up-right-from-square" size=${11} />
        </button>
      </div>
      <${Handle} type="source" position=${Position.Right} style=${HIDDEN_HANDLE} />
    </div>
  `
}

// Grouped-mode compound container: label only, member nodes render as children.
function GroupCardNode({ data }) {
  return html`
    <div className="graph-group-card">
      <div className="graph-group-card-label">${data.label}</div>
    </div>
  `
}

export const nodeTypes = { componentCard: ComponentCardNode, nodeCard: NodeCardNode, groupCard: GroupCardNode }
