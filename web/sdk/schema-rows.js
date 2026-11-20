import React from 'react'
import { html } from './html.js'
import { navigate, Icon, StateTag } from './ui.js'
import {
  fieldLocalName, refName, refLocalSchemaName, fieldType, fieldRequirement,
  fieldCardinality, fieldDetails, linkSummary,
} from './schema-model.js'

export function MappingInlineRows({
  mappingNode,
  depth,
  model,
  edges,
  compact,
  visited = new Set()
}) {
  const [valueCollapsed, setValueCollapsed] = React.useState(false);
  const keyType = mappingNode.properties?.['key-type'];
  const keyRef = mappingNode.properties?.['key-ref'];
  const valueType = mappingNode.properties?.['type'];
  const valueRef = mappingNode.properties?.['$ref'];
  const valueRefNodeId = valueRef && typeof valueRef === 'object' && 'nodeId' in valueRef ? valueRef.nodeId : null;
  const valueLocalRef = valueRef ? refLocalSchemaName(valueRef) : null;
  const valueSchema = valueLocalRef && model.schemasByName.has(valueLocalRef) ? model.schemasByName.get(valueLocalRef) : null;
  const valueMappingNode = valueRefNodeId && model.mappingsByNodeId?.has(valueRefNodeId) ? model.mappingsByNodeId.get(valueRefNodeId) : null;
  const valueCanExpandSchema = !!valueSchema && !visited.has(valueLocalRef);
  const valueCanExpandMapping = !!valueMappingNode && !visited.has(valueRefNodeId);
  const valueCanExpand = valueCanExpandSchema || valueCanExpandMapping;
  const keyDisplay = keyType ?? (keyRef ? refName(keyRef, compact) : 'string');
  const valueDisplay = valueType ?? (valueRef ? refName(valueRef, compact) : '-');
  const valueCollection = mappingNode.properties?.['value-collection'];
  const nextVisited = new Set(visited);
  if (valueLocalRef) nextVisited.add(valueLocalRef);
  if (valueRefNodeId) nextVisited.add(valueRefNodeId);
  const nested = valueCanExpandSchema
    ? html`<${SchemaFieldRows} schemaNodeId=${valueSchema.id} model=${model} depth=${depth + 1} visited=${nextVisited} edges=${edges} compact=${compact} />`
    : html`<${MappingInlineRows} mappingNode=${valueMappingNode} depth=${depth + 1} model=${model} edges=${edges} compact=${compact} visited=${nextVisited} />`
  return html`
    <${React.Fragment}>
      <div className="field-row nested mapping-meta" style=${{ '--field-depth': depth }}>
        <div className="gutter"></div>
        <div className="name">_key</div>
        <div className="type">${keyDisplay}</div>
        <div className="cardinality">-</div>
        <div className="req">-</div>
        <div className="state"></div>
        <div className="lineage"></div>
      </div>
      <div className="field-row nested mapping-meta" style=${{ '--field-depth': depth }}>
        <div
          className="gutter"
          style=${valueCanExpand ? { cursor: 'pointer' } : undefined}
          onClick=${valueCanExpand ? () => setValueCollapsed(prev => !prev) : undefined}
        >
          ${valueCanExpand && html`<${Icon} name=${valueCollapsed ? 'caret-right' : 'caret-down'} size=${11} />`}
        </div>
        <div className="name">_value</div>
        <div className="type">${valueDisplay}</div>
        <div className="cardinality">${valueCollection ?? 'one'}</div>
        <div className="req">-</div>
        <div className="state"></div>
        <div className="lineage"></div>
      </div>
      ${valueCanExpand && !valueCollapsed && nested}
    <//>
  `
}

