/* Explorer navigation helpers: pure functions, no DOM dependency. Private to the Explorer plugin. */

const OVERLAY_DIFF_STATES = new Set([
  'local-modified',
  'default-only',
  'ghost-single',
  'ghost-consensus',
  'ghost-conflict',
])

function collectNestedNavigation(nodes, templates) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]))
  const templateMap = new Map(templates.map(template => [template.name, template]))
  const nestedByParent = new Map()
  const nestedNodeIds = new Set()

  for (const node of nodes) {
    if (!node.parentId || !node.ownedSection) continue
    const parent = nodeMap.get(node.parentId)
    if (!parent) continue
    const parentTemplate = templateMap.get(parent.template)
    const rule = parentTemplate?.ui?.nav?.nestOwned?.find(item => item.section === node.ownedSection)
    if (!rule) continue

    if (!nestedByParent.has(parent.id)) nestedByParent.set(parent.id, new Map())
    const groups = nestedByParent.get(parent.id)
    if (!groups.has(node.ownedSection)) {
      groups.set(node.ownedSection, {
        label: rule.label ?? node.ownedSection,
        nodes: [],
      })
    }
    groups.get(node.ownedSection).nodes.push(node)
    nestedNodeIds.add(node.id)
  }

  return { templateMap, nestedByParent, nestedNodeIds }
}

export function buildNavTree(nodes, templates) {
  const { templateMap, nestedByParent, nestedNodeIds } = collectNestedNavigation(nodes, templates)
  const plainByComponent = new Map()
  const groupsByComponent = new Map()

  for (const node of nodes) {
    if (nestedNodeIds.has(node.id)) continue
    const template = templateMap.get(node.template)
    const navGroup = template?.ui?.nav?.navGroup
    const navChildren = [...(nestedByParent.get(node.id)?.values() ?? [])]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(group => ({
        label: group.label,
        nodes: group.nodes.sort((a, b) => a.id.localeCompare(b.id)),
      }))
    const nodeWithChildren = { ...node, navChildren }

    if (navGroup) {
      if (!groupsByComponent.has(node.namespace)) groupsByComponent.set(node.namespace, new Map())
      const componentGroups = groupsByComponent.get(node.namespace)
      if (!componentGroups.has(navGroup)) componentGroups.set(navGroup, new Map())
      const subtypeMap = componentGroups.get(navGroup)
      if (!subtypeMap.has(node.template)) subtypeMap.set(node.template, [])
      subtypeMap.get(node.template).push(nodeWithChildren)
    } else {
      if (!plainByComponent.has(node.namespace)) plainByComponent.set(node.namespace, new Map())
      const componentMap = plainByComponent.get(node.namespace)
      if (!componentMap.has(node.template)) componentMap.set(node.template, [])
      componentMap.get(node.template).push(nodeWithChildren)
    }
  }

  const allComponents = new Set([...plainByComponent.keys(), ...groupsByComponent.keys()])
  const tree = new Map()

  for (const component of allComponents) {
    const allEntries = []

    const plainMap = plainByComponent.get(component)
    if (plainMap) {
      for (const [templateName, nodeList] of plainMap) {
        nodeList.sort((a, b) => a.id.localeCompare(b.id))
        allEntries.push({ _sortKey: templateName, kind: 'template', templateName, nodes: nodeList })
      }
    }

    const groupMap = groupsByComponent.get(component)
    if (groupMap) {
      for (const [groupTemplateName, subtypeMap] of groupMap) {
        const groupTemplate = templateMap.get(groupTemplateName)
        const children = []
        for (const [templateName, nodeList] of [...subtypeMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          nodeList.sort((a, b) => a.id.localeCompare(b.id))
          const childTemplate = templateMap.get(templateName)
          children.push({
            templateName,
            label: childTemplate?.ui?.displayName ?? templateName,
            icon: childTemplate?.ui?.icon,
            colour: childTemplate?.ui?.colour ?? groupTemplate?.ui?.colour ?? 'var(--ink-4)',
            nodes: nodeList,
          })
        }
        allEntries.push({
          _sortKey: groupTemplateName,
          kind: 'group',
          groupTemplateName,
          label: groupTemplate?.ui?.displayName ?? groupTemplateName,
          icon: groupTemplate?.ui?.icon,
          colour: groupTemplate?.ui?.colour ?? 'var(--ink-4)',
          children,
        })
      }
    }

    allEntries.sort((a, b) => a._sortKey.localeCompare(b._sortKey))
    tree.set(component, allEntries.map(({ _sortKey, ...entry }) => entry))
  }

  return tree
}

export function buildOverlayIndicatorIds(nodes, templates, overlayNodes, activeOverlayRefs) {
  if (!Array.isArray(activeOverlayRefs) || activeOverlayRefs.length === 0) return new Set()

  const visibleNavNodeIds = nodes.map(node => node.id)
  const indicatorIds = new Set()

  for (const overlayNode of overlayNodes ?? []) {
    if (!OVERLAY_DIFF_STATES.has(overlayNode.ghostState)) continue
    if (!activeOverlayRefs.some(ref => overlayNode.branches.includes(ref))) continue

    let bestMatch = null
    for (const nodeId of visibleNavNodeIds) {
      if (overlayNode.id !== nodeId && !overlayNode.id.startsWith(`${nodeId}.`)) continue
      if (!bestMatch || nodeId.length > bestMatch.length) bestMatch = nodeId
    }

    if (bestMatch) indicatorIds.add(bestMatch)
  }

  return indicatorIds
}

// Group namespaces into one navigation section per kind. Labels come from the
// kind registry ([{ id, label }]); unrecognised kinds are labelled with their id.
// The default kind is listed first, then the rest by label.
export function groupNamespacesByKind(nodes, kindRegistry) {
  const labelByKind = new Map((kindRegistry ?? []).map(kind => [kind.id, kind.label]))
  const kindByNamespace = new Map()
  for (const node of nodes) {
    if (!kindByNamespace.has(node.namespace)) kindByNamespace.set(node.namespace, node.kind ?? 'component')
  }
  const sections = new Map()
  for (const [namespace, kind] of kindByNamespace) {
    if (!sections.has(kind)) sections.set(kind, { kind, label: labelByKind.get(kind) ?? kind, namespaces: [] })
    sections.get(kind).namespaces.push(namespace)
  }
  for (const section of sections.values()) section.namespaces.sort((a, b) => a.localeCompare(b))
  return [...sections.values()].sort((a, b) => {
    if (a.kind === 'component') return -1
    if (b.kind === 'component') return 1
    return a.label.localeCompare(b.label) || a.kind.localeCompare(b.kind)
  })
}

// Edges crossing a namespace boundary. The namespace is the first ID segment.
export function namespaceEdges(edges, namespace) {
  const inNs = id => id.split('.')[0] === namespace
  return {
    inbound: edges.filter(e => inNs(e.to) && !inNs(e.from)),
    outbound: edges.filter(e => inNs(e.from) && !inNs(e.to)),
  }
}
