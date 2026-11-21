export function localSchemaName(nodeId) {
  const marker = '.schemas.';
  const idx = nodeId.indexOf(marker);
  if (idx < 0) return nodeId.split('.').pop();
  return nodeId.slice(idx + marker.length).split('.')[0];
}
export function fieldSchemaName(nodeId) {
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
export function fieldLocalName(nodeId) {
  const marker = '.fields.';
  const idx = nodeId.indexOf(marker);
  return idx < 0 ? nodeId.split('.').pop() : nodeId.slice(idx + marker.length);
}
export function clusterNodeId(nodeId) {
  const sectionMatch = nodeId.match(/\.(schemas|enums|mappings|operations)\./);
  if (sectionMatch && sectionMatch.index !== undefined) {
    return nodeId.slice(0, sectionMatch.index);
  }
  return nodeId.replace(/\.(fields|values)\.[^.]+$/, '');
}
export function refName(ref, compact = false) {
  if (typeof ref === 'string') {
    const full = ref.replace(/^#\/(schemas|enums|mappings)\//, '');
    if (compact) {
      const dot = full.lastIndexOf('.');
      return dot >= 0 ? full.slice(dot + 1) : full;
    }
    return full;
  }
  if (ref && typeof ref === 'object' && 'display' in ref) {
    const display = String(ref.display);
    if (compact) {
      const dot = display.lastIndexOf('.');
      return dot >= 0 ? display.slice(dot + 1) : display;
    }
    return display;
  }
  return String(ref);
}
export function refLocalSchemaName(ref) {
  if (typeof ref !== 'string') {
    if (ref && typeof ref === 'object' && 'display' in ref) {
      const d = String(ref.display);
      const dot = d.lastIndexOf('.');
      return dot >= 0 ? d.slice(dot + 1) : d;
    }
    return null;
  }
  if (ref.startsWith('#/schemas/')) return ref.slice(10);
  if (ref.startsWith('#/mappings/')) return ref.slice(11);
  // Global node ID (e.g. "component.Schema.TypeName") — local name is the final segment
  const lastDot = ref.lastIndexOf('.');
  return lastDot >= 0 ? ref.slice(lastDot + 1) : null;
}
export function fieldType(properties, compact = false) {
  const c = properties?.collection;
  const suffix = c === 'array' ? '[]' : '';
  if (properties?.type) return `${properties.type}${suffix}`;
  const ref = properties?.['$ref'];
  if (ref) return `${refName(ref, compact)}${suffix}`;
  return suffix ? `unknown${suffix}` : 'unknown';
}
export function fieldRequirement(properties) {
  if (properties?.nullable === false) return 'required';
  if (properties?.nullable === true) return 'optional';
  return '-';
}
export function fieldCardinality(properties) {
  return properties?.collection ?? 'one';
}
export function fieldDetails(properties, compact = false) {
  const parts = [];
  const ref = properties?.['$ref'];
  if (ref) parts.push(`ref ${refName(ref, compact)}`);
  if (properties?.description) parts.push(properties.description);
  return parts.length > 0 ? parts.join(' · ') : '-';
}
export function linkSummary(edge, fieldId) {
  const outgoing = edge.from === fieldId;
  const otherNodeId = outgoing ? edge.to : edge.from;
  const direction = outgoing ? '->' : '<-';
  const relation = edge.type === 'maps-to' ? '' : `${edge.type} `;
  return {
    direction,
    label: `${relation}${fieldLocalName(otherNodeId)}`,
    targetNodeId: clusterNodeId(otherNodeId),
    title: otherNodeId
  };
}
export function localEnumName(nodeId) {
  const marker = '.enums.';
  const idx = nodeId.indexOf(marker);
  if (idx < 0) return nodeId.split('.').pop();
  return nodeId.slice(idx + marker.length).split('.')[0];
}
export function enumValueEnumName(nodeId) {
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
export function enumValueDisplayName(node) {
  return node.properties?.name ?? node.id.split('.').pop();
}
export function enumValueDescription(node) {
  return node.properties?.description ?? '-';
}
export function parentSchemaId(fieldNodeId) {
  const idx = fieldNodeId.lastIndexOf('.fields.');
  return idx >= 0 ? fieldNodeId.slice(0, idx) : null;
}
export function buildSchemaModel(schemaNodes, allNodes) {
  const allSchemaNodes = (allNodes ?? []).filter(n => n.template === 'Schema');
  const allMappingNodes = (allNodes ?? []).filter(n => n.template === 'Mapping');
  const schemasByName = new Map(allSchemaNodes.map(node => [localSchemaName(node.id), node]));
  const schemasById = new Map(allSchemaNodes.map(node => [node.id, node]));
  const mappingsByNodeId = new Map(allMappingNodes.map(node => [node.id, node]));
  // Ensure the primary schemaNodes are always present (they may not be in allNodes)
  for (const node of schemaNodes) {
    schemasByName.set(localSchemaName(node.id), node);
    schemasById.set(node.id, node);
  }
  // fieldsBySchema keyed by full schema node ID — prevents same-named schemas from
  // different clusters contaminating each other's field lists
  const fieldsBySchema = new Map();
  const referencedSchemas = new Set();
  for (const node of allNodes ?? []) {
    if (node.template !== 'Field') continue;
    const schemaId = parentSchemaId(node.id);
    if (!schemaId) continue;
    if (!fieldsBySchema.has(schemaId)) fieldsBySchema.set(schemaId, []);
    fieldsBySchema.get(schemaId).push(node);
    const ref = node.properties?.['$ref'];
    const localName = refLocalSchemaName(ref);
    if (localName && schemasByName.has(localName)) {
      referencedSchemas.add(localName);
    }
  }
  const topSchemas = schemaNodes.filter(node => !referencedSchemas.has(localSchemaName(node.id)));
  return {
    schemasByName,
    schemasById,
    mappingsByNodeId,
    fieldsBySchema,
    topSchemas: topSchemas.length > 0 ? topSchemas : schemaNodes
  };
}
