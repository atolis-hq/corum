import { html } from './html.js'
import { StateTag } from './ui.js'
import { TableScroll, PropertiesTable } from './properties.js'
import {
  localSchemaName, localEnumName, enumValueEnumName, enumValueDisplayName,
  enumValueDescription, buildSchemaModel,
} from './schema-model.js'
import { SchemaFieldRows, GhostFieldRows, OverlayLegend, overlayFieldsForSchema } from './schema-rows.js'

export { MappingInlineRows, SchemaFieldRows, ghostStripeClass, overlayFieldsForSchema, GhostFieldRows, OverlayLegend } from './schema-rows.js'

function EnumCard({ nodes, allNodes, anchorIdForNode, isShared }) {
  const valuesByEnum = new Map();
  for (const node of allNodes ?? []) {
    if (node.template !== 'EnumValue') continue;
    const enumName = enumValueEnumName(node.id);
    if (!enumName) continue;
    if (!valuesByEnum.has(enumName)) valuesByEnum.set(enumName, []);
    valuesByEnum.get(enumName).push(node);
  }
  return html`
    <div className="card enum-card">
      <div className="card-head">${isShared ? 'Shared Enums' : 'Enums'}</div>
      <div className="card-body">
        ${nodes.map(enumNode => {
          const enumName = localEnumName(enumNode.id);
          const values = valuesByEnum.get(enumName) ?? [];
          return html`
            <div key=${enumNode.id} className="enum-section" id=${anchorIdForNode ? anchorIdForNode(enumNode.id) : undefined}>
              <div className="schema-section-head">
                <div>
                  <div className="schema-title">${enumName}</div>
                  ${enumNode.properties?.description && html`<div className="label-sm">${enumNode.properties.description}</div>`}
                </div>
                <div className="label-sm mono">${enumNode.id}</div>
              </div>
              <${TableScroll} className="enum-table">
                <div className="enum-row enum-row-head">
                  <div className="label-xs">Name</div>
                  <div className="label-xs">Description</div>
                  <div className="label-xs">Status</div>
                </div>
                ${values.length === 0
                  ? html`
                    <div className="enum-row">
                      <div className="label-sm">No values.</div>
                      <div></div>
                      <div></div>
                    </div>
                  `
                  : values.map(value => html`
                    <div key=${value.id} className="enum-row">
                      <div className="name">${enumValueDisplayName(value)}</div>
                      <div className="description">${enumValueDescription(value)}</div>
                      <div className="state"><${StateTag} state=${value.state} /></div>
                    </div>
                  `)}
              <//>
            </div>
          `
        })}
      </div>
    </div>
  `
}

function SchemaListCard({ nodes, allNodes, edges, anchorIdForNode, overlayFields, overlayRefs, isShared, compact }) {
  const model = buildSchemaModel(nodes, allNodes ?? nodes);
  return html`
    <div className="card schema-card">
      <div className="card-head">${isShared ? 'Shared Schemas' : 'Schemas'}</div>
      <div className="card-body">
        ${model.topSchemas.map(schema => {
          const schemaName = localSchemaName(schema.id);
          const ghostFields = overlayFieldsForSchema(overlayFields, schema.id);
          return html`
            <div key=${schema.id} className="schema-section" id=${anchorIdForNode ? anchorIdForNode(schema.id) : undefined}>
              <div className="schema-section-head">
                <div style=${{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="schema-title">${schemaName}</div>
                  ${isShared && html`
                    <span className="tag shared-tag">shared</span>
                  `}
                  ${schema.properties?.description && html`<div className="label-sm">${schema.properties.description}</div>`}
                </div>
                <div className="label-sm mono">${schema.id}</div>
              </div>
              ${ghostFields.length > 0 && html`<${OverlayLegend} overlayRefs=${overlayRefs} />`}
              <${TableScroll} className="field-table">
                <div className="field-row field-row-head">
                  <div></div>
                  <div className="label-xs">Name</div>
                  <div className="label-xs">Type</div>
                  <div className="label-xs">Collection</div>
                  <div className="label-xs">Req</div>
                  <div className="label-xs">State</div>
                  <div className="label-xs">Links</div>
                </div>
                <${SchemaFieldRows}
                  schemaNodeId=${schema.id}
                  model=${model}
                  visited=${new Set()}
                  edges=${edges ?? []}
                  overlayFields=${overlayFields}
                  overlayRefs=${overlayRefs}
                  compact=${compact}
                />
                ${ghostFields.length > 0 && html`<${GhostFieldRows} fields=${ghostFields} overlayRefs=${overlayRefs} compact=${compact} />`}
              <//>
            </div>
          `
        })}
      </div>
    </div>
  `
}

export function SchemaCard({
  title,
  nodes,
  allNodes,
  edges,
  anchorIdForNode,
  overlayFields,
  overlayRefs,
  isShared,
  compact = false
}) {
  if (!nodes || nodes.length === 0) return null;
  if (title === 'EnumDefinition') {
    return html`<${EnumCard} nodes=${nodes} allNodes=${allNodes} anchorIdForNode=${anchorIdForNode} isShared=${isShared} />`
  }
  if (title === 'Schema') {
    return html`<${SchemaListCard} nodes=${nodes} allNodes=${allNodes} edges=${edges} anchorIdForNode=${anchorIdForNode} overlayFields=${overlayFields} overlayRefs=${overlayRefs} isShared=${isShared} compact=${compact} />`
  }
  return html`
    <div className="card">
      <div className="card-head">${title}</div>
      <div className="card-body">
        ${nodes.map(node => html`
          <div key=${node.id} id=${anchorIdForNode ? anchorIdForNode(node.id) : undefined} className="shared-head">
            <div className="mono shared-head-label" style=${{ padding: '8px 14px 0' }}>
              ${node.id.split('.').pop()}
            </div>
            <${PropertiesTable} properties=${node.properties} />
          </div>
        `)}
      </div>
    </div>
  `
}
