/* Shared UI primitives for the browser app. */

function navigate(path) {
  window.location.hash = path;
}

function BrandMark({ size = 24, color = 'currentColor' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 110 110" aria-hidden="true">
      <g transform="translate(55 55)" stroke={color} fill={color} strokeLinecap="round">
        <path d="M43.8 3.8A44 44 0 0 1 38.1 22" fill="none" strokeWidth="7.5" opacity="0.55" />
        <path d="M38.1 22a44 44 0 1 1-19.5-61" fill="none" strokeWidth="7.5" />
        <circle r="3" opacity="0.3" />
        <circle r="1.8" />
        <path strokeWidth="3" d="M0 0v-26" /><circle cy="-26" r="4.5" opacity="0.85" />
        <path strokeWidth="3" d="m0 0 13-22" /><circle cx="13" cy="-22" r="3.5" opacity="0.78" />
        <path strokeWidth="3" d="m0 0 23-9" /><circle cx="23" cy="-9" r="4" opacity="0.72" />
        <path strokeWidth="2.5" opacity="0.7" d="m0 0 21 11" /><circle cx="21" cy="11" r="3" opacity="0.6" />
        <path strokeWidth="2.5" opacity="0.55" d="m0 0 9 23" /><circle cx="9" cy="23" r="3.5" opacity="0.5" />
        <path strokeWidth="2.5" opacity="0.55" d="m0 0-11 22" /><circle cx="-11" cy="22" r="3" opacity="0.48" />
        <path strokeWidth="3" d="m0 0-26 3" /><circle cx="-26" cy="3" r="4" opacity="0.75" />
        <path strokeWidth="3" d="m0 0-20-17" /><circle cx="-20" cy="-17" r="4.5" opacity="0.85" />
        <path strokeWidth="2" opacity="0.66" d="m0 0-8-23" /><circle cx="-8" cy="-23" r="3" opacity="0.62" />
      </g>
    </svg>
  );
}

function Icon({ name, size }) {
  const style = size ? { fontSize: size } : undefined;
  return <i className={`fa-solid fa-${name}`} style={style} aria-hidden="true" />;
}

function StateTag({ state }) {
  return <span className={`tag state-${state}`}>{state}</span>;
}

function StabilityTag({ stability }) {
  return <span className={`tag stability-${stability}`}>{stability}</span>;
}

function Chip({ children, title }) {
  return <span className="chip" title={title}>{children}</span>;
}

function TemplateBadge({ name, colour }) {
  const style = colour ? { background: colour } : { background: 'var(--ink-4)' };
  return <span className="template-badge" style={style}>{name}</span>;
}

function PropertyValue({ value, onNavigate }) {
  if (value === null || value === undefined) return <span className="prop-empty">-</span>;

  if (typeof value === 'object' && 'display' in value && 'nodeId' in value) {
    return (
      <a className="node-ref-link" onClick={() => onNavigate && onNavigate(value.nodeId)}>
        {value.display}
      </a>
    );
  }

  if (typeof value === 'object' && 'display' in value) {
    return <span>{value.display}</span>;
  }

  if (Array.isArray(value)) {
    return <span>{value.length === 1 ? '1 item' : `${value.length} items`}</span>;
  }

  if (typeof value === 'object') {
    return <span className="prop-empty">-</span>;
  }

  return <span>{String(value)}</span>;
}

function buildPropertyRows(entries, onNavigate, depth = 0, parentPath = '') {
  return entries.flatMap(([key, value], index) => {
    const rowPath = parentPath ? `${parentPath}.${key}` : key;
    const rowKey = `${rowPath}:${index}`;

    if (Array.isArray(value)) {
      const rows = [{
        key: rowKey,
        label: key,
        depth,
        value: <PropertyValue value={value} onNavigate={onNavigate} />,
      }];

      value.forEach((item, itemIndex) => {
        const itemPath = `${rowPath}[${itemIndex}]`;
        if (item && typeof item === 'object' && !('display' in item) && !Array.isArray(item)) {
          rows.push({
            key: `${itemPath}:group`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: <span className="prop-empty">-</span>,
          });
          rows.push(...buildPropertyRows(Object.entries(item), onNavigate, depth + 2, itemPath));
        } else {
          rows.push({
            key: `${itemPath}:value`,
            label: `[${itemIndex}]`,
            depth: depth + 1,
            value: <PropertyValue value={item} onNavigate={onNavigate} />,
          });
        }
      });

      return rows;
    }

    if (value && typeof value === 'object' && !('display' in value)) {
      return [
        {
          key: rowKey,
          label: key,
          depth,
          value: <span className="prop-empty">-</span>,
        },
        ...buildPropertyRows(Object.entries(value), onNavigate, depth + 1, rowPath),
      ];
    }

    return [{
      key: rowKey,
      label: key,
      depth,
      value: <PropertyValue value={value} onNavigate={onNavigate} />,
    }];
  });
}

