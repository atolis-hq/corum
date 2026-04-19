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

function Icon({ name, size = 14 }) {
  const c = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.3,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  };
  switch (name) {
    case 'grid':
      return <svg {...c}><rect x="2" y="2" width="5" height="5" rx="1" /><rect x="9" y="2" width="5" height="5" rx="1" /><rect x="2" y="9" width="5" height="5" rx="1" /><rect x="9" y="9" width="5" height="5" rx="1" /></svg>;
    case 'cube':
      return <svg {...c}><path d="M8 1.5L14 5v6L8 14.5 2 11V5z" /><path d="M2 5l6 3 6-3M8 8v6.5" /></svg>;
    case 'caret':
      return <svg {...c}><path d="M5 4l4 4-4 4" /></svg>;
    case 'caret-down':
      return <svg {...c}><path d="M4 6l4 4 4-4" /></svg>;
    case 'model':
      return <svg {...c}><ellipse cx="8" cy="4" rx="5" ry="2" /><path d="M3 4v4c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8v4c0 1.1 2.2 2 5 2s5-.9 5-2V8" /></svg>;
    case 'api':
      return <svg {...c}><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M5 6h3M5 9h6M5 11.5h4" /></svg>;
    case 'event':
      return <svg {...c}><path d="M3 4h10v8H5l-2 2z" /></svg>;
    case 'graph':
      return <svg {...c}><circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="4" r="1.5" /><circle cx="8" cy="12" r="1.5" /><path d="M5 5l2 6M11 5l-2 6" /></svg>;
    default:
      return <svg {...c}><rect x="3" y="3" width="10" height="10" /></svg>;
  }
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

function formatValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function PropertiesTable({ properties }) {
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
            <td>{typeof value === 'object' ? <pre>{formatValue(value)}</pre> : formatValue(value)}</td>
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

function SchemaFieldRows({ schemaName, model, prefix = '', depth = 0, visited = new Set() }) {
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

        return (
          <React.Fragment key={field.id}>
            <div className={`field-row${depth > 0 ? ' nested' : ''}`} style={{ '--field-depth': depth }}>
              <div className="gutter">{canExpand && <Icon name="caret-down" size={11} />}</div>
              <div className="name">{prefix}{name}</div>
              <div className="type">{fieldType(field.properties)}</div>
              <div className="cardinality">{fieldCardinality(field.properties)}</div>
              <div className="req">{fieldRequirement(field.properties)}</div>
              <div className="state"><StateTag state={field.state} /></div>
              <div className="lineage">{fieldDetails(field.properties)}</div>
            </div>
            {canExpand && (
              <SchemaFieldRows
                schemaName={objectRef}
                model={model}
                prefix={childPrefix}
                depth={depth + 1}
                visited={nextVisited}
              />
            )}
          </React.Fragment>
        );
      })}
    </>
  );
}

function SchemaCard({ title, nodes, allNodes }) {
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
                <SchemaFieldRows schemaName={schemaName} model={model} visited={new Set()} />
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
  PropertiesTable,
  SchemaCard,
};
