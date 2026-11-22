/* Custom React Flow node renderers: component card, node card, group container. */
import { Handle, Position } from 'reactflow'
import { html, Icon, TemplateBadge, StateTag, StabilityTag, templateColourStyle } from 'corum:ui'

// Level 1: component card node
function ComponentCardNode({ data }) {
  return html`
    <div className="graph-component-card" onClick=${data.onClick} data-kind=${data.kind} style=${{ '--node-colour': data.kindColour }}>
      <${Handle} type="target" position=${Position.Left} className="graph-handle-hidden" />
      <div className="graph-component-card-name">${data.label}</div>
      <div className="graph-component-card-count">${data.count} ${data.count === 1 ? 'node' : 'nodes'}</div>
      <${Handle} type="source" position=${Position.Right} className="graph-handle-hidden" />
    </div>
  `
}

// Level 2/3: node card node
function NodeCardNode({ data }) {
  return html`
    <div className=${`graph-node-card${data.faded ? ' graph-faded' : ''}${data.focal ? ' graph-focal' : ''} node-coloured`} style=${templateColourStyle(data.template)} onClick=${data.onClick}>
      ${data.parentLabel && html`<div className="graph-node-card-owner">${data.parentLabel}</div>`}
      <${Handle} type="target" position=${Position.Left} className="graph-handle-hidden" />
      <div className="graph-node-card-bar" />
      <div className="graph-node-card-body">
        <div className="graph-node-card-text">
          <div className="graph-node-card-name" title=${data.nodeId}>${data.label}</div>
          <div className="graph-node-card-component node-coloured" style=${{ '--node-colour': data.kindColour }}>${data.component}</div>
        </div>
        <div className="graph-node-card-type">
          <${TemplateBadge} name=${data.templateLabel} template=${data.template} />
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
      <${Handle} type="source" position=${Position.Right} className="graph-handle-hidden" />
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