function PropertiesTable({ properties, onNavigate }) {
  const entries = Object.entries(properties ?? {});
  const rows = buildPropertyRows(entries, onNavigate);
  if (entries.length === 0) {
    return <p className="label-sm" style={{ padding: '10px 14px' }}>No properties.</p>;
  }

  return (
    <table className="prop-table">
      <tbody>
        {rows.map(row => (
          <tr key={row.key} className={`prop-row${row.depth > 0 ? ' nested' : ''}`}>
            <td className="mono prop-key-cell">
              <span className="prop-key-label" style={{ '--prop-depth': row.depth }}>
                {row.label}
              </span>
            </td>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function localSchemaName(nodeId) {
  const marker = '.schemas.';
  const idx = nodeId.indexOf(marker);
  if (idx < 0) return nodeId.split('.').pop();
  return nodeId.slice(idx + marker.length).split('.')[0];
}

function fieldSchemaName(nodeId) {
  const schemaMarker = '.schemas.';
  const fieldMarker = '.fields.';
  const schemaIdx = nodeId.indexOf(schemaMarker);
  const fieldIdx = nodeId.indexOf(fieldMarker);
  if (fieldIdx < 0) return null;
  if (schemaIdx < 0) {
    // Standalone Schema node: e.g. user.Schema.User.fields.email → 'User'
    return nodeId.slice(0, fieldIdx).split('.').pop() ?? null;
  }
  return nodeId.slice(schemaIdx + schemaMarker.length, fieldIdx);
}

function fieldLocalName(nodeId) {
  const marker = '.fields.';
  const idx = nodeId.indexOf(marker);
  return idx < 0 ? nodeId.split('.').pop() : nodeId.slice(idx + marker.length);
}

function clusterNodeId(nodeId) {
  const sectionMatch = nodeId.match(/\.(schemas|enums|operations)\./);
  if (sectionMatch && sectionMatch.index !== undefined) {
    return nodeId.slice(0, sectionMatch.index);
  }
  return nodeId.replace(/\.(fields|values)\.[^.]+$/, '');
}

function refName(ref) {
  if (typeof ref === 'string') return ref.replace(/^#\/(schemas|enums)\//, '');
  if (ref && typeof ref === 'object' && 'display' in ref) return ref.display;
  return String(ref);
}

function refLocalSchemaName(ref) {
  if (typeof ref !== 'string') {
    if (ref && typeof ref === 'object' && 'display' in ref) {
      const d = String(ref.display);
      const dot = d.lastIndexOf('.');
      return dot >= 0 ? d.slice(dot + 1) : d;
    }
    return null;
  }
  if (ref.startsWith('#/schemas/')) return ref.slice(10);
  // Global node ID (e.g. "component.Schema.TypeName") — local name is the final segment
  const lastDot = ref.lastIndexOf('.');
  return lastDot >= 0 ? ref.slice(lastDot + 1) : null;
}

function fieldType(properties) {
  const c = properties?.collection;
  const suffix = c === 'array' ? '[]' : c === 'map' ? '{}' : c === 'map-of-map' ? '{{}}' : c === 'map-of-array' ? '{[]}' : '';
  if (properties?.type) return `${properties.type}${suffix}`;
  const ref = properties?.['$ref'];
  if (ref) return `${refName(ref)}${suffix}`;
  return suffix ? `unknown${suffix}` : 'unknown';
}

function fieldRequirement(properties) {
  if (properties?.nullable === false) return 'required';
  if (properties?.nullable === true) return 'optional';
  return '-';
}

function fieldCardinality(properties) {
  return properties?.collection ?? 'one';
}

function fieldDetails(properties) {
  const parts = [];
  const ref = properties?.['$ref'];
  if (ref) parts.push(`ref ${refName(ref)}`);
  if (properties?.description) parts.push(properties.description);
  return parts.length > 0 ? parts.join(' · ') : '-';
}

function linkSummary(edge, fieldId) {
  const outgoing = edge.from === fieldId;
  const otherNodeId = outgoing ? edge.to : edge.from;
  const direction = outgoing ? '->' : '<-';
  const relation = edge.type === 'maps-to' ? '' : `${edge.type} `;
  return {
    direction,
    label: `${relation}${fieldLocalName(otherNodeId)}`,
    targetNodeId: clusterNodeId(otherNodeId),
    title: otherNodeId,
  };
}

function localEnumName(nodeId) {
  const marker = '.enums.';
  const idx = nodeId.indexOf(marker);
  if (idx < 0) return nodeId.split('.').pop();
  return nodeId.slice(idx + marker.length).split('.')[0];
}

function enumValueEnumName(nodeId) {
  const enumMarker = '.enums.';
  const valueMarker = '.values.';
  const enumIdx = nodeId.indexOf(enumMarker);
  const valueIdx = nodeId.indexOf(valueMarker);
  if (valueIdx < 0) return null;
  if (enumIdx < 0) {
    // Standalone EnumDefinition node: e.g. component.EnumDefinition.Name.values.X → 'Name'
    return nodeId.slice(0, valueIdx).split('.').pop() ?? null;
  }
  return nodeId.slice(enumIdx + enumMarker.length, valueIdx);
}

function enumValueDisplayName(node) {
  return node.properties?.name ?? node.id.split('.').pop();
}

function enumValueDescription(node) {
  return node.properties?.description ?? '-';
}

function buildSchemaModel(schemaNodes, allNodes) {
  // Include all Schema nodes from allNodes so canExpand works for included/referenced schemas
  const allSchemaNodes = (allNodes ?? []).filter(n => n.template === 'Schema');
  const schemasByName = new Map(allSchemaNodes.map(node => [localSchemaName(node.id), node]));
  // Ensure the primary schemaNodes are always present (they may not be in allNodes)
  for (const node of schemaNodes) schemasByName.set(localSchemaName(node.id), node);
  const fieldsBySchema = new Map();
  const referencedSchemas = new Set();

  for (const node of allNodes ?? []) {
    if (node.template !== 'Field') continue;
    const schemaName = fieldSchemaName(node.id);
    if (!schemaName) continue;
    if (!fieldsBySchema.has(schemaName)) fieldsBySchema.set(schemaName, []);
    fieldsBySchema.get(schemaName).push(node);

    const ref = node.properties?.['$ref'];
    const localName = refLocalSchemaName(ref);
    if (localName && schemasByName.has(localName)) {
      referencedSchemas.add(localName);
    }
  }

  const topSchemas = schemaNodes.filter(node => !referencedSchemas.has(localSchemaName(node.id)));
  return {
    schemasByName,
    fieldsBySchema,
    topSchemas: topSchemas.length > 0 ? topSchemas : schemaNodes,
  };
}

function SchemaFieldRows({ schemaName, model, prefix = '', depth = 0, visited = new Set(), edges = [], overlayFields, overlayRefs }) {
  const fields = model.fieldsBySchema.get(schemaName) ?? [];
  if (fields.length === 0) {
    return (
      <div className="field-row">
        <div />
        <div className="label-sm">No fields.</div>
        <div />
        <div />
        <div />
        <div />
        <div />
      </div>
    );
  }

  return (
    <>
      {fields.map(field => {
        const name = fieldLocalName(field.id);
        const ref = field.properties?.['$ref'];
        const localRef = refLocalSchemaName(ref);
        const canExpand = localRef !== null && model.schemasByName.has(localRef) && !visited.has(localRef);
        const childSchemaNode = canExpand ? model.schemasByName.get(localRef) : null;
        const childGhostFields = childSchemaNode ? overlayFieldsForSchema(overlayFields, childSchemaNode.id) : [];
        const c = field.properties?.collection;
        const childPrefix = `${prefix}${name}${c === 'map-of-map' || c === 'map-of-array' ? '[][].' : c === 'array' || c === 'map' ? '[].' : '.'}`;
        const nextVisited = new Set(visited);
        nextVisited.add(schemaName);
        const links = edges.filter(e =>
          (e.from === field.id || e.to === field.id)
          && e.type !== 'has-field'
          && e.type !== 'has-value',
        );

        return (
          <React.Fragment key={field.id}>
            <div className={`field-row${depth > 0 ? ' nested' : ''}`} style={{ '--field-depth': depth }}>
              <div className="gutter">{canExpand && <Icon name="caret-down" size={11} />}</div>
              <div className="name">{prefix}{name}</div>
              <div className="type">{fieldType(field.properties)}</div>
              <div className="cardinality">{fieldCardinality(field.properties)}</div>
              <div className="req">{fieldRequirement(field.properties)}</div>
              <div className="state"><StateTag state={field.state} /></div>
              <div className="lineage">
                {links.length > 0
                  ? links.map((edge, index) => {
                      const link = linkSummary(edge, field.id);
                      return (
                        <React.Fragment key={edge.id}>
                          {index > 0 && <span key={`sep-${edge.id}`}>{' '}</span>}
                          <a
                            className="node-ref-link"
                            onClick={() => navigate(`/node?id=${encodeURIComponent(link.targetNodeId)}`)}
                            title={link.title}
                          >
                            {link.direction} {link.label}
                          </a>
                        </React.Fragment>
                      );
                    })
                  : fieldDetails(field.properties)}
              </div>
            </div>
            {canExpand && (
              <>
                <SchemaFieldRows
                  schemaName={localRef}
                  model={model}
                  prefix={childPrefix}
                  depth={depth + 1}
                  visited={nextVisited}
                  edges={edges}
                  overlayFields={overlayFields}
                  overlayRefs={overlayRefs}
                />
                {childGhostFields.length > 0 && (
                  <GhostFieldRows fields={childGhostFields} overlayRefs={overlayRefs} prefix={childPrefix} depth={depth + 1} />
                )}
              </>
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

// Max 2 distinct stripe colours — OverlayLegend also only renders 2 entries.
function ghostStripeClass(index) {
  if (index === 0) return 'overlay-stripe-0';
  if (index === 1) return 'overlay-stripe-1';
  return 'overlay-stripe-0';
}

function overlayFieldsForSchema(overlayFields, schemaNodeId) {
  if (!overlayFields) return [];
  const prefix = schemaNodeId + '.fields.';
  return overlayFields.filter(field => field.id.startsWith(prefix));
}

function GhostFieldRows({ fields, overlayRefs, prefix = '', depth = 0 }) {
  return (
    <>
      {fields.map(field => {
        const isConflict = field.ghostState === 'ghost-conflict' || field.ghostState === 'local-modified';
        const refIndex = overlayRefs ? overlayRefs.indexOf(field.sourceRef) : 0;
        const stripeClass = isConflict ? 'overlay-conflict' : ghostStripeClass(Math.max(0, refIndex));
        const name = prefix + (fieldLocalName(field.id));
        const type = field.node.properties?.type || (field.node.properties?.['$ref'] ? String(field.node.properties['$ref']).replace(/^#\/(schemas|enums)\//, '') : '-');
        return (
          <div
            key={field.id}
            className={`field-row overlay-ghost ${stripeClass}${depth > 0 ? ' nested' : ''}`}
            style={{ '--field-depth': depth }}
            title={`From ${field.sourceRef}`}
          >
            <div className="gutter">
              {isConflict && <span style={{ color: '#c44', fontWeight: 700 }}>!</span>}
            </div>
            <div className="name">{name}</div>
            <div className="type">{type}</div>
            <div className="cardinality">-</div>
            <div className="req">-</div>
            <div className="state">
              {isConflict
                ? <span className="tag" style={{ background: '#c4422222', color: '#c44' }}>conflict</span>
                : <StateTag state={field.node.state} />
              }
            </div>
            <div className="lineage">
              <span className="mono" style={{ fontSize: 10.5, opacity: 0.7 }}>{field.sourceRef}</span>
            </div>
          </div>
        );
      })}
    </>
  );
}

function OverlayLegend({ overlayRefs }) {
  if (!overlayRefs || overlayRefs.length === 0) return null;
  const colours = ['var(--accent)', '#5c7aa8'];
  return (
    <div className="overlay-legend">
      <span className="label-xs">Incoming:</span>
      {overlayRefs.map((ref, index) => (
        <span key={ref} className="overlay-legend-item">
          <span
            className="overlay-legend-swatch"
            style={{ background: colours[index % colours.length] }}
          />
          <span className="mono" style={{ fontSize: 10.5 }}>{ref}</span>
        </span>
      ))}
      <span className="overlay-legend-item" style={{ color: '#c44' }}>
        <span className="overlay-legend-swatch" style={{ background: '#c44' }} />
        conflict
      </span>
    </div>
  );
}

function SchemaCard({ title, nodes, allNodes, edges, anchorIdForNode, overlayFields, overlayRefs, isShared }) {
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

    return (
      <div className="card enum-card">
        <div className="card-head">{isShared ? 'Shared Enums' : 'Enums'}</div>
        <div className="card-body">
          {nodes.map(enumNode => {
            const enumName = localEnumName(enumNode.id);
            const values = valuesByEnum.get(enumName) ?? [];
            return (
              <div key={enumNode.id} className="enum-section" id={anchorIdForNode ? anchorIdForNode(enumNode.id) : undefined}>
                <div className="schema-section-head">
                  <div>
                    <div className="schema-title">{enumName}</div>
                    {enumNode.properties?.description && <div className="label-sm">{enumNode.properties.description}</div>}
                  </div>
                  <div className="label-sm mono">{enumNode.id}</div>
                </div>
                <div className="enum-row enum-row-head">
                  <div className="label-xs">Name</div>
                  <div className="label-xs">Description</div>
                  <div className="label-xs">Status</div>
                </div>
                {values.length === 0 ? (
                  <div className="enum-row">
                    <div className="label-sm">No values.</div>
                    <div />
                    <div />
                  </div>
                ) : values.map(value => (
                  <div key={value.id} className="enum-row">
                    <div className="name">{enumValueDisplayName(value)}</div>
                    <div className="description">{enumValueDescription(value)}</div>
                    <div className="state"><StateTag state={value.state} /></div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (title === 'Schema') {
    const model = buildSchemaModel(nodes, allNodes ?? nodes);
    return (
      <div className="card schema-card">
        <div className="card-head">{isShared ? 'Shared Schemas' : 'Schemas'}</div>
        <div className="card-body">
          {model.topSchemas.map(schema => {
            const schemaName = localSchemaName(schema.id);
            const ghostFields = overlayFieldsForSchema(overlayFields, schema.id);
            return (
              <div key={schema.id} className="schema-section" id={anchorIdForNode ? anchorIdForNode(schema.id) : undefined}>
                <div className="schema-section-head">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="schema-title">{schemaName}</div>
                    {isShared && <span className="tag" style={{ fontSize: 10, padding: '1px 6px', background: 'var(--ink-4)', color: 'var(--bg)' }}>shared</span>}
                    {schema.properties?.description && <div className="label-sm">{schema.properties.description}</div>}
                  </div>
                  <div className="label-sm mono">{schema.id}</div>
                </div>
                {ghostFields.length > 0 && <OverlayLegend overlayRefs={overlayRefs} />}
                <div className="field-row field-row-head">
                  <div />
                  <div className="label-xs">Name</div>
                  <div className="label-xs">Type</div>
                  <div className="label-xs">Collection</div>
                  <div className="label-xs">Req</div>
                  <div className="label-xs">State</div>
                  <div className="label-xs">Links</div>
                </div>
                <SchemaFieldRows
                  schemaName={schemaName}
                  model={model}
                  visited={new Set()}
                  edges={edges ?? []}
                  overlayFields={overlayFields}
                  overlayRefs={overlayRefs}
                />
                {ghostFields.length > 0 && (
                  <GhostFieldRows fields={ghostFields} overlayRefs={overlayRefs} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-head">{title}</div>
      <div className="card-body">
        {nodes.map(node => (
          <div key={node.id} id={anchorIdForNode ? anchorIdForNode(node.id) : undefined} style={{ borderBottom: '1px dashed var(--rule)' }}>
            <div className="mono" style={{ padding: '8px 14px 0', color: 'var(--ink-3)', fontSize: 11, fontWeight: 600 }}>
              {node.id.split('.').pop()}
            </div>
            <PropertiesTable properties={node.properties} />
          </div>
        ))}
      </div>
    </div>
  );
}

window.CorumPrimitives = {
  navigate,
  BrandMark,
  Icon,
  StateTag,
  StabilityTag,
  Chip,
  TemplateBadge,
  PropertyValue,
  PropertiesTable,
  SchemaCard,
};
