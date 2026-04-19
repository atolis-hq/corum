/* Shared UI primitives for the browser app. */

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
    return (
      <div className="prop-array">
        {value.map((item, i) => (
          <div key={i} className="prop-array-item">
            <PropertyValue value={item} onNavigate={onNavigate} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === 'object') {
    return (
      <table className="prop-table prop-table-nested">
        <tbody>
          {Object.entries(value).map(([k, v]) => (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td><PropertyValue value={v} onNavigate={onNavigate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return <span>{String(value)}</span>;
}

function PropertiesTable({ properties, onNavigate }) {
  const entries = Object.entries(properties ?? {});
  if (entries.length === 0) {
    return <p className="label-sm" style={{ padding: '10px 14px' }}>No properties.</p>;
  }

  return (
    <table className="prop-table">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <td className="mono">{key}</td>
            <td><PropertyValue value={value} onNavigate={onNavigate} /></td>
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
  if (schemaIdx < 0 || fieldIdx < 0) return null;
  return nodeId.slice(schemaIdx + schemaMarker.length, fieldIdx);
}

function fieldLocalName(nodeId) {
  const marker = '.fields.';
  const idx = nodeId.indexOf(marker);
  return idx < 0 ? nodeId.split('.').pop() : nodeId.slice(idx + marker.length);
}

function fieldType(properties) {
  const cardinality = properties?.cardinality === 'many' ? '[]' : '';
  if (properties?.scalarType) return `${properties.scalarType}${cardinality}`;
  if (properties?.objectRef) return `${properties.objectRef}${cardinality}`;
  return cardinality ? `object${cardinality}` : 'object';
}

function fieldRequirement(properties) {
  if (properties?.nullable === false) return 'required';
  if (properties?.nullable === true) return 'optional';
  return '-';
}

function fieldCardinality(properties) {
  return properties?.cardinality ?? '-';
}

function fieldDetails(properties) {
  const parts = [];
  if (properties?.objectRef) parts.push(`ref ${properties.objectRef}`);
  if (properties?.description) parts.push(properties.description);
  return parts.length > 0 ? parts.join(' · ') : '-';
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
  if (enumIdx < 0 || valueIdx < 0) return null;
  return nodeId.slice(enumIdx + enumMarker.length, valueIdx);
}

function enumValueDisplayName(node) {
  return node.properties?.name ?? node.id.split('.').pop();
}

function enumValueDescription(node) {
  return node.properties?.description ?? '-';
}

function buildSchemaModel(schemaNodes, allNodes) {
  const schemasByName = new Map(schemaNodes.map(node => [localSchemaName(node.id), node]));
  const fieldsBySchema = new Map();
  const referencedSchemas = new Set();

  for (const node of allNodes ?? []) {
    if (node.template !== 'Field') continue;
    const schemaName = fieldSchemaName(node.id);
    if (!schemaName) continue;
    if (!fieldsBySchema.has(schemaName)) fieldsBySchema.set(schemaName, []);
    fieldsBySchema.get(schemaName).push(node);

    const objectRef = node.properties?.objectRef;
    if (typeof objectRef === 'string' && schemasByName.has(objectRef)) {
      referencedSchemas.add(objectRef);
    }
  }

  const topSchemas = schemaNodes.filter(node => !referencedSchemas.has(localSchemaName(node.id)));
  return {
    schemasByName,
    fieldsBySchema,
    topSchemas: topSchemas.length > 0 ? topSchemas : schemaNodes,
  };
}

function SchemaFieldRows({ schemaName, model, prefix = '', depth = 0, visited = new Set(), edges = [] }) {
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
        const objectRef = field.properties?.objectRef;
        const canExpand = typeof objectRef === 'string' && model.schemasByName.has(objectRef) && !visited.has(objectRef);
        const childPrefix = `${prefix}${name}${field.properties?.cardinality === 'many' ? '[].' : '.'}`;
        const nextVisited = new Set(visited);
        nextVisited.add(schemaName);
        const mapsTo = edges.filter(e => e.from === field.id && e.type === 'maps-to');

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
                {mapsTo.length > 0
                  ? mapsTo.map(e => {
                      const targetNodeId = e.to.replace(/\.fields\.[^.]+$/, '');
                      const targetFieldName = e.to.split('.').pop();
                      return (
                        <a
                          key={e.to}
                          className="node-ref-link"
                          onClick={() => window.location.hash = `#/node?id=${encodeURIComponent(targetNodeId)}`}
                          title={e.to}
                        >
                          {'->'} {targetFieldName}
                        </a>
                      );
                    })
                  : fieldDetails(field.properties)}
              </div>
            </div>
            {canExpand && (
              <SchemaFieldRows
                schemaName={objectRef}
                model={model}
                prefix={childPrefix}
                depth={depth + 1}
                visited={nextVisited}
                edges={edges}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SchemaCard({ title, nodes, allNodes, edges }) {
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
        <div className="card-head">Enums</div>
        <div className="card-body">
          {nodes.map(enumNode => {
            const enumName = localEnumName(enumNode.id);
            const values = valuesByEnum.get(enumName) ?? [];
            return (
              <div key={enumNode.id} className="enum-section">
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
        <div className="card-head">Schemas</div>
        <div className="card-body">
          {model.topSchemas.map(schema => {
            const schemaName = localSchemaName(schema.id);
            return (
              <div key={schema.id} className="schema-section">
                <div className="schema-section-head">
                  <div>
                    <div className="schema-title">{schemaName}</div>
                    {schema.properties?.description && <div className="label-sm">{schema.properties.description}</div>}
                  </div>
                  <div className="label-sm mono">{schema.id}</div>
                </div>
                <div className="field-row field-row-head">
                  <div />
                  <div className="label-xs">Name</div>
                  <div className="label-xs">Type</div>
                  <div className="label-xs">Cardinality</div>
                  <div className="label-xs">Req</div>
                  <div className="label-xs">State</div>
                  <div className="label-xs">Links</div>
                </div>
                <SchemaFieldRows schemaName={schemaName} model={model} visited={new Set()} edges={edges ?? []} />
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
          <div key={node.id} style={{ borderBottom: '1px dashed var(--rule)' }}>
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