export function SchemaFieldRows({
  schemaNodeId,
  model,
  prefix = '',
  depth = 0,
  visited = new Set(),
  edges = [],
  overlayFields,
  overlayRefs,
  compact = false
}) {
  const [collapsed, setCollapsed] = React.useState(new Set());
  const fields = model.fieldsBySchema.get(schemaNodeId) ?? [];
  if (fields.length === 0) {
    return html`
      <div className="field-row">
        <div></div>
        <div className="label-sm">No fields.</div>
        <div></div><div></div><div></div><div></div><div></div>
      </div>
    `
  }
  return html`<${React.Fragment}>${fields.map(field => {
    const name = fieldLocalName(field.id);
    const ref = field.properties?.['$ref'];
    const localRef = refLocalSchemaName(ref);
    const refNodeId = ref && typeof ref === 'object' && 'nodeId' in ref ? ref.nodeId : null;
    const mappingNode = refNodeId ? model.mappingsByNodeId?.get(refNodeId) ?? null : null;
    const canExpandMapping = !!mappingNode;
    // Prefer exact node ID lookup to avoid same-named schemas from different clusters
    const childSchemaNode = !canExpandMapping ? refNodeId ? model.schemasById?.get(refNodeId) ?? null : localRef ? model.schemasByName.get(localRef) ?? null : null : null;
    const childHasFields = childSchemaNode ? (model.fieldsBySchema.get(childSchemaNode.id) ?? []).length > 0 : false;
    const canExpand = !!childSchemaNode && !visited.has(childSchemaNode.id) && childHasFields;
    const isExpandable = canExpand || canExpandMapping;
    const childGhostFields = childSchemaNode ? overlayFieldsForSchema(overlayFields, childSchemaNode.id) : [];
    const c = field.properties?.collection;
    const childPrefix = `${prefix}${name}${c === 'array' ? '[].' : '.'}`;
    const nextVisited = new Set(visited);
    nextVisited.add(schemaNodeId);
    const links = edges.filter(e => (e.from === field.id || e.to === field.id) && e.type !== 'has-field' && e.type !== 'has-value');
    const isCollapsed = collapsed.has(field.id);
    const typeDisplay = fieldType(field.properties, compact);
    const typeFull = compact ? fieldType(field.properties, false) : null;
    const toggle = () => setCollapsed(prev => {
      const next = new Set(prev);
      next.has(field.id) ? next.delete(field.id) : next.add(field.id);
      return next;
    });
    const linkCells = links.map((edge, index) => {
      const link = linkSummary(edge, field.id);
      return html`
        <${React.Fragment} key=${edge.id}>
          ${index > 0 && html`<span key=${`sep-${edge.id}`}>${' '}</span>`}
          <a className="node-ref-link" onClick=${() => navigate(`/node?id=${encodeURIComponent(link.targetNodeId)}`)} title=${link.title}>${link.direction} ${link.label}</a>
        <//>
      `
    });
    const children = canExpandMapping
      ? html`<${MappingInlineRows} mappingNode=${mappingNode} depth=${depth + 1} model=${model} edges=${edges} compact=${compact} />`
      : html`
        <${React.Fragment}>
          <${SchemaFieldRows}
            schemaNodeId=${childSchemaNode?.id}
            model=${model}
            prefix=${childPrefix}
            depth=${depth + 1}
            visited=${nextVisited}
            edges=${edges}
            overlayFields=${overlayFields}
            overlayRefs=${overlayRefs}
            compact=${compact}
          />
          ${childGhostFields.length > 0 && html`<${GhostFieldRows} fields=${childGhostFields} overlayRefs=${overlayRefs} prefix=${childPrefix} depth=${depth + 1} compact=${compact} />`}
        <//>
      `
    return html`
      <${React.Fragment} key=${field.id}>
        <div className=${`field-row${depth > 0 ? ' nested' : ''}`} style=${{ '--field-depth': depth }}>
          <div
            className="gutter"
            style=${isExpandable ? { cursor: 'pointer' } : undefined}
            onClick=${isExpandable ? toggle : undefined}
          >
            ${isExpandable && html`<${Icon} name=${isCollapsed ? 'caret-right' : 'caret-down'} size=${11} />`}
          </div>
          <div className="name">${compact ? name : `${prefix}${name}`}</div>
          <div className="type" title=${typeFull !== typeDisplay ? typeFull : undefined}>${typeDisplay}</div>
          <div className="cardinality">${canExpandMapping ? 'map' : fieldCardinality(field.properties)}</div>
          <div className="req">${fieldRequirement(field.properties)}</div>
          <div className="state"><${StateTag} state=${field.state} /></div>
          <div className="lineage">${links.length > 0 ? linkCells : fieldDetails(field.properties, compact)}</div>
        </div>
        ${isExpandable && !isCollapsed && children}
      <//>
    `
  })}<//>`
}

// Max 2 distinct stripe colours — OverlayLegend also only renders 2 entries.
export function ghostStripeClass(index) {
  if (index === 0) return 'overlay-stripe-0';
  if (index === 1) return 'overlay-stripe-1';
  return 'overlay-stripe-0';
}

export function overlayFieldsForSchema(overlayFields, schemaNodeId) {
  if (!overlayFields) return [];
  const prefix = schemaNodeId + '.fields.';
  return overlayFields.filter(field => field.id.startsWith(prefix));
}

export function GhostFieldRows({
  fields,
  overlayRefs,
  prefix = '',
  depth = 0,
  compact = false
}) {
  return html`<${React.Fragment}>${fields.map(field => {
    const isConflict = field.ghostState === 'ghost-conflict' || field.ghostState === 'local-modified';
    const refIndex = overlayRefs ? overlayRefs.indexOf(field.sourceRef) : 0;
    const stripeClass = isConflict ? 'overlay-conflict' : ghostStripeClass(Math.max(0, refIndex));
    const name = compact ? fieldLocalName(field.id) : prefix + fieldLocalName(field.id);
    const type = field.node.properties?.type || (field.node.properties?.['$ref'] ? refName(field.node.properties['$ref'], compact) : '-');
    return html`
      <div
        key=${field.id}
        className=${`field-row overlay-ghost ${stripeClass}${depth > 0 ? ' nested' : ''}`}
        style=${{ '--field-depth': depth }}
        title=${`From ${field.sourceRef}`}
      >
        <div className="gutter">
          ${isConflict && html`<span style=${{ color: '#c44', fontWeight: 700 }}>!</span>`}
        </div>
        <div className="name">${name}</div>
        <div className="type">${type}</div>
        <div className="cardinality">-</div>
        <div className="req">-</div>
        <div className="state">
          ${isConflict
            ? html`<span className="tag" style=${{ background: '#c4422222', color: '#c44' }}>conflict</span>`
            : html`<${StateTag} state=${field.node.state} />`}
        </div>
        <div className="lineage">
          <span className="mono" style=${{ fontSize: 10.5, opacity: 0.7 }}>${field.sourceRef}</span>
        </div>
      </div>
    `
  })}<//>`
}

export function OverlayLegend({ overlayRefs }) {
  if (!overlayRefs || overlayRefs.length === 0) return null;
  const colours = ['var(--accent)', '#5c7aa8'];
  return html`
    <div className="overlay-legend">
      <span className="label-xs">Incoming:</span>
      ${overlayRefs.map((ref, index) => html`
        <span key=${ref} className="overlay-legend-item">
          <span className="overlay-legend-swatch" style=${{ background: colours[index % colours.length] }}></span>
          <span className="mono" style=${{ fontSize: 10.5 }}>${ref}</span>
        </span>
      `)}
      <span className="overlay-legend-item" style=${{ color: '#c44' }}>
        <span className="overlay-legend-swatch" style=${{ background: '#c44' }}></span>
        conflict
      </span>
    </div>
  `
}
