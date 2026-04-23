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

  const tree = new Map();
  for (const node of nodes) {
    if (nestedNodeIds.has(node.id)) continue;
    if (!tree.has(node.component)) tree.set(node.component, new Map());
    const component = tree.get(node.component);
    if (!component.has(node.template)) component.set(node.template, []);
    const navChildren = [...(nestedByParent.get(node.id)?.values() ?? [])].map(group => ({
      label: group.label,
      nodes: group.nodes.sort((a, b) => a.id.localeCompare(b.id)),
    }));
    component.get(node.template).push({ ...node, navChildren });
  }
  for (const groups of tree.values()) {
    for (const groupNodes of groups.values()) {
      groupNodes.sort((a, b) => a.id.localeCompare(b.id));
    }
  }
  return tree;
}

window.CorumNav = { buildNavTree };
