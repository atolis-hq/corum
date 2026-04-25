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
