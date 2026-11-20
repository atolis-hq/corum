import React from 'react'
import { navigate, Icon, StateTag } from './ui.js'
import { TableScroll, PropertiesTable } from './properties.js'
import {
  localSchemaName, localEnumName, fieldLocalName, enumValueEnumName, enumValueDisplayName,
  enumValueDescription, refName, refLocalSchemaName, fieldType, fieldRequirement,
  fieldCardinality, fieldDetails, linkSummary, buildSchemaModel,
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
  return React.createElement(React.Fragment, null, React.createElement("div", {
    className: "field-row nested mapping-meta",
    style: {
      '--field-depth': depth
    }
  }, React.createElement("div", {
    className: "gutter"
  }), React.createElement("div", {
    className: "name"
  }, "_key"), React.createElement("div", {
    className: "type"
  }, keyDisplay), React.createElement("div", {
    className: "cardinality"
  }, "-"), React.createElement("div", {
    className: "req"
  }, "-"), React.createElement("div", {
    className: "state"
  }), React.createElement("div", {
    className: "lineage"
  })), React.createElement("div", {
    className: "field-row nested mapping-meta",
    style: {
      '--field-depth': depth
    }
  }, React.createElement("div", {
    className: "gutter",
    style: valueCanExpand ? {
      cursor: 'pointer'
    } : undefined,
    onClick: valueCanExpand ? () => setValueCollapsed(prev => !prev) : undefined
  }, valueCanExpand && React.createElement(Icon, {
    name: valueCollapsed ? 'caret-right' : 'caret-down',
    size: 11
  })), React.createElement("div", {
    className: "name"
  }, "_value"), React.createElement("div", {
    className: "type"
  }, valueDisplay), React.createElement("div", {
    className: "cardinality"
  }, valueCollection ?? 'one'), React.createElement("div", {
    className: "req"
  }, "-"), React.createElement("div", {
    className: "state"
  }), React.createElement("div", {
    className: "lineage"
  })), valueCanExpand && !valueCollapsed && (valueCanExpandSchema ? React.createElement(SchemaFieldRows, {
    schemaNodeId: valueSchema.id,
    model: model,
    depth: depth + 1,
    visited: nextVisited,
    edges: edges,
    compact: compact
  }) : React.createElement(MappingInlineRows, {
    mappingNode: valueMappingNode,
    depth: depth + 1,
    model: model,
    edges: edges,
    compact: compact,
    visited: nextVisited
  })));
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
    return React.createElement("div", {
      className: "field-row"
    }, React.createElement("div", null), React.createElement("div", {
      className: "label-sm"
    }, "No fields."), React.createElement("div", null), React.createElement("div", null), React.createElement("div", null), React.createElement("div", null), React.createElement("div", null));
  }
  return React.createElement(React.Fragment, null, fields.map(field => {
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
    return React.createElement(React.Fragment, {
      key: field.id
    }, React.createElement("div", {
      className: `field-row${depth > 0 ? ' nested' : ''}`,
      style: {
        '--field-depth': depth
      }
    }, React.createElement("div", {
      className: "gutter",
      style: isExpandable ? {
        cursor: 'pointer'
      } : undefined,
      onClick: isExpandable ? () => setCollapsed(prev => {
        const next = new Set(prev);
        next.has(field.id) ? next.delete(field.id) : next.add(field.id);
        return next;
      }) : undefined
    }, isExpandable && React.createElement(Icon, {
      name: isCollapsed ? 'caret-right' : 'caret-down',
      size: 11
    })), React.createElement("div", {
      className: "name"
    }, compact ? name : `${prefix}${name}`), React.createElement("div", {
      className: "type",
      title: typeFull !== typeDisplay ? typeFull : undefined
    }, typeDisplay), React.createElement("div", {
      className: "cardinality"
    }, canExpandMapping ? 'map' : fieldCardinality(field.properties)), React.createElement("div", {
      className: "req"
    }, fieldRequirement(field.properties)), React.createElement("div", {
      className: "state"
    }, React.createElement(StateTag, {
      state: field.state
    })), React.createElement("div", {
      className: "lineage"
    }, links.length > 0 ? links.map((edge, index) => {
      const link = linkSummary(edge, field.id);
      return React.createElement(React.Fragment, {
        key: edge.id
      }, index > 0 && React.createElement("span", {
        key: `sep-${edge.id}`
      }, ' '), React.createElement("a", {
        className: "node-ref-link",
        onClick: () => navigate(`/node?id=${encodeURIComponent(link.targetNodeId)}`),
        title: link.title
      }, link.direction, " ", link.label));
    }) : fieldDetails(field.properties, compact))), isExpandable && !isCollapsed && (canExpandMapping ? React.createElement(MappingInlineRows, {
      mappingNode: mappingNode,
      depth: depth + 1,
      model: model,
      edges: edges,
      compact: compact
    }) : React.createElement(React.Fragment, null, React.createElement(SchemaFieldRows, {
      schemaNodeId: childSchemaNode.id,
      model: model,
      prefix: childPrefix,
      depth: depth + 1,
      visited: nextVisited,
      edges: edges,
      overlayFields: overlayFields,
      overlayRefs: overlayRefs,
      compact: compact
    }), childGhostFields.length > 0 && React.createElement(GhostFieldRows, {
      fields: childGhostFields,
      overlayRefs: overlayRefs,
      prefix: childPrefix,
      depth: depth + 1,
      compact: compact
    }))));
  }));
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
  return React.createElement(React.Fragment, null, fields.map(field => {
    const isConflict = field.ghostState === 'ghost-conflict' || field.ghostState === 'local-modified';
    const refIndex = overlayRefs ? overlayRefs.indexOf(field.sourceRef) : 0;
    const stripeClass = isConflict ? 'overlay-conflict' : ghostStripeClass(Math.max(0, refIndex));
    const name = compact ? fieldLocalName(field.id) : prefix + fieldLocalName(field.id);
    const type = field.node.properties?.type || (field.node.properties?.['$ref'] ? refName(field.node.properties['$ref'], compact) : '-');
    return React.createElement("div", {
      key: field.id,
      className: `field-row overlay-ghost ${stripeClass}${depth > 0 ? ' nested' : ''}`,
      style: {
        '--field-depth': depth
      },
      title: `From ${field.sourceRef}`
    }, React.createElement("div", {
      className: "gutter"
    }, isConflict && React.createElement("span", {
      style: {
        color: '#c44',
        fontWeight: 700
      }
    }, "!")), React.createElement("div", {
      className: "name"
    }, name), React.createElement("div", {
      className: "type"
    }, type), React.createElement("div", {
      className: "cardinality"
    }, "-"), React.createElement("div", {
      className: "req"
    }, "-"), React.createElement("div", {
      className: "state"
    }, isConflict ? React.createElement("span", {
      className: "tag",
      style: {
        background: '#c4422222',
        color: '#c44'
      }
    }, "conflict") : React.createElement(StateTag, {
      state: field.node.state
    })), React.createElement("div", {
      className: "lineage"
    }, React.createElement("span", {
      className: "mono",
      style: {
        fontSize: 10.5,
        opacity: 0.7
      }
    }, field.sourceRef)));
  }));
}
export function OverlayLegend({
  overlayRefs
}) {
  if (!overlayRefs || overlayRefs.length === 0) return null;
  const colours = ['var(--accent)', '#5c7aa8'];
  return React.createElement("div", {
    className: "overlay-legend"
  }, React.createElement("span", {
    className: "label-xs"
  }, "Incoming:"), overlayRefs.map((ref, index) => React.createElement("span", {
    key: ref,
    className: "overlay-legend-item"
  }, React.createElement("span", {
    className: "overlay-legend-swatch",
    style: {
      background: colours[index % colours.length]
    }
  }), React.createElement("span", {
    className: "mono",
    style: {
      fontSize: 10.5
    }
  }, ref))), React.createElement("span", {
    className: "overlay-legend-item",
    style: {
      color: '#c44'
    }
  }, React.createElement("span", {
    className: "overlay-legend-swatch",
    style: {
      background: '#c44'
    }
  }), "conflict"));
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
    const valuesByEnum = new Map();
    for (const node of allNodes ?? []) {
      if (node.template !== 'EnumValue') continue;
      const enumName = enumValueEnumName(node.id);
      if (!enumName) continue;
      if (!valuesByEnum.has(enumName)) valuesByEnum.set(enumName, []);
      valuesByEnum.get(enumName).push(node);
    }
    return React.createElement("div", {
      className: "card enum-card"
    }, React.createElement("div", {
      className: "card-head"
    }, isShared ? 'Shared Enums' : 'Enums'), React.createElement("div", {
      className: "card-body"
    }, nodes.map(enumNode => {
      const enumName = localEnumName(enumNode.id);
      const values = valuesByEnum.get(enumName) ?? [];
      return React.createElement("div", {
        key: enumNode.id,
        className: "enum-section",
        id: anchorIdForNode ? anchorIdForNode(enumNode.id) : undefined
      }, React.createElement("div", {
        className: "schema-section-head"
      }, React.createElement("div", null, React.createElement("div", {
        className: "schema-title"
      }, enumName), enumNode.properties?.description && React.createElement("div", {
        className: "label-sm"
      }, enumNode.properties.description)), React.createElement("div", {
        className: "label-sm mono"
      }, enumNode.id)), React.createElement(TableScroll, {
        className: "enum-table"
      }, React.createElement("div", {
        className: "enum-row enum-row-head"
      }, React.createElement("div", {
        className: "label-xs"
      }, "Name"), React.createElement("div", {
        className: "label-xs"
      }, "Description"), React.createElement("div", {
        className: "label-xs"
      }, "Status")), values.length === 0 ? React.createElement("div", {
        className: "enum-row"
      }, React.createElement("div", {
        className: "label-sm"
      }, "No values."), React.createElement("div", null), React.createElement("div", null)) : values.map(value => React.createElement("div", {
        key: value.id,
        className: "enum-row"
      }, React.createElement("div", {
        className: "name"
      }, enumValueDisplayName(value)), React.createElement("div", {
        className: "description"
      }, enumValueDescription(value)), React.createElement("div", {
        className: "state"
      }, React.createElement(StateTag, {
        state: value.state
      }))))));
    })));
  }
  if (title === 'Schema') {
    const model = buildSchemaModel(nodes, allNodes ?? nodes);
    return React.createElement("div", {
      className: "card schema-card"
    }, React.createElement("div", {
      className: "card-head"
    }, isShared ? 'Shared Schemas' : 'Schemas'), React.createElement("div", {
      className: "card-body"
    }, model.topSchemas.map(schema => {
      const schemaName = localSchemaName(schema.id);
      const ghostFields = overlayFieldsForSchema(overlayFields, schema.id);
      return React.createElement("div", {
        key: schema.id,
        className: "schema-section",
        id: anchorIdForNode ? anchorIdForNode(schema.id) : undefined
      }, React.createElement("div", {
        className: "schema-section-head"
      }, React.createElement("div", {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8
        }
      }, React.createElement("div", {
        className: "schema-title"
      }, schemaName), isShared && React.createElement("span", {
        className: "tag",
        style: {
          fontSize: 10,
          padding: '1px 6px',
          background: 'var(--ink-4)',
          color: 'var(--bg)'
        }
      }, "shared"), schema.properties?.description && React.createElement("div", {
        className: "label-sm"
      }, schema.properties.description)), React.createElement("div", {
        className: "label-sm mono"
      }, schema.id)), ghostFields.length > 0 && React.createElement(OverlayLegend, {
        overlayRefs: overlayRefs
      }), React.createElement(TableScroll, {
        className: "field-table"
      }, React.createElement("div", {
        className: "field-row field-row-head"
      }, React.createElement("div", null), React.createElement("div", {
        className: "label-xs"
      }, "Name"), React.createElement("div", {
        className: "label-xs"
      }, "Type"), React.createElement("div", {
        className: "label-xs"
      }, "Collection"), React.createElement("div", {
        className: "label-xs"
      }, "Req"), React.createElement("div", {
        className: "label-xs"
      }, "State"), React.createElement("div", {
        className: "label-xs"
      }, "Links")), React.createElement(SchemaFieldRows, {
        schemaNodeId: schema.id,
        model: model,
        visited: new Set(),
        edges: edges ?? [],
        overlayFields: overlayFields,
        overlayRefs: overlayRefs,
        compact: compact
      }), ghostFields.length > 0 && React.createElement(GhostFieldRows, {
        fields: ghostFields,
        overlayRefs: overlayRefs,
        compact: compact
      })));
    })));
  }
  return React.createElement("div", {
    className: "card"
  }, React.createElement("div", {
    className: "card-head"
  }, title), React.createElement("div", {
    className: "card-body"
  }, nodes.map(node => React.createElement("div", {
    key: node.id,
    id: anchorIdForNode ? anchorIdForNode(node.id) : undefined,
    style: {
      borderBottom: '1px dashed var(--rule)'
    }
  }, React.createElement("div", {
    className: "mono",
    style: {
      padding: '8px 14px 0',
      color: 'var(--ink-3)',
      fontSize: 11,
      fontWeight: 600
    }
  }, node.id.split('.').pop()), React.createElement(PropertiesTable, {
    properties: node.properties
  })))));
}
