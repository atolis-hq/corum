/* Navigation tree builder — pure function, no DOM dependency. */

function buildNavTree(nodes, templates) {
  const nodeMap = new Map(nodes.map(node => [node.id, node]));
  const templateMap = new Map(templates.map(template => [template.name, template]));
  const nestedByParent = new Map();
  const nestedNodeIds = new Set();

  for (const node of nodes) {
    if (!node.parentId || !node.ownedSection) continue;
    const parent = nodeMap.get(node.parentId);
    if (!parent) continue;
    const parentTemplate = templateMap.get(parent.template);
    const rule = parentTemplate?.ui?.nav?.nestOwned?.find(item => item.section === node.ownedSection);
    if (!rule) continue;

    if (!nestedByParent.has(parent.id)) nestedByParent.set(parent.id, new Map());
    const groups = nestedByParent.get(parent.id);
    if (!groups.has(node.ownedSection)) {
      groups.set(node.ownedSection, {
        label: rule.label ?? node.ownedSection,
        nodes: [],
      });
    }
    groups.get(node.ownedSection).nodes.push(node);
    nestedNodeIds.add(node.id);
  }

  const plainByComponent = new Map();
  const groupsByComponent = new Map();

  for (const node of nodes) {
    if (nestedNodeIds.has(node.id)) continue;
    const template = templateMap.get(node.template);
    const navGroup = template?.ui?.nav?.navGroup;
    const navChildren = [...(nestedByParent.get(node.id)?.values() ?? [])].map(group => ({
      label: group.label,
      nodes: group.nodes.sort((a, b) => a.id.localeCompare(b.id)),
    }));
    const nodeWithChildren = { ...node, navChildren };

    if (navGroup) {
      if (!groupsByComponent.has(node.component)) groupsByComponent.set(node.component, new Map());
      const componentGroups = groupsByComponent.get(node.component);
      if (!componentGroups.has(navGroup)) componentGroups.set(navGroup, new Map());
      const subtypeMap = componentGroups.get(navGroup);
      if (!subtypeMap.has(node.template)) subtypeMap.set(node.template, []);
      subtypeMap.get(node.template).push(nodeWithChildren);
    } else {
      if (!plainByComponent.has(node.component)) plainByComponent.set(node.component, new Map());
      const componentMap = plainByComponent.get(node.component);
      if (!componentMap.has(node.template)) componentMap.set(node.template, []);
      componentMap.get(node.template).push(nodeWithChildren);
    }
  }

  const allComponents = new Set([...plainByComponent.keys(), ...groupsByComponent.keys()]);
  const tree = new Map();

  for (const component of allComponents) {
    const allEntries = [];

    const plainMap = plainByComponent.get(component);
    if (plainMap) {
      for (const [templateName, nodeList] of plainMap) {
        nodeList.sort((a, b) => a.id.localeCompare(b.id));
        allEntries.push({ _sortKey: templateName, kind: 'template', templateName, nodes: nodeList });
      }
    }

    const groupMap = groupsByComponent.get(component);
    if (groupMap) {
      for (const [groupTemplateName, subtypeMap] of groupMap) {
        const groupTemplate = templateMap.get(groupTemplateName);
        const children = [];
        for (const [templateName, nodeList] of [...subtypeMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
          nodeList.sort((a, b) => a.id.localeCompare(b.id));
          const childTemplate = templateMap.get(templateName);
          children.push({
            templateName,
            label: childTemplate?.ui?.displayName ?? templateName,
            icon: childTemplate?.ui?.icon,
            colour: childTemplate?.ui?.colour ?? groupTemplate?.ui?.colour ?? 'var(--ink-4)',
            nodes: nodeList,
          });
        }
        allEntries.push({
          _sortKey: groupTemplateName,
          kind: 'group',
          groupTemplateName,
          label: groupTemplate?.ui?.displayName ?? groupTemplateName,
          icon: groupTemplate?.ui?.icon,
          colour: groupTemplate?.ui?.colour ?? 'var(--ink-4)',
          children,
        });
      }
    }

    allEntries.sort((a, b) => a._sortKey.localeCompare(b._sortKey));
    tree.set(component, allEntries.map(({ _sortKey, ...entry }) => entry));
  }

  return tree;
}

window.CorumNav = { buildNavTree };
