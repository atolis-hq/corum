# Nav Template Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow concrete templates to declare `ui.nav.navGroup: <templateName>` to be grouped under a parent template heading in the nav tree, with colour resolved at template load time.

**Architecture:** Templates declare their nav group via `ui.nav.navGroup`. After fetching templates from the API, a client-side `resolveTemplates` pass writes the group template's colour onto any subtype that has none. `buildNavTree` returns `Map<component, NavEntry[]>` where entries are either `kind: 'template'` (existing behaviour) or `kind: 'group'` (new). `NavTree` renders group entries with a heading row for the group template and a subtype heading row per child template.

**Tech Stack:** TypeScript (schema), YAML (templates), plain JS (nav.js), JSX/React (app.jsx), CSS (style.css), Node test runner + vm module (tests).

---

## File Map

| File | Change |
|------|--------|
| `src/schema/index.ts` | Add `navGroup?: string` to `ui.nav` type |
| `.corum/packs/messaging/templates/DomainEvent.yaml` | Remove `icon`/`colour`; add `nav.navGroup: Event` |
| `.corum/packs/messaging/templates/IntegrationEvent.yaml` | Add `nav.navGroup: Event` |
| `test/nav.test.ts` | Update types; update existing tests to new return shape; add navGroup tests |
| `web/nav.js` | Change return type to `Map<component, NavEntry[]>`; implement navGroup grouping |
| `web/app.jsx` | Add `resolveTemplates`; call it in useEffect; update `NavTree` to render new entry shape |
| `web/style.css` | Add `.nav-subtype-head` rule |

---

## Task 1: Add `navGroup` to TypeScript schema

**Files:**
- Modify: `src/schema/index.ts`

- [ ] **Step 1: Add `navGroup` to the `ui.nav` type**

In `src/schema/index.ts`, locate the `ui` block inside the `Template` interface (lines 44–55) and add `navGroup`:

```ts
    nav?: {
      nestOwned?: Array<{
        section: string
        label?: string
      }>
      navGroup?: string
    }
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/schema/index.ts
git commit -m "feat: add navGroup to template ui.nav schema type"
```

---

## Task 2: Update template YAMLs

**Files:**
- Modify: `.corum/packs/messaging/templates/DomainEvent.yaml`
- Modify: `.corum/packs/messaging/templates/IntegrationEvent.yaml`

- [ ] **Step 1: Update DomainEvent.yaml**

Remove `icon` and `colour` (they duplicate Event's; `resolveTemplates` will supply colour at runtime). Add `nav.navGroup`:

```yaml
name: DomainEvent
info:
  version: "1.0.0"
  core: false
  abstract: false
  description: |
    A fact that something happened within a bounded context.
    Internal to the component; whether other systems may subscribe
    to this event is an architectural decision made independently
    of this node type.

extends: Event
ui:
  displayName: Domain Event
  displayProperties: []
  nav:
    navGroup: Event
```

- [ ] **Step 2: Update IntegrationEvent.yaml**

Keep `icon` and `colour` (they differ from Event's). Add `nav.navGroup`:

```yaml
name: IntegrationEvent
info:
  version: "1.0.0"
  core: false
  abstract: false
  description: |
    An event published for consumption by other bounded contexts
    or external systems. Represents a cross-service contract;
    changes to the payload schema affect consumers.

extends: Event
ui:
  icon: share-nodes
  colour: "#D96C4A"
  displayName: Integration Event
  displayProperties: []
  nav:
    navGroup: Event
```

- [ ] **Step 3: Run tests to confirm no regressions**

```bash
npm test
```

Expected: all tests pass (node/edge counts unchanged; loader does not validate `ui.nav` contents).

- [ ] **Step 4: Commit**

```bash
git add .corum/packs/messaging/templates/DomainEvent.yaml .corum/packs/messaging/templates/IntegrationEvent.yaml
git commit -m "feat: add navGroup to DomainEvent and IntegrationEvent templates"
```

---

## Task 3: Update nav tests (write failing tests for new behaviour)

**Files:**
- Modify: `test/nav.test.ts`

The existing tests assert against `Map<string, Map<string, nodes[]>>`. After this task they assert against `Map<string, NavEntry[]>`. All tests will fail against the current `nav.js` — that is correct (TDD red phase).

- [ ] **Step 1: Replace the full contents of `test/nav.test.ts`**

```ts
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import vm from 'node:vm'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const navSource = readFileSync(path.join(repoRoot, 'web', 'nav.js'), 'utf-8')

type NavNode = { id: string; template: string; component: string; parentId?: string; ownedSection?: string }
type NavNodeWithChildren = NavNode & { navChildren: Array<{ label: string; nodes: NavNode[] }> }
type TemplateEntry = { kind: 'template'; templateName: string; nodes: NavNodeWithChildren[] }
type ChildEntry = { templateName: string; label: string; icon?: string; colour: string; nodes: NavNodeWithChildren[] }
type GroupEntry = { kind: 'group'; groupTemplateName: string; label: string; icon?: string; colour: string; children: ChildEntry[] }
type NavEntry = TemplateEntry | GroupEntry
type NavTree = Map<string, NavEntry[]>
type NavTemplate = {
  name: string
  ui?: {
    displayName?: string
    icon?: string
    colour?: string
    nav?: {
      nestOwned?: Array<{ section: string; label?: string }>
      navGroup?: string
    }
  }
}

function loadNav(): { buildNavTree: (nodes: NavNode[], templates: NavTemplate[]) => NavTree } {
  const ctx = vm.createContext({ window: {} as Record<string, unknown> })
  vm.runInContext(navSource, ctx)
  return ctx.window.CorumNav as ReturnType<typeof loadNav>
}

function templateEntry(tree: NavTree, component: string, templateName: string): TemplateEntry | undefined {
  return tree.get(component)?.find(
    (e): e is TemplateEntry => e.kind === 'template' && e.templateName === templateName,
  )
}

describe('buildNavTree', () => {
  let buildNavTree: ReturnType<typeof loadNav>['buildNavTree']

  before(() => {
    buildNavTree = loadNav().buildNavTree
  })

  it('groups top-level nodes by component and template', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'billing.Invoice', template: 'DomainModel', component: 'billing' },
    ]
    const templates: NavTemplate[] = [{ name: 'DomainModel' }]
    const tree = buildNavTree(nodes, templates)

    assert.ok(tree.has('orders'))
    assert.ok(tree.has('billing'))
    assert.equal(templateEntry(tree, 'orders', 'DomainModel')?.nodes.length, 1)
    assert.equal(templateEntry(tree, 'billing', 'DomainModel')?.nodes.length, 1)
  })

  it('excludes nestOwned nodes from the top level', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations', label: 'Operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    assert.ok(!templateEntry(tree, 'orders', 'DomainOperation'), 'DomainOperation should not appear at top level')
  })

  it('attaches nestOwned nodes as navChildren on the parent', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations', label: 'Operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    const orderNode = templateEntry(tree, 'orders', 'DomainModel')!.nodes[0]
    assert.equal(orderNode.navChildren.length, 1)
    assert.equal(orderNode.navChildren[0].label, 'Operations')
    assert.equal(orderNode.navChildren[0].nodes[0].id, 'orders.Order.operations.cancel')
  })

  it('uses section name as label when nestOwned rule has no label', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { nav: { nestOwned: [{ section: 'operations' }] } } },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    const orderNode = templateEntry(tree, 'orders', 'DomainModel')!.nodes[0]
    assert.equal(orderNode.navChildren[0].label, 'operations')
  })

  it('does not nest nodes whose parent template has no nestOwned rule for their section', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.Order.operations.cancel', template: 'DomainOperation', component: 'orders', parentId: 'orders.Order', ownedSection: 'operations' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel' },
      { name: 'DomainOperation' },
    ]
    const tree = buildNavTree(nodes, templates)

    assert.ok(templateEntry(tree, 'orders', 'DomainOperation'), 'should appear at top level when no nestOwned rule')
    assert.equal(templateEntry(tree, 'orders', 'DomainModel')!.nodes[0].navChildren.length, 0)
  })

  it('sorts top-level nodes within a template group alphabetically', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Z', template: 'DomainModel', component: 'orders' },
      { id: 'orders.A', template: 'DomainModel', component: 'orders' },
    ]
    const templates: NavTemplate[] = [{ name: 'DomainModel' }]
    const tree = buildNavTree(nodes, templates)

    const entry = templateEntry(tree, 'orders', 'DomainModel')!
    assert.equal(entry.nodes[0].id, 'orders.A')
    assert.equal(entry.nodes[1].id, 'orders.Z')
  })

  it('returns empty tree for empty node list', () => {
    const tree = buildNavTree([], [])
    assert.equal(tree.size, 0)
  })

  // navGroup tests

  it('produces a kind:group entry for templates sharing the same navGroup', () => {
    const nodes: NavNode[] = [
      { id: 'orders.placed', template: 'DomainEvent', component: 'orders' },
      { id: 'orders.shipped', template: 'IntegrationEvent', component: 'orders' },
    ]
    const templates: NavTemplate[] = [
      { name: 'Event', ui: { displayName: 'Event', icon: 'bolt', colour: '#E8A838' } },
      { name: 'DomainEvent', ui: { displayName: 'Domain Event', colour: '#E8A838', nav: { navGroup: 'Event' } } },
      { name: 'IntegrationEvent', ui: { displayName: 'Integration Event', icon: 'share-nodes', colour: '#D96C4A', nav: { navGroup: 'Event' } } },
    ]
    const tree = buildNavTree(nodes, templates)
    const entries = tree.get('orders')!
    assert.equal(entries.length, 1)
    const group = entries[0]
    assert.equal(group.kind, 'group')
    assert.ok(group.kind === 'group')
    assert.equal(group.groupTemplateName, 'Event')
    assert.equal(group.label, 'Event')
    assert.equal(group.icon, 'bolt')
    assert.equal(group.colour, '#E8A838')
  })

  it('assigns correct label, icon, and colour to each child in a navGroup', () => {
    const nodes: NavNode[] = [
      { id: 'orders.placed', template: 'DomainEvent', component: 'orders' },
      { id: 'orders.shipped', template: 'IntegrationEvent', component: 'orders' },
    ]
    const templates: NavTemplate[] = [
      { name: 'Event', ui: { displayName: 'Event', icon: 'bolt', colour: '#E8A838' } },
      { name: 'DomainEvent', ui: { displayName: 'Domain Event', colour: '#E8A838', nav: { navGroup: 'Event' } } },
      { name: 'IntegrationEvent', ui: { displayName: 'Integration Event', icon: 'share-nodes', colour: '#D96C4A', nav: { navGroup: 'Event' } } },
    ]
    const tree = buildNavTree(nodes, templates)
    const group = tree.get('orders')![0]
    assert.ok(group.kind === 'group')

    const domain = group.children.find(c => c.templateName === 'DomainEvent')!
    assert.equal(domain.label, 'Domain Event')
    assert.equal(domain.icon, undefined)
    assert.equal(domain.colour, '#E8A838')

    const integration = group.children.find(c => c.templateName === 'IntegrationEvent')!
    assert.equal(integration.label, 'Integration Event')
    assert.equal(integration.icon, 'share-nodes')
    assert.equal(integration.colour, '#D96C4A')
  })

  it('sorts children within a navGroup alphabetically by templateName', () => {
    const nodes: NavNode[] = [
      { id: 'orders.shipped', template: 'IntegrationEvent', component: 'orders' },
      { id: 'orders.placed', template: 'DomainEvent', component: 'orders' },
    ]
    const templates: NavTemplate[] = [
      { name: 'Event', ui: { colour: '#E8A838' } },
      { name: 'DomainEvent', ui: { colour: '#E8A838', nav: { navGroup: 'Event' } } },
      { name: 'IntegrationEvent', ui: { colour: '#D96C4A', nav: { navGroup: 'Event' } } },
    ]
    const tree = buildNavTree(nodes, templates)
    const group = tree.get('orders')![0]
    assert.ok(group.kind === 'group')
    assert.equal(group.children[0].templateName, 'DomainEvent')
    assert.equal(group.children[1].templateName, 'IntegrationEvent')
  })

  it('sorts nodes within a navGroup child alphabetically by id', () => {
    const nodes: NavNode[] = [
      { id: 'orders.z-placed', template: 'DomainEvent', component: 'orders' },
      { id: 'orders.a-placed', template: 'DomainEvent', component: 'orders' },
    ]
    const templates: NavTemplate[] = [
      { name: 'Event', ui: { colour: '#E8A838' } },
      { name: 'DomainEvent', ui: { colour: '#E8A838', nav: { navGroup: 'Event' } } },
    ]
    const tree = buildNavTree(nodes, templates)
    const group = tree.get('orders')![0]
    assert.ok(group.kind === 'group')
    assert.equal(group.children[0].nodes[0].id, 'orders.a-placed')
    assert.equal(group.children[0].nodes[1].id, 'orders.z-placed')
  })

  it('mixes kind:template and kind:group entries, sorted by templateName/groupTemplateName', () => {
    const nodes: NavNode[] = [
      { id: 'orders.Order', template: 'DomainModel', component: 'orders' },
      { id: 'orders.placed', template: 'DomainEvent', component: 'orders' },
    ]
    const templates: NavTemplate[] = [
      { name: 'DomainModel', ui: { colour: '#4a90e2' } },
      { name: 'Event', ui: { colour: '#E8A838' } },
      { name: 'DomainEvent', ui: { colour: '#E8A838', nav: { navGroup: 'Event' } } },
    ]
    const tree = buildNavTree(nodes, templates)
    const entries = tree.get('orders')!
    assert.equal(entries.length, 2)
    // DomainModel < Event alphabetically
    assert.ok(entries[0].kind === 'template' && entries[0].templateName === 'DomainModel')
    assert.ok(entries[1].kind === 'group' && entries[1].groupTemplateName === 'Event')
  })
})
```

- [ ] **Step 2: Build the test file**

```bash
npm run build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 3: Run tests and confirm they fail**

```bash
npm test
```

Expected: the 5 updated existing tests and 5 new navGroup tests fail (old `buildNavTree` returns a Map-of-Maps, not an array). The error will be something like `TypeError: tree.get(...).find is not a function` or assertion failures.

---

## Task 4: Implement navGroup in `buildNavTree`

**Files:**
- Modify: `web/nav.js`

- [ ] **Step 1: Replace the full contents of `web/nav.js`**

```js
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
```

- [ ] **Step 2: Build**

```bash
npm run build
```

Expected: compiles without errors.

- [ ] **Step 3: Run tests and confirm they pass**

```bash
npm test
```

Expected: all tests pass, including the 5 new navGroup tests.

- [ ] **Step 4: Commit**

```bash
git add web/nav.js test/nav.test.ts
git commit -m "feat: implement navGroup grouping in buildNavTree"
```

---

## Task 5: Add `resolveTemplates` to `app.jsx`

**Files:**
- Modify: `web/app.jsx`

- [ ] **Step 1: Add `resolveTemplates` function**

Insert the following function immediately before the `App` function definition (around line 267, before `function App()`):

```js
function resolveTemplates(templates) {
  const map = new Map(templates.map(t => [t.name, t]));
  for (const t of templates) {
    const groupName = t.ui?.nav?.navGroup;
    if (!groupName || t.ui?.colour) continue;
    const groupColour = map.get(groupName)?.ui?.colour;
    if (groupColour) {
      t.ui = { ...t.ui, colour: groupColour };
    }
  }
  return templates;
}
```

- [ ] **Step 2: Call `resolveTemplates` in the `App` useEffect**

In the `App` component's `useEffect`, change:

```js
      .then(([templateData, nodeData]) => {
        setTemplates(templateData);
```

to:

```js
      .then(([templateData, nodeData]) => {
        setTemplates(resolveTemplates(templateData));
```

- [ ] **Step 3: Commit**

```bash
git add web/app.jsx
git commit -m "feat: resolve navGroup colour inheritance at template load time"
```

---

## Task 6: Update `NavTree` to render the new entry shape

**Files:**
- Modify: `web/app.jsx`

The `NavTree` function currently destructures `templateGroups` as a `Map` from `navTree.get(component)`. After this task it iterates over the `NavEntry[]` array returned by the updated `buildNavTree`.

- [ ] **Step 1: Replace the `NavTree` function**

Find the `function NavTree(...)` definition (lines 70–158 in the original file) and replace it with:

```jsx
function NavTree({ navTree, templates, activeNodeId, onNode }) {
  const sortedComponents = [...navTree.keys()].sort((a, b) => a.localeCompare(b));
  const [openComponent, setOpenComponent] = useState();
  const templateMap = new Map(templates.map(template => [template.name, template]));

  useEffect(() => {
    if (openComponent === undefined) {
      setOpenComponent(sortedComponents[0] ?? null);
      return;
    }
    if (openComponent !== null && !navTree.has(openComponent)) {
      setOpenComponent(sortedComponents[0] ?? null);
    }
  }, [navTree, openComponent, sortedComponents]);

  function toggleComponent(component) {
    setOpenComponent(prev => prev === component ? null : component);
  }

  if (navTree.size === 0) {
    return <div className="nav-tree"><div className="empty-state">No graph nodes loaded.</div></div>;
  }

  return (
    <div className="nav-tree">
      {sortedComponents.map(component => {
        const entries = navTree.get(component);
        return (
          <div key={component}>
            <div className="nav-section-head" onClick={() => toggleComponent(component)}>
              <span>{component}</span>
              <Icon name={openComponent === component ? 'chevron-down' : 'chevron-right'} size={12} />
            </div>
            {openComponent === component && entries.map(entry => {
              if (entry.kind === 'group') {
                return (
                  <div key={entry.groupTemplateName}>
                    <div className="nav-template-head">
                      {entry.icon && (
                        <i
                          className={`fa-solid fa-${entry.icon}`}
                          style={{ color: entry.colour, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                        />
                      )}
                      <span>{entry.label}</span>
                    </div>
                    {entry.children.map(child => (
                      <div key={child.templateName}>
                        <div className="nav-subtype-head">
                          {child.icon && (
                            <i
                              className={`fa-solid fa-${child.icon}`}
                              style={{ color: child.colour, fontSize: 11, width: 14, textAlign: 'center', flexShrink: 0 }}
                            />
                          )}
                          <span>{child.label}</span>
                        </div>
                        {child.nodes.map(node => {
                          const isActive = node.id === activeNodeId;
                          return (
                            <div
                              key={node.id}
                              className={`nav-node-item${isActive ? ' active' : ''}`}
                              onClick={() => onNode(node.id)}
                              title={node.id}
                              style={isActive ? { '--nav-node-active-bg': child.colour } : undefined}
                            >
                              {displayName(node.id)}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                );
              }

              const template = templateMap.get(entry.templateName);
              const colour = template?.ui?.colour ?? 'var(--ink-4)';
              return (
                <div key={entry.templateName}>
                  <div className="nav-template-head">
                    <i
                      className={`fa-solid fa-${template?.ui?.icon ?? 'circle'}`}
                      style={{ color: colour, fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0 }}
                    />
                    <span>{templateDisplayName(template)}</span>
                  </div>
                  {entry.nodes.map(node => {
                    const isActive = node.id === activeNodeId;
                    return (
                      <div key={node.id}>
                        <div
                          className={`nav-node-item${isActive ? ' active' : ''}`}
                          onClick={() => onNode(node.id)}
                          title={node.id}
                          style={isActive ? { '--nav-node-active-bg': colour } : undefined}
                        >
                          {displayName(node.id)}
                        </div>
                        {(node.navChildren ?? []).map(group => (
                          <div className="nav-child-group" key={group.label}>
                            <div className="nav-child-head">{group.label}</div>
                            {group.nodes.map(child => {
                              const childTemplate = templateMap.get(child.template);
                              const childColour = childTemplate?.ui?.colour ?? colour;
                              const childIsActive = child.id === activeNodeId;
                              return (
                                <div
                                  key={child.id}
                                  className={`nav-node-item nav-node-child${childIsActive ? ' active' : ''}`}
                                  onClick={() => onNode(child.id)}
                                  title={child.id}
                                  style={childIsActive ? { '--nav-node-active-bg': childColour } : undefined}
                                >
                                  {displayName(child.id)}
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass (NavTree is browser code, not covered by the test suite — the nav.js tests validate the data layer).

- [ ] **Step 3: Commit**

```bash
git add web/app.jsx
git commit -m "feat: update NavTree to render navGroup entries"
```

---

## Task 7: Add `nav-subtype-head` CSS and verify

**Files:**
- Modify: `web/style.css`

- [ ] **Step 1: Add `.nav-subtype-head` rule**

Insert the following rule immediately after the `.nav-template-head` rule (after line 180 in the original file):

```css
.nav-subtype-head {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 5px 6px 2px 22px;
  color: var(--ink-3);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
```

- [ ] **Step 2: Start the web server**

```bash
npm run web
```

- [ ] **Step 3: Open the browser and verify**

Open `http://localhost:3000` (or whatever port is configured). Verify:

1. In the nav tree, expand a component that contains DomainEvent or IntegrationEvent nodes (e.g. `orders`)
2. You see a single **Event** heading (amber bolt icon, uppercase) instead of two separate headings
3. Under Event you see two subtype headings: **Domain Event** (no icon, amber text) and **Integration Event** (share-nodes icon, orange text)
4. Nodes appear under their correct subtype heading
5. Clicking a node navigates to the node page correctly
6. The active node highlight colour matches the subtype's colour
7. Other template types (DomainModel, APIEndpoint, etc.) still appear as before with no regression

- [ ] **Step 4: Stop the server and commit**

```bash
git add web/style.css
git commit -m "feat: add nav-subtype-head style for navGroup subtype headings"
```
